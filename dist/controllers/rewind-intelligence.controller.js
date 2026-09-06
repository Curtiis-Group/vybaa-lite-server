"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listObservations = listObservations;
exports.getObservation = getObservation;
exports.dismissObservation = dismissObservation;
exports.getHomeGreeting = getHomeGreeting;
exports.listChats = listChats;
exports.listChatMessages = listChatMessages;
exports.sendChatMessage = sendChatMessage;
exports.streamChatMessage = streamChatMessage;
exports.updateChat = updateChat;
exports.recordActivity = recordActivity;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const activity_signal_service_1 = require("../services/activity-signal.service");
const daily_observation_service_1 = require("../services/daily-observation.service");
const rewind_chat_service_1 = require("../services/rewind-chat.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const CHAT_MESSAGES_PER_MINUTE = 12;
function isRewindPersonaId(value) {
    return (value === "ariel" ||
        value === "ella" ||
        value === "jake" ||
        value === "lyra" ||
        value === "tobi" ||
        value === "neeja");
}
async function getUserTimezone(userId) {
    const user = await db_config_1.prisma.user.findUnique({
        select: { timezone: true },
        where: { id: userId },
    });
    return user?.timezone ?? "UTC";
}
function handleIntelligenceError(error, operation, req, res) {
    if (error instanceof rewind_chat_service_1.RewindChatError) {
        res.status(error.status).json({ code: error.code, msg: error.message });
        return;
    }
    if (error instanceof daily_observation_service_1.DailyObservationError) {
        res.status(error.status).json({ code: error.code, msg: error.message });
        return;
    }
    logger_util_1.default.error(`Rewind intelligence ${operation} error`, {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : "UnknownError",
        userId: req.userId,
    });
    res.status(500).json({ msg: "Rewind is unavailable right now" });
}
async function listObservations(req, res) {
    try {
        const userId = req.userId;
        const timezone = await getUserTimezone(userId);
        const result = await (0, daily_observation_service_1.listDailyObservations)({
            cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
            limit: Number(req.query.limit ?? 20),
            timezone,
            userId,
        });
        res.json({ data: result, msg: "Rewind observations retrieved" });
    }
    catch (error) {
        handleIntelligenceError(error, "list observations", req, res);
    }
}
async function getObservation(req, res) {
    try {
        const observation = await (0, daily_observation_service_1.getDailyObservation)(req.userId, String(req.params.observationId));
        if (!observation) {
            res.status(404).json({ msg: "Observation not found" });
            return;
        }
        res.json({ data: observation, msg: "Rewind observation retrieved" });
    }
    catch (error) {
        handleIntelligenceError(error, "get observation", req, res);
    }
}
async function dismissObservation(req, res) {
    try {
        const dismissed = await (0, daily_observation_service_1.dismissDailyObservation)(req.userId, String(req.params.observationId));
        if (!dismissed) {
            res.status(404).json({ msg: "Observation not found" });
            return;
        }
        res.json({ msg: "Observation dismissed" });
    }
    catch (error) {
        handleIntelligenceError(error, "dismiss observation", req, res);
    }
}
async function getHomeGreeting(req, res) {
    try {
        const userId = req.userId;
        const user = await db_config_1.prisma.user.findUnique({
            select: {
                rewindPersona: true,
                rewindPersonalizationEnabled: true,
            },
            where: { id: userId },
        });
        if (!user?.rewindPersonalizationEnabled) {
            res.json({ data: null, msg: "Generic greeting preferred" });
            return;
        }
        if (!isRewindPersonaId(user.rewindPersona)) {
            res.json({ data: null, msg: "No Rewind partner selected" });
            return;
        }
        const personaId = user.rewindPersona;
        await (0, rewind_chat_service_1.ensureDefaultRewindChats)(userId);
        const chat = await db_config_1.prisma.rewindChat.findFirst({
            select: {
                id: true,
                messages: {
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                    select: {
                        content: true,
                        id: true,
                        localDateKey: true,
                    },
                    take: 1,
                    where: {
                        personaId,
                        role: client_1.RewindChatMessageRole.PARTNER,
                    },
                },
            },
            where: {
                archivedAt: null,
                threadKey: `partner:${personaId}`,
                userId,
            },
        });
        if (!chat) {
            res.json({ data: null, msg: "Partner chat unavailable" });
            return;
        }
        const message = chat.messages[0] ?? null;
        res.json({
            data: {
                chatId: chat.id,
                date: message?.localDateKey ?? null,
                message: message?.content ?? null,
                messageId: message?.id ?? null,
                personaId,
                sourceTypes: [],
                title: "",
            },
            msg: message
                ? "Latest partner message retrieved"
                : "Partner chat has no messages yet",
        });
    }
    catch (error) {
        handleIntelligenceError(error, "get home greeting", req, res);
    }
}
async function listChats(req, res) {
    try {
        const chats = await (0, rewind_chat_service_1.ensureDefaultRewindChats)(req.userId);
        res.json({ data: { chats }, msg: "Rewind chats retrieved" });
    }
    catch (error) {
        handleIntelligenceError(error, "list chats", req, res);
    }
}
async function listChatMessages(req, res) {
    try {
        const result = await (0, rewind_chat_service_1.listRewindChatMessages)({
            chatId: String(req.params.chatId),
            cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
            limit: Number(req.query.limit ?? 30),
            userId: req.userId,
        });
        res.json({ data: result, msg: "Rewind chat messages retrieved" });
    }
    catch (error) {
        handleIntelligenceError(error, "list chat messages", req, res);
    }
}
async function sendChatMessage(req, res) {
    try {
        const userId = req.userId;
        const chatId = String(req.params.chatId);
        const idempotencyKey = String(req.body.idempotencyKey);
        const storedIdempotencyKey = (0, rewind_chat_service_1.getRewindChatMessageIdempotencyKey)(userId, chatId, idempotencyKey);
        const existingMessage = await db_config_1.prisma.rewindChatMessage.findFirst({
            select: { id: true },
            where: { idempotencyKey: storedIdempotencyKey, userId },
        });
        if (!existingMessage) {
            const recentMessageCount = await db_config_1.prisma.rewindChatMessage.count({
                where: {
                    createdAt: { gte: new Date(Date.now() - 60000) },
                    role: client_1.RewindChatMessageRole.USER,
                    userId,
                },
            });
            if (recentMessageCount >= CHAT_MESSAGES_PER_MINUTE) {
                res.status(429).json({
                    code: "REWIND_CHAT_RATE_LIMITED",
                    msg: "Give your Rewind partners a moment before sending more",
                });
                return;
            }
        }
        const timezone = await getUserTimezone(userId);
        const result = await (0, rewind_chat_service_1.sendRewindChatMessage)({
            chatId,
            content: String(req.body.content),
            idempotencyKey,
            timezone,
            userId,
        });
        res.status(201).json({ data: result, msg: "Rewind reply ready" });
    }
    catch (error) {
        handleIntelligenceError(error, "send chat message", req, res);
    }
}
async function streamChatMessage(req, res) {
    const writeEvent = (event) => {
        if (!res.writableEnded && !res.destroyed) {
            res.write(`${JSON.stringify(event)}\n`);
        }
    };
    try {
        const userId = req.userId;
        const chatId = String(req.params.chatId);
        const idempotencyKey = String(req.body.idempotencyKey);
        const storedIdempotencyKey = (0, rewind_chat_service_1.getRewindChatMessageIdempotencyKey)(userId, chatId, idempotencyKey);
        const existingMessage = await db_config_1.prisma.rewindChatMessage.findFirst({
            select: { id: true },
            where: { idempotencyKey: storedIdempotencyKey, userId },
        });
        if (!existingMessage) {
            const recentMessageCount = await db_config_1.prisma.rewindChatMessage.count({
                where: {
                    createdAt: { gte: new Date(Date.now() - 60000) },
                    role: client_1.RewindChatMessageRole.USER,
                    userId,
                },
            });
            if (recentMessageCount >= CHAT_MESSAGES_PER_MINUTE) {
                res.status(429).json({
                    code: "REWIND_CHAT_RATE_LIMITED",
                    msg: "Give your Rewind partners a moment before sending more",
                });
                return;
            }
        }
        res.status(200);
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        const timezone = await getUserTimezone(userId);
        await (0, rewind_chat_service_1.streamRewindChatMessage)({
            chatId,
            content: String(req.body.content),
            idempotencyKey,
            onEvent: writeEvent,
            timezone,
            userId,
        });
        if (!res.writableEnded)
            res.end();
    }
    catch (error) {
        logger_util_1.default.error("Rewind intelligence stream chat message error", {
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        if (!res.headersSent) {
            handleIntelligenceError(error, "stream chat message", req, res);
            return;
        }
        writeEvent({
            code: error instanceof rewind_chat_service_1.RewindChatError ? error.code : "CHAT_STREAM_FAILED",
            message: error instanceof rewind_chat_service_1.RewindChatError
                ? error.message
                : "The conversation paused. Try sending that again.",
            type: "error",
        });
        if (!res.writableEnded)
            res.end();
    }
}
async function updateChat(req, res) {
    try {
        const updated = await (0, rewind_chat_service_1.setRewindChatArchived)({
            archived: Boolean(req.body.archived),
            chatId: String(req.params.chatId),
            userId: req.userId,
        });
        if (!updated) {
            res.status(404).json({ msg: "Chat not found" });
            return;
        }
        res.json({ msg: req.body.archived ? "Chat archived" : "Chat restored" });
    }
    catch (error) {
        handleIntelligenceError(error, "update chat", req, res);
    }
}
async function recordActivity(req, res) {
    try {
        const userId = req.userId;
        const timezone = await getUserTimezone(userId);
        const happenedAt = req.body.happenedAt
            ? luxon_1.DateTime.fromISO(String(req.body.happenedAt)).toJSDate()
            : new Date();
        await (0, activity_signal_service_1.recordActivitySignal)({
            dedupeKey: `client:${req.body.eventType}:${req.body.sourceId}`,
            description: String(req.body.description),
            eventType: String(req.body.eventType),
            happenedAt,
            sourceId: String(req.body.sourceId),
            sourceType: client_1.ActivitySignalSourceType.FLEXX,
            timezone,
            userId,
        });
        res.status(202).json({ msg: "Activity recorded" });
    }
    catch (error) {
        handleIntelligenceError(error, "record activity", req, res);
    }
}
