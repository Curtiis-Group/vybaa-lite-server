"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewindChatError = void 0;
exports.extractRewindMentions = extractRewindMentions;
exports.getRewindChatMessageIdempotencyKey = getRewindChatMessageIdempotencyKey;
exports.selectRewindReplyPersonas = selectRewindReplyPersonas;
exports.ensureDefaultRewindChats = ensureDefaultRewindChats;
exports.listRewindChatMessages = listRewindChatMessages;
exports.streamRewindChatMessage = streamRewindChatMessage;
exports.sendRewindChatMessage = sendRewindChatMessage;
exports.setRewindChatArchived = setRewindChatArchived;
const genai_1 = require("@google/genai");
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const activity_signal_service_1 = require("./activity-signal.service");
const daily_observation_service_1 = require("./daily-observation.service");
const rewind_personal_context_service_1 = require("./rewind-personal-context.service");
const REWIND_PERSONAS = ["ella", "lyra", "jake", "ariel"];
const PERSONA_NAMES = {
    ariel: "Ariel",
    ella: "Ella",
    jake: "Jake",
    lyra: "Lyra",
};
const PERSONA_PROMPTS = {
    ariel: "Ariel is the grounded big-sibling figure: protective, practical, steady, and willing to tease or give a needed reality check. Ariel reassures without coddling and looks out for people without trying to control them.",
    ella: "Ella is intensely emotional, expressive, and deeply feeling. Ella names the emotional stakes plainly and reacts with genuine warmth, concern, delight, or frustration, but never performs emotion or agrees just to soothe someone.",
    jake: "Jake is very blunt, unsentimental, and concise. Jake says the uncomfortable obvious thing, challenges excuses and contradictions, and never sugarcoats; he is honest without being cruel or humiliating.",
    lyra: "Lyra is nonchalant, low-key, dry, and hard to rattle. Lyra cuts through drama with a calm observation or wry aside; her care is understated, and she never gushes, chases, or over-explains.",
};
const INDEPENDENT_PARTNER_PROMPT = "Act as an independent peer, not the user's attendant, fan, therapist, or subordinate. Keep your own opinions and emotional reactions. Disagree or challenge the user when warranted. Never flatter, worship, pile on praise, act impressed by ordinary statements, or reflexively validate and reassure.";
function isPersonaId(value) {
    return (value === "ariel" ||
        value === "ella" ||
        value === "jake" ||
        value === "lyra");
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeContent(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 4000);
}
async function emitReadableStreamFragments(delta, onDelta) {
    const fragments = delta.match(/\S+\s*|\s+/g) ?? [delta];
    for (const fragment of fragments) {
        onDelta(fragment);
        await new Promise((resolve) => {
            setTimeout(resolve, 18);
        });
    }
}
function extractRewindMentions(content) {
    const lowerContent = content.toLowerCase();
    return REWIND_PERSONAS.filter((personaId) => new RegExp(`(^|\\s)@${personaId}\\b`).test(lowerContent));
}
function getRewindChatMessageIdempotencyKey(userId, chatId, clientKey) {
    return `${userId}:${chatId}:${clientKey}`;
}
function getContentSeed(content) {
    let seed = 0;
    for (const character of content) {
        seed = (seed * 31 + character.charCodeAt(0)) % 10007;
    }
    return seed;
}
function selectRewindReplyPersonas(params) {
    if (params.chatType === client_1.RewindChatType.PARTNER) {
        return isPersonaId(params.chatPersonaId)
            ? [params.chatPersonaId]
            : ["ella"];
    }
    const selected = [...params.mentions];
    const seed = getContentSeed(params.content);
    const ordered = REWIND_PERSONAS.map((_, index) => REWIND_PERSONAS[(seed + index) % REWIND_PERSONAS.length]).filter((personaId) => Boolean(personaId));
    const desiredCount = params.mentions.length > 1 ? params.mentions.length : 2;
    for (const personaId of ordered) {
        if (!selected.includes(personaId))
            selected.push(personaId);
        if (selected.length >= Math.min(3, desiredCount))
            break;
    }
    return selected.slice(0, 3);
}
function serializeMessage(message) {
    return {
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        id: message.id,
        localDateKey: message.localDateKey,
        mentions: message.mentions.filter(isPersonaId),
        personaId: isPersonaId(message.personaId) ? message.personaId : null,
        role: message.role,
    };
}
function serializeChat(chat, lastMessage) {
    return {
        archivedAt: chat.archivedAt?.toISOString() ?? null,
        createdAt: chat.createdAt.toISOString(),
        id: chat.id,
        lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        personaId: isPersonaId(chat.personaId) ? chat.personaId : null,
        threadKey: chat.threadKey,
        title: chat.title,
        type: chat.type,
        updatedAt: chat.updatedAt.toISOString(),
    };
}
function parseGeneratedReply(value) {
    if (!isRecord(value)) {
        throw new Error("Rewind chat response was not an object");
    }
    const personaId = value.personaId;
    const reply = typeof value.reply === "string" ? normalizeContent(value.reply) : "";
    if (!isPersonaId(personaId) || !reply) {
        throw new Error("Rewind chat response omitted its partner or reply");
    }
    return { personaId, reply };
}
function getThreadDefinition(personaId) {
    if (!personaId) {
        return {
            personaId: null,
            threadKey: "group",
            title: "General",
            type: client_1.RewindChatType.GROUP,
        };
    }
    return {
        personaId,
        threadKey: `partner:${personaId}`,
        title: PERSONA_NAMES[personaId],
        type: client_1.RewindChatType.PARTNER,
    };
}
async function ensureChat(userId, personaId) {
    const definition = getThreadDefinition(personaId);
    return db_config_1.prisma.rewindChat.upsert({
        create: { ...definition, userId },
        update: {},
        where: {
            userId_threadKey: { threadKey: definition.threadKey, userId },
        },
    });
}
async function ensureDefaultRewindChats(userId) {
    await Promise.all([
        ensureChat(userId),
        ...REWIND_PERSONAS.map((personaId) => ensureChat(userId, personaId)),
    ]);
    const chats = await db_config_1.prisma.rewindChat.findMany({
        include: { messages: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "asc" }],
        where: { archivedAt: null, userId },
    });
    return chats.map((chat) => serializeChat(chat, chat.messages[0] ?? null));
}
async function listRewindChatMessages(params) {
    const chat = await db_config_1.prisma.rewindChat.findFirst({
        where: { id: params.chatId, userId: params.userId },
    });
    if (!chat)
        throw new RewindChatError("CHAT_NOT_FOUND", "Chat not found", 404);
    if (params.cursor) {
        const cursorMessage = await db_config_1.prisma.rewindChatMessage.findFirst({
            select: { id: true },
            where: { chatId: chat.id, id: params.cursor, userId: params.userId },
        });
        if (!cursorMessage) {
            throw new RewindChatError("INVALID_CURSOR", "Invalid chat cursor");
        }
    }
    const rows = await db_config_1.prisma.rewindChatMessage.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: params.cursor ? 1 : 0,
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor } } : {}),
        where: { chatId: chat.id },
    });
    const hasMore = rows.length > params.limit;
    const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
    return {
        chat: serializeChat(chat, rows[0] ?? null),
        items: [...pageRows].reverse().map(serializeMessage),
        nextCursor: hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null,
    };
}
function formatRecentMessages(messages) {
    return messages
        .map((message) => {
        let speaker = "Partner";
        if (message.role === client_1.RewindChatMessageRole.USER) {
            speaker = "User";
        }
        else if (isPersonaId(message.personaId)) {
            speaker = PERSONA_NAMES[message.personaId];
        }
        return `${speaker}: ${message.content}`;
    })
        .join("\n");
}
async function generateChatReply(params) {
    if (!env_util_1.Env.GEMINI_API_KEY)
        throw new Error("GEMINI_API_KEY is not configured");
    const fixedPersona = isPersonaId(params.chat.personaId)
        ? params.chat.personaId
        : params.mentions[0];
    const [messages, user, storedObservationContext] = await Promise.all([
        db_config_1.prisma.rewindChatMessage.findMany({
            orderBy: { createdAt: "desc" },
            take: 24,
            where: { chatId: params.chat.id },
        }),
        db_config_1.prisma.user.findUnique({
            select: {
                firstName: true,
                rewindPersonalizationEnabled: true,
                username: true,
            },
            where: { id: params.userId },
        }),
        (0, daily_observation_service_1.getRecentObservationContext)(params.userId),
    ]);
    let personalContext = "";
    if (user?.rewindPersonalizationEnabled) {
        personalContext = await (0, rewind_personal_context_service_1.loadRewindPersonalContext)(params.userId, params.timezone, `chat:${params.chat.id}`, fixedPersona)
            .then(rewind_personal_context_service_1.formatRewindPersonalContext)
            .catch((error) => {
            logger_util_1.default.warn("Rewind chat personal context unavailable", {
                chatId: params.chat.id,
                errorName: error instanceof Error ? error.name : "UnknownError",
                userId: params.userId,
            });
            return "";
        });
    }
    const observationContext = user?.rewindPersonalizationEnabled
        ? storedObservationContext
        : "";
    const partnerDirection = fixedPersona
        ? `Reply only as ${PERSONA_NAMES[fixedPersona]}.`
        : "Choose exactly one partner whose perspective best fits the user’s latest message.";
    const personaDescriptions = REWIND_PERSONAS.map((personaId) => `${PERSONA_NAMES[personaId]}: ${PERSONA_PROMPTS[personaId]}`).join("\n");
    const client = new genai_1.GoogleGenAI({ apiKey: env_util_1.Env.GEMINI_API_KEY });
    const response = await client.models.generateContent({
        contents: [
            {
                parts: [
                    {
                        text: `You are responding in Vybaa Rewind text chat. ${partnerDirection} ` +
                            `${INDEPENDENT_PARTNER_PROMPT} ` +
                            `Be natural, concise, emotionally perceptive, and grounded. Respond like a trusted friend, not a clinician. ` +
                            `Do not diagnose, invent facts, expose hidden context, or claim an action was completed. Ask at most one useful question.\n\n` +
                            `Partners:\n${personaDescriptions}\n\n` +
                            `User name: ${user?.firstName ?? user?.username ?? "there"}\n` +
                            `Timezone: ${params.timezone}\n\n` +
                            (observationContext
                                ? `Recent grounded observations:\n${observationContext}\n\n`
                                : "") +
                            (personalContext ? `${personalContext}\n\n` : "") +
                            `Recent chat:\n${formatRecentMessages([...messages].reverse())}\n\n` +
                            `Latest message:\n${params.content}`,
                    },
                ],
                role: "user",
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                properties: {
                    personaId: { enum: REWIND_PERSONAS, type: genai_1.Type.STRING },
                    reply: { type: genai_1.Type.STRING },
                },
                required: ["personaId", "reply"],
                type: genai_1.Type.OBJECT,
            },
            temperature: 0.55,
        },
        model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
    });
    if (!response.text)
        throw new Error("Rewind chat response was empty");
    const generated = parseGeneratedReply(JSON.parse(response.text));
    return fixedPersona ? { ...generated, personaId: fixedPersona } : generated;
}
async function loadStreamingChatContext(params) {
    const [messages, user, storedObservationContext] = await Promise.all([
        db_config_1.prisma.rewindChatMessage.findMany({
            orderBy: { createdAt: "desc" },
            take: 28,
            where: { chatId: params.chatId },
        }),
        db_config_1.prisma.user.findUnique({
            select: {
                firstName: true,
                rewindPersonalizationEnabled: true,
                username: true,
            },
            where: { id: params.userId },
        }),
        (0, daily_observation_service_1.getRecentObservationContext)(params.userId),
    ]);
    let personalContext = "";
    if (user?.rewindPersonalizationEnabled) {
        personalContext = await (0, rewind_personal_context_service_1.loadRewindPersonalContext)(params.userId, params.timezone, `chat:${params.chatId}`)
            .then(rewind_personal_context_service_1.formatRewindPersonalContext)
            .catch((error) => {
            logger_util_1.default.warn("Rewind streaming chat context unavailable", {
                chatId: params.chatId,
                errorName: error instanceof Error ? error.name : "UnknownError",
                userId: params.userId,
            });
            return "";
        });
    }
    return {
        observationContext: user?.rewindPersonalizationEnabled
            ? storedObservationContext
            : "",
        personalContext,
        recentChat: formatRecentMessages([...messages].reverse()),
        userName: user?.firstName ?? user?.username ?? "there",
    };
}
async function generateStreamingPartnerTurn(params) {
    if (!env_util_1.Env.GEMINI_API_KEY)
        throw new Error("GEMINI_API_KEY is not configured");
    const previousTurnText = params.previousTurns.length
        ? params.previousTurns
            .map((turn) => `${PERSONA_NAMES[turn.personaId]}: ${turn.content}`)
            .join("\n")
        : "None yet.";
    const client = new genai_1.GoogleGenAI({ apiKey: env_util_1.Env.GEMINI_API_KEY });
    const response = await client.models.generateContentStream({
        contents: [
            {
                parts: [
                    {
                        text: `You are ${PERSONA_NAMES[params.personaId]} in a fluid group conversation inside Vybaa Rewind. ` +
                            `${PERSONA_PROMPTS[params.personaId]} ` +
                            `${INDEPENDENT_PARTNER_PROMPT} ` +
                            `Reply directly and naturally, like a trusted friend texting in real time. Keep it to one short sentence or two brief clauses, usually under 180 characters. Add one or two fitting emojis only when they genuinely add tone; never use emoji as filler. ` +
                            `You may agree or disagree with another partner, and may address them with @Name when it adds something useful. ` +
                            `Do not repeat another partner, diagnose, invent facts, expose hidden context, or narrate your role. ` +
                            `Ask at most one short question, and only when a question genuinely moves the conversation forward.\n\n` +
                            `User name: ${params.context.userName}\n` +
                            `Timezone: ${params.timezone}\n\n` +
                            (params.context.observationContext
                                ? `Recent grounded observations:\n${params.context.observationContext}\n\n`
                                : "") +
                            (params.context.personalContext
                                ? `${params.context.personalContext}\n\n`
                                : "") +
                            `Recent chat:\n${params.context.recentChat}\n\n` +
                            `User's latest message:\n${params.latestMessage}\n\n` +
                            `Partner replies already made during this turn:\n${previousTurnText}\n\n` +
                            `Write only ${PERSONA_NAMES[params.personaId]}'s message, without a name prefix.`,
                    },
                ],
                role: "user",
            },
        ],
        config: {
            maxOutputTokens: 300,
            temperature: 0.72,
        },
        model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
    });
    let reply = "";
    for await (const chunk of response) {
        const delta = chunk.text ?? "";
        if (!delta)
            continue;
        reply += delta;
        await emitReadableStreamFragments(delta, params.onDelta);
    }
    const normalized = normalizeContent(reply);
    if (!normalized)
        throw new Error("Rewind streaming reply was empty");
    return normalized;
}
async function streamRewindChatMessage(params) {
    const chat = await db_config_1.prisma.rewindChat.findFirst({
        where: { archivedAt: null, id: params.chatId, userId: params.userId },
    });
    if (!chat)
        throw new RewindChatError("CHAT_NOT_FOUND", "Chat not found", 404);
    const content = normalizeContent(params.content);
    if (!content) {
        throw new RewindChatError("EMPTY_MESSAGE", "Message is required");
    }
    const userIdempotencyKey = getRewindChatMessageIdempotencyKey(params.userId, chat.id, params.idempotencyKey);
    const now = new Date();
    const localDateKey = luxon_1.DateTime.fromJSDate(now, {
        zone: params.timezone,
    }).toISODate();
    if (!localDateKey)
        throw new Error("Unable to resolve chat local date");
    const mentions = extractRewindMentions(content);
    const userMessage = await db_config_1.prisma.rewindChatMessage.upsert({
        create: {
            chatId: chat.id,
            content,
            idempotencyKey: userIdempotencyKey,
            localDateKey,
            mentions,
            role: client_1.RewindChatMessageRole.USER,
            userId: params.userId,
        },
        update: {},
        where: { idempotencyKey: userIdempotencyKey },
    });
    params.onEvent({
        message: serializeMessage(userMessage),
        type: "user_message",
    });
    await db_config_1.prisma.rewindChat.update({
        data: { lastMessageAt: userMessage.createdAt },
        where: { id: chat.id },
    });
    await (0, activity_signal_service_1.recordActivitySignal)({
        dedupeKey: `rewind-chat:${userMessage.id}`,
        description: `Text chat: ${content}`,
        eventType: "CHAT_MESSAGE",
        happenedAt: userMessage.createdAt,
        localDateKey,
        metadata: { chatId: chat.id, mentions },
        sourceId: userMessage.id,
        sourceType: client_1.ActivitySignalSourceType.REWIND_CHAT,
        timezone: params.timezone,
        userId: params.userId,
    });
    const personas = selectRewindReplyPersonas({
        chatPersonaId: chat.personaId,
        chatType: chat.type,
        content,
        mentions,
    });
    const existingReplies = await db_config_1.prisma.rewindChatMessage.findMany({
        orderBy: { createdAt: "asc" },
        where: {
            chatId: chat.id,
            idempotencyKey: { startsWith: `${userIdempotencyKey}:stream-reply:` },
            userId: params.userId,
        },
    });
    if (existingReplies.length === personas.length) {
        for (const message of existingReplies) {
            params.onEvent({
                message: serializeMessage(message),
                type: "message_complete",
            });
        }
        params.onEvent({ type: "complete" });
        return;
    }
    const context = await loadStreamingChatContext({
        chatId: chat.id,
        timezone: params.timezone,
        userId: params.userId,
    });
    for (const personaId of personas) {
        params.onEvent({ personaId, type: "typing_started" });
    }
    const partnerTurns = [];
    for (const message of existingReplies) {
        if (!isPersonaId(message.personaId))
            continue;
        partnerTurns.push({
            content: message.content,
            personaId: message.personaId,
        });
    }
    try {
        for (const [index, personaId] of personas.entries()) {
            const replyIdempotencyKey = `${userIdempotencyKey}:stream-reply:${index}`;
            const existingReply = existingReplies.find((message) => message.idempotencyKey === replyIdempotencyKey);
            if (existingReply) {
                params.onEvent({
                    message: serializeMessage(existingReply),
                    type: "message_complete",
                });
                params.onEvent({ personaId, type: "typing_stopped" });
                continue;
            }
            const reply = await generateStreamingPartnerTurn({
                context,
                latestMessage: content,
                onDelta: (delta) => {
                    params.onEvent({ delta, personaId, type: "message_delta" });
                },
                personaId,
                previousTurns: partnerTurns,
                timezone: params.timezone,
            });
            const partnerMessage = await db_config_1.prisma.rewindChatMessage.upsert({
                create: {
                    chatId: chat.id,
                    content: reply,
                    idempotencyKey: replyIdempotencyKey,
                    localDateKey,
                    mentions: extractRewindMentions(reply),
                    personaId,
                    role: client_1.RewindChatMessageRole.PARTNER,
                    userId: params.userId,
                },
                update: {},
                where: { idempotencyKey: replyIdempotencyKey },
            });
            partnerTurns.push({ content: partnerMessage.content, personaId });
            await db_config_1.prisma.rewindChat.update({
                data: { lastMessageAt: partnerMessage.createdAt },
                where: { id: chat.id },
            });
            params.onEvent({
                message: serializeMessage(partnerMessage),
                type: "message_complete",
            });
            params.onEvent({ personaId, type: "typing_stopped" });
        }
    }
    finally {
        for (const personaId of personas) {
            params.onEvent({ personaId, type: "typing_stopped" });
        }
    }
    params.onEvent({ type: "complete" });
}
async function sendRewindChatMessage(params) {
    const chat = await db_config_1.prisma.rewindChat.findFirst({
        where: { archivedAt: null, id: params.chatId, userId: params.userId },
    });
    if (!chat)
        throw new RewindChatError("CHAT_NOT_FOUND", "Chat not found", 404);
    const content = normalizeContent(params.content);
    if (!content) {
        throw new RewindChatError("EMPTY_MESSAGE", "Message is required");
    }
    const userIdempotencyKey = getRewindChatMessageIdempotencyKey(params.userId, chat.id, params.idempotencyKey);
    const existingUserMessage = await db_config_1.prisma.rewindChatMessage.findFirst({
        where: {
            chatId: chat.id,
            idempotencyKey: userIdempotencyKey,
            userId: params.userId,
        },
    });
    const replyIdempotencyKey = `${userIdempotencyKey}:reply`;
    const existingPartnerMessage = await db_config_1.prisma.rewindChatMessage.findFirst({
        where: {
            chatId: chat.id,
            idempotencyKey: replyIdempotencyKey,
            userId: params.userId,
        },
    });
    if (existingUserMessage && existingPartnerMessage) {
        return {
            partnerMessage: serializeMessage(existingPartnerMessage),
            userMessage: serializeMessage(existingUserMessage),
        };
    }
    const mentions = extractRewindMentions(content);
    const now = new Date();
    const localDateKey = luxon_1.DateTime.fromJSDate(now, {
        zone: params.timezone,
    }).toISODate();
    if (!localDateKey)
        throw new Error("Unable to resolve chat local date");
    const userMessage = existingUserMessage ??
        (await db_config_1.prisma.rewindChatMessage.upsert({
            create: {
                chatId: chat.id,
                content,
                idempotencyKey: userIdempotencyKey,
                localDateKey,
                mentions,
                role: client_1.RewindChatMessageRole.USER,
                userId: params.userId,
            },
            update: {},
            where: { idempotencyKey: userIdempotencyKey },
        }));
    await db_config_1.prisma.rewindChat.update({
        data: { lastMessageAt: now },
        where: { id: chat.id },
    });
    await (0, activity_signal_service_1.recordActivitySignal)({
        dedupeKey: `rewind-chat:${userMessage.id}`,
        description: `Text chat: ${content}`,
        eventType: "CHAT_MESSAGE",
        happenedAt: userMessage.createdAt,
        localDateKey,
        metadata: { chatId: chat.id, mentions },
        sourceId: userMessage.id,
        sourceType: client_1.ActivitySignalSourceType.REWIND_CHAT,
        timezone: params.timezone,
        userId: params.userId,
    });
    const generated = await generateChatReply({
        chat,
        content,
        mentions,
        timezone: params.timezone,
        userId: params.userId,
    });
    const partnerMessage = existingPartnerMessage ??
        (await db_config_1.prisma.rewindChatMessage.upsert({
            create: {
                chatId: chat.id,
                content: generated.reply,
                idempotencyKey: replyIdempotencyKey,
                localDateKey,
                mentions: [],
                personaId: generated.personaId,
                role: client_1.RewindChatMessageRole.PARTNER,
                userId: params.userId,
            },
            update: {},
            where: { idempotencyKey: replyIdempotencyKey },
        }));
    await db_config_1.prisma.rewindChat.update({
        data: { lastMessageAt: partnerMessage.createdAt },
        where: { id: chat.id },
    });
    return {
        partnerMessage: serializeMessage(partnerMessage),
        userMessage: serializeMessage(userMessage),
    };
}
async function setRewindChatArchived(params) {
    const result = await db_config_1.prisma.rewindChat.updateMany({
        data: { archivedAt: params.archived ? new Date() : null },
        where: { id: params.chatId, userId: params.userId },
    });
    return result.count > 0;
}
class RewindChatError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
exports.RewindChatError = RewindChatError;
