"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DailyObservationError = void 0;
exports.parseGeneratedDailyObservation = parseGeneratedDailyObservation;
exports.hasSubstantiveSignalDescriptions = hasSubstantiveSignalDescriptions;
exports.serializeDailyObservation = serializeDailyObservation;
exports.ensureDailyObservation = ensureDailyObservation;
exports.listDailyObservations = listDailyObservations;
exports.refreshPendingDailyObservations = refreshPendingDailyObservations;
exports.getDailyObservation = getDailyObservation;
exports.dismissDailyObservation = dismissDailyObservation;
exports.getRecentObservationContext = getRecentObservationContext;
const genai_1 = require("@google/genai");
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const activity_signal_service_1 = require("./activity-signal.service");
const notification_service_1 = require("./notification.service");
const rewind_chat_realtime_service_1 = require("./rewind-chat-realtime.service");
const OBSERVATION_GENERATION_VERSION = 2;
const MAX_OBSERVATION_SIGNALS = 40;
const MAX_EVIDENCE_ITEMS = 8;
const REWIND_PERSONA_NAMES = {
    ariel: "Ariel",
    ella: "Ella",
    jake: "Jake",
    lyra: "Lyra",
    neeja: "Neeja",
    tobi: "Tobi",
};
const REWIND_GREETING_VOICES = {
    ariel: "Ariel sounds like a grounded older sibling: protective, practical, warm, and concise without coddling.",
    ella: "Ella is emotionally expressive and openly caring. She reacts with real feeling without becoming flattering or dramatic for show.",
    jake: "Jake is very blunt, unsentimental, and brief. He says the honest thing without being cruel.",
    lyra: "Lyra is nonchalant, dry, and low-key. Her care is understated and she does not over-explain.",
    neeja: "Neeja is perceptive, composed, and quietly confident. She notices subtext, asks pointed questions, and keeps her wording short and human.",
    tobi: "Tobi is playful, socially sharp, and warm. He uses light banter and casual Nigerian phrasing when natural, while still being honest.",
};
class DailyObservationError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
exports.DailyObservationError = DailyObservationError;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isRewindPersonaId(value) {
    return (value === "ariel" ||
        value === "ella" ||
        value === "jake" ||
        value === "lyra" ||
        value === "tobi" ||
        value === "neeja");
}
function normalizeText(value, maximumLength) {
    if (typeof value !== "string")
        return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, maximumLength) : null;
}
function normalizeTextList(value) {
    if (!Array.isArray(value))
        return [];
    const values = [];
    for (const entry of value) {
        const normalized = normalizeText(entry, 420);
        if (normalized && !values.includes(normalized))
            values.push(normalized);
        if (values.length === 4)
            break;
    }
    return values;
}
function parseGeneratedDailyObservation(value) {
    if (!isRecord(value)) {
        throw new Error("Daily observation response was not an object");
    }
    const description = normalizeText(value.description, 700);
    const homeGreeting = normalizeText(value.homeGreeting, 100);
    const observations = normalizeTextList(value.observations);
    const reflection = normalizeText(value.reflection, 1500);
    const journalDraft = normalizeText(value.journalDraft, 2400);
    const rawConfidence = value.confidence;
    if (!description ||
        !homeGreeting ||
        !observations.length ||
        !reflection ||
        !journalDraft ||
        typeof rawConfidence !== "number" ||
        !Number.isFinite(rawConfidence)) {
        throw new Error("Daily observation response omitted required content");
    }
    return {
        confidence: Math.max(0, Math.min(1, rawConfidence)),
        description,
        homeGreeting,
        journalDraft,
        observations,
        reflection,
    };
}
function formatSignals(signals) {
    return signals
        .map((signal, index) => `${index + 1}. [${signal.happenedAt.toISOString()}] [${signal.sourceType}]${signal.personaId ? ` [Partner: ${signal.personaId}]` : ""} ${signal.description}`)
        .join("\n");
}
function hasSubstantiveSignalDescriptions(descriptions) {
    let combinedLength = 0;
    for (const description of descriptions) {
        combinedLength += description.trim().length;
    }
    return descriptions.length >= 2 || combinedLength >= 80;
}
async function generateDailyObservation(localDateKey, signals, userDisplayName, personaId) {
    if (!env_util_1.Env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured");
    }
    const client = new genai_1.GoogleGenAI({ apiKey: env_util_1.Env.GEMINI_API_KEY });
    const response = await client.models.generateContent({
        contents: [
            {
                parts: [
                    {
                        text: `Create a grounded emotional observation for ${localDateKey} from the activity evidence below. ` +
                            `Infer carefully: use tentative language such as “seemed”, “may”, or “suggests”. ` +
                            `Do not diagnose, label personality, invent events, or make medical claims. ` +
                            `The description should sound like a perceptive friend and be at most two sentences. ` +
                            `The homeGreeting must address ${userDisplayName} by first name, sound like a real friend, and fit in two short visual lines (maximum 100 characters). ` +
                            `${personaId ? `${REWIND_GREETING_VOICES[personaId]} Write the homeGreeting in that voice because it will be sent as their chat message. ` : ""}` +
                            `Use plain language in the spirit of “${userDisplayName}, hope today feels a little better” or “${userDisplayName}, I liked how you spoke yesterday”, but ground it in the evidence and do not copy those examples mechanically. ` +
                            `Observations must each point to a real pattern in the evidence. ` +
                            `When using a partner-attributed signal, credit that partner naturally. ` +
                            `The reflection should summarize what the day may have meant. ` +
                            `The journalDraft must be first-person, editable, and must not claim certainty beyond the evidence.\n\n` +
                            `Activity evidence:\n${formatSignals(signals)}`,
                    },
                ],
                role: "user",
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                properties: {
                    confidence: { type: genai_1.Type.NUMBER },
                    description: { type: genai_1.Type.STRING },
                    homeGreeting: { type: genai_1.Type.STRING },
                    journalDraft: { type: genai_1.Type.STRING },
                    observations: { items: { type: genai_1.Type.STRING }, type: genai_1.Type.ARRAY },
                    reflection: { type: genai_1.Type.STRING },
                },
                required: [
                    "confidence",
                    "description",
                    "homeGreeting",
                    "journalDraft",
                    "observations",
                    "reflection",
                ],
                type: genai_1.Type.OBJECT,
            },
            temperature: 0.25,
        },
        model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
    });
    if (!response.text) {
        throw new Error("Daily observation response was empty");
    }
    return parseGeneratedDailyObservation(JSON.parse(response.text));
}
function getEvidenceInput(signals) {
    return signals.slice(0, MAX_EVIDENCE_ITEMS).map((signal) => ({
        description: signal.description,
        eventType: signal.eventType,
        happenedAt: signal.happenedAt.toISOString(),
        id: signal.id,
        sourceId: signal.sourceId,
        sourceType: signal.sourceType,
    }));
}
function normalizeStoredStringArray(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "string")
        : [];
}
function normalizeStoredEvidence(value) {
    if (!Array.isArray(value))
        return [];
    const evidence = [];
    for (const entry of value) {
        if (!isRecord(entry))
            continue;
        const id = normalizeText(entry.id, 128);
        const sourceId = normalizeText(entry.sourceId, 128);
        const sourceType = normalizeText(entry.sourceType, 64);
        const eventType = normalizeText(entry.eventType, 128);
        const description = normalizeText(entry.description, 2400);
        const happenedAt = normalizeText(entry.happenedAt, 64);
        if (!id ||
            !sourceId ||
            !sourceType ||
            !eventType ||
            !description ||
            !happenedAt) {
            continue;
        }
        evidence.push({
            description,
            eventType,
            happenedAt,
            id,
            sourceId,
            sourceType,
        });
    }
    return evidence;
}
function serializeDailyObservation(observation) {
    return {
        confidence: observation.confidence,
        createdAt: observation.createdAt.toISOString(),
        description: observation.description,
        dismissedAt: observation.dismissedAt?.toISOString() ?? null,
        evidence: normalizeStoredEvidence(observation.evidence),
        homeGreeting: observation.homeGreeting,
        id: observation.id,
        journalDraft: observation.journalDraft,
        localDateKey: observation.localDateKey,
        observations: normalizeStoredStringArray(observation.observations),
        personaId: observation.personaId,
        reflection: observation.reflection,
        sourceTypes: observation.sourceTypes,
        updatedAt: observation.updatedAt.toISOString(),
    };
}
async function persistDailyObservationGreeting(params) {
    const committedAt = new Date();
    const idempotencyKey = `rewind-home-greeting:${params.observationId}:${params.personaId}`;
    const committed = await db_config_1.prisma.$transaction(async (tx) => {
        const chat = await tx.rewindChat.upsert({
            create: {
                personaId: params.personaId,
                threadKey: `partner:${params.personaId}`,
                title: REWIND_PERSONA_NAMES[params.personaId],
                type: client_1.RewindChatType.PARTNER,
                userId: params.userId,
            },
            update: { archivedAt: null },
            where: {
                userId_threadKey: {
                    threadKey: `partner:${params.personaId}`,
                    userId: params.userId,
                },
            },
        });
        const created = await tx.rewindChatMessage.createMany({
            data: [
                {
                    chatId: chat.id,
                    content: params.content,
                    createdAt: committedAt,
                    idempotencyKey,
                    localDateKey: params.localDateKey,
                    mentions: [],
                    personaId: params.personaId,
                    role: client_1.RewindChatMessageRole.PARTNER,
                    userId: params.userId,
                },
            ],
            skipDuplicates: true,
        });
        if (!created.count)
            return null;
        const message = await tx.rewindChatMessage.findUnique({
            select: { id: true },
            where: { idempotencyKey },
        });
        if (!message) {
            throw new Error("Saved Rewind greeting could not be recovered");
        }
        await Promise.all([
            tx.rewindChat.update({
                data: {
                    lastMessageAt: committedAt,
                    unreadCount: { increment: 1 },
                },
                where: { id: chat.id },
            }),
            tx.rewindPartnerMind.updateMany({
                data: { lastSpokeAt: committedAt },
                where: {
                    chatId: chat.id,
                    personaId: params.personaId,
                    userId: params.userId,
                },
            }),
        ]);
        return { chatId: chat.id, messageId: message.id };
    });
    if (!committed)
        return;
    await (0, rewind_chat_realtime_service_1.publishRewindChatEvent)(params.userId, {
        chatId: committed.chatId,
        runId: `home-greeting:${params.observationId}`,
        type: "chat_invalidated",
    });
    await notification_service_1.notificationService.createNotification({
        data: {
            chatId: committed.chatId,
            messageId: committed.messageId,
            route: `/app/rewind-chat/${committed.chatId}`,
            sourcePersonaId: params.personaId,
        },
        dedupeKey: `rewind-home-greeting:${params.observationId}:${params.personaId}:notification`,
        message: params.content,
        title: REWIND_PERSONA_NAMES[params.personaId],
        type: "rewind_chat_message",
        userId: params.userId,
    });
}
async function persistStoredObservationGreeting(observation, personaId) {
    if (!personaId || !observation.homeGreeting)
        return;
    await persistDailyObservationGreeting({
        content: observation.homeGreeting,
        localDateKey: observation.localDateKey,
        observationId: observation.id,
        personaId,
        userId: observation.userId,
    });
}
async function ensureDailyObservation(params) {
    const user = await db_config_1.prisma.user.findUnique({
        select: {
            firstName: true,
            rewindPersona: true,
            rewindPersonalizationEnabled: true,
            username: true,
        },
        where: { id: params.userId },
    });
    if (!user?.rewindPersonalizationEnabled)
        return null;
    const selectedPersonaId = isRewindPersonaId(user.rewindPersona)
        ? user.rewindPersona
        : null;
    await (0, activity_signal_service_1.syncDerivedActivitySignals)(params.userId, params.localDateKey, params.timezone);
    const signals = await db_config_1.prisma.activitySignal.findMany({
        orderBy: [{ happenedAt: "desc" }, { id: "desc" }],
        take: MAX_OBSERVATION_SIGNALS,
        where: {
            localDateKey: params.localDateKey,
            privacyEligible: true,
            userId: params.userId,
        },
    });
    if (!hasSubstantiveSignalDescriptions(signals.map((signal) => signal.description))) {
        return null;
    }
    const existing = await db_config_1.prisma.dailyObservation.findUnique({
        where: {
            userId_localDateKey: {
                localDateKey: params.localDateKey,
                userId: params.userId,
            },
        },
    });
    const latestSignal = signals[0];
    if (existing &&
        !params.force &&
        latestSignal &&
        latestSignal.createdAt <= existing.updatedAt &&
        existing.generationVersion === OBSERVATION_GENERATION_VERSION) {
        await persistStoredObservationGreeting(existing, selectedPersonaId);
        return serializeDailyObservation(existing);
    }
    const generated = await generateDailyObservation(params.localDateKey, signals, user.firstName ?? user.username ?? "Hey", selectedPersonaId);
    if (generated.confidence < 0.35)
        return null;
    const sourceTypes = [...new Set(signals.map((signal) => signal.sourceType))];
    const attributedPersona = signals.find((signal) => signal.personaId)?.personaId;
    const saved = await db_config_1.prisma.dailyObservation.upsert({
        create: {
            confidence: generated.confidence,
            description: generated.description,
            evidence: getEvidenceInput(signals),
            generationVersion: OBSERVATION_GENERATION_VERSION,
            homeGreeting: generated.homeGreeting,
            journalDraft: generated.journalDraft,
            localDateKey: params.localDateKey,
            observations: generated.observations,
            personaId: attributedPersona,
            reflection: generated.reflection,
            sourceTypes,
            userId: params.userId,
        },
        update: {
            confidence: generated.confidence,
            description: generated.description,
            evidence: getEvidenceInput(signals),
            generationVersion: OBSERVATION_GENERATION_VERSION,
            homeGreeting: generated.homeGreeting,
            journalDraft: generated.journalDraft,
            observations: generated.observations,
            personaId: attributedPersona,
            reflection: generated.reflection,
            sourceTypes,
        },
        where: {
            userId_localDateKey: {
                localDateKey: params.localDateKey,
                userId: params.userId,
            },
        },
    });
    await persistStoredObservationGreeting(saved, selectedPersonaId);
    return serializeDailyObservation(saved);
}
async function listDailyObservations(params) {
    if (params.cursor) {
        const cursorObservation = await db_config_1.prisma.dailyObservation.findFirst({
            select: { id: true },
            where: { id: params.cursor, userId: params.userId },
        });
        if (!cursorObservation) {
            throw new DailyObservationError("INVALID_CURSOR", "Invalid observation cursor");
        }
    }
    const today = luxon_1.DateTime.now().setZone(params.timezone).toISODate();
    if (today) {
        await ensureDailyObservation({
            localDateKey: today,
            timezone: params.timezone,
            userId: params.userId,
        }).catch((error) => {
            logger_util_1.default.warn("Unable to refresh today's Rewind observation", {
                errorName: error instanceof Error ? error.name : "UnknownError",
                userId: params.userId,
            });
            return null;
        });
    }
    const rows = await db_config_1.prisma.dailyObservation.findMany({
        orderBy: [{ localDateKey: "desc" }, { id: "desc" }],
        skip: params.cursor ? 1 : 0,
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor } } : {}),
        where: { dismissedAt: null, userId: params.userId },
    });
    const hasMore = rows.length > params.limit;
    const items = hasMore ? rows.slice(0, params.limit) : rows;
    return {
        items: items.map(serializeDailyObservation),
        nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
}
async function refreshPendingDailyObservations(maximumDays = 20) {
    const recentSignals = await db_config_1.prisma.activitySignal.findMany({
        orderBy: { createdAt: "desc" },
        select: { localDateKey: true, userId: true },
        take: 300,
        where: {
            createdAt: { gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
            privacyEligible: true,
        },
    });
    const dayKeys = new Set();
    const days = [];
    for (const signal of recentSignals) {
        const key = `${signal.userId}:${signal.localDateKey}`;
        if (dayKeys.has(key))
            continue;
        dayKeys.add(key);
        days.push(signal);
        if (days.length === maximumDays)
            break;
    }
    if (!days.length)
        return { attempted: 0, generated: 0 };
    const users = await db_config_1.prisma.user.findMany({
        select: { id: true, timezone: true },
        where: { id: { in: [...new Set(days.map((day) => day.userId))] } },
    });
    const timezones = new Map(users.map((user) => [user.id, user.timezone]));
    let generated = 0;
    for (const day of days) {
        try {
            const observation = await ensureDailyObservation({
                localDateKey: day.localDateKey,
                timezone: timezones.get(day.userId) ?? "UTC",
                userId: day.userId,
            });
            if (observation)
                generated += 1;
        }
        catch (error) {
            logger_util_1.default.warn("Unable to generate a pending Rewind observation", {
                errorName: error instanceof Error ? error.name : "UnknownError",
                localDateKey: day.localDateKey,
                userId: day.userId,
            });
        }
    }
    return { attempted: days.length, generated };
}
async function getDailyObservation(userId, observationId) {
    const observation = await db_config_1.prisma.dailyObservation.findFirst({
        where: { id: observationId, userId },
    });
    return observation ? serializeDailyObservation(observation) : null;
}
async function dismissDailyObservation(userId, observationId) {
    const result = await db_config_1.prisma.dailyObservation.updateMany({
        data: { dismissedAt: new Date() },
        where: { dismissedAt: null, id: observationId, userId },
    });
    return result.count > 0;
}
async function getRecentObservationContext(userId, limit = 5) {
    const observations = await db_config_1.prisma.dailyObservation.findMany({
        orderBy: { localDateKey: "desc" },
        take: limit,
        where: { dismissedAt: null, userId },
    });
    if (!observations.length)
        return "";
    return observations
        .map((observation) => {
        const partner = observation.personaId
            ? `${observation.personaId.charAt(0).toUpperCase()}${observation.personaId.slice(1)} noticed`
            : "Activity pattern";
        return `- ${partner}, ${observation.localDateKey}: ${observation.description}`;
    })
        .join("\n");
}
