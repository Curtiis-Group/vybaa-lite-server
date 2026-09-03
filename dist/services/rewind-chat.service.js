"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewindChatError = void 0;
exports.extractRewindMentions = extractRewindMentions;
exports.getRewindChatMessageIdempotencyKey = getRewindChatMessageIdempotencyKey;
exports.ensureDefaultRewindChats = ensureDefaultRewindChats;
exports.listRewindChatMessages = listRewindChatMessages;
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
    ariel: "Ariel is empathetic, optimistic, and grounded. Ariel notices resilience, balance, adaptation, and possibility.",
    ella: "Ella is warm, gentle, and reflective. Ella notices emotional nuance, shifts in energy, and needs beneath the surface.",
    jake: "Jake is direct, energetic, and candid without being pushy. Jake notices agency, obstacles, wins, and practical next moves.",
    lyra: "Lyra is calm, poetic but concrete, and insight-oriented. Lyra notices patterns, contradictions, meaning, and quiet change.",
};
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
function extractRewindMentions(content) {
    const lowerContent = content.toLowerCase();
    return REWIND_PERSONAS.filter((personaId) => new RegExp(`(^|\\s)@${personaId}\\b`).test(lowerContent));
}
function getRewindChatMessageIdempotencyKey(userId, chatId, clientKey) {
    return `${userId}:${chatId}:${clientKey}`;
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
            title: "Rewind Partners",
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
        personalContext = await (0, rewind_personal_context_service_1.loadRewindPersonalContext)(params.userId, params.timezone, `chat:${params.chat.id}`)
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
    const fixedPersona = isPersonaId(params.chat.personaId)
        ? params.chat.personaId
        : params.mentions[0];
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
        model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-2.5-flash",
    });
    if (!response.text)
        throw new Error("Rewind chat response was empty");
    const generated = parseGeneratedReply(JSON.parse(response.text));
    return fixedPersona ? { ...generated, personaId: fixedPersona } : generated;
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
