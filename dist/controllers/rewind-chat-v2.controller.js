"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsage = getUsage;
exports.listChats = listChats;
exports.listMessages = listMessages;
exports.enqueueMessage = enqueueMessage;
exports.markRead = markRead;
exports.updatePreferences = updatePreferences;
exports.getLiveState = getLiveState;
const client_1 = require("@prisma/client");
const db_config_1 = require("../config/db.config");
const rewind_chat_v2_service_1 = require("../services/rewind-chat-v2.service");
const rewind_chat_serialization_service_1 = require("../services/rewind-chat-serialization.service");
const rewind_chat_service_1 = require("../services/rewind-chat.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function getErrorDetails(error) {
    if (error instanceof Error) {
        return {
            errorMessage: error.message,
            errorName: error.name,
            ...(error.stack ? { errorStack: error.stack } : {}),
        };
    }
    return {
        errorMessage: String(error),
        errorName: "UnknownError",
    };
}
function handleError(error, res, req) {
    const details = getErrorDetails(error);
    const requestContext = {
        chatId: typeof req.params.chatId === "string" ? req.params.chatId : undefined,
        httpMethod: req.method,
        httpPath: req.originalUrl,
        userId: req.userId,
    };
    if (error instanceof rewind_chat_v2_service_1.RewindV2ChatError) {
        logger_util_1.default.warn("Rewind v2 chat request rejected", {
            ...details,
            ...requestContext,
            reasonCode: error.code,
            statusCode: error.status,
        });
        res.status(error.status).json({ code: error.code, msg: error.message });
        return;
    }
    logger_util_1.default.error("Rewind v2 chat request failed", {
        ...details,
        ...requestContext,
        statusCode: 500,
    });
    res.status(500).json({
        code: "REWIND_CHAT_FAILED",
        msg: "Rewind chat is unavailable right now",
    });
}
async function getOwnedChat(chatId, userId) {
    const chat = await db_config_1.prisma.rewindChat.findFirst({
        where: { id: chatId, userId },
    });
    if (!chat)
        throw new rewind_chat_v2_service_1.RewindV2ChatError("CHAT_NOT_FOUND", "Chat not found", 404);
    return chat;
}
async function getUsage(req, res) {
    try {
        const userId = req.userId;
        const [totals, entries] = await Promise.all([
            db_config_1.prisma.aiUsageLedger.aggregate({
                _sum: {
                    estimatedCostUsd: true,
                    inputTokens: true,
                    outputTokens: true,
                    totalTokens: true,
                },
                where: { userId },
            }),
            db_config_1.prisma.aiUsageLedger.findMany({
                orderBy: { createdAt: "desc" },
                take: 50,
                where: { userId },
            }),
        ]);
        res.json({
            data: {
                entries: entries.map((entry) => ({
                    costUsd: entry.estimatedCostUsd,
                    createdAt: entry.createdAt.toISOString(),
                    id: entry.id,
                    inputTokens: entry.inputTokens,
                    model: entry.model,
                    operation: entry.operation,
                    outputTokens: entry.outputTokens,
                    runId: entry.runId,
                    totalTokens: entry.totalTokens,
                    turnId: entry.turnId,
                })),
                totals: {
                    estimatedCostUsd: totals._sum.estimatedCostUsd ?? 0,
                    inputTokens: totals._sum.inputTokens ?? 0,
                    outputTokens: totals._sum.outputTokens ?? 0,
                    totalTokens: totals._sum.totalTokens ?? 0,
                },
            },
            msg: "AI usage retrieved",
        });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
async function listChats(req, res) {
    try {
        await (0, rewind_chat_service_1.ensureDefaultRewindChats)(req.userId);
        const chats = await db_config_1.prisma.rewindChat.findMany({
            include: {
                messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
                turns: {
                    where: { status: client_1.RewindChatTurnStatus.GENERATING },
                    select: { personaId: true },
                },
            },
            orderBy: [{ lastMessageAt: "desc" }, { createdAt: "asc" }],
            where: { archivedAt: null, userId: req.userId },
        });
        await Promise.all(chats.map((chat) => (0, rewind_chat_v2_service_1.ensureRewindPartnerMinds)(chat.id, req.userId, chat.type, chat.personaId)));
        res.json({
            data: {
                chats: chats.map(rewind_chat_serialization_service_1.serializeRewindChatSummary),
            },
            msg: "Rewind chats retrieved",
        });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
async function listMessages(req, res) {
    try {
        const chat = await getOwnedChat(String(req.params.chatId), req.userId);
        const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
        const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 30)));
        const rows = await db_config_1.prisma.rewindChatMessage.findMany({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            take: limit + 1,
            where: { chatId: chat.id, userId: req.userId },
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const activeTurns = await db_config_1.prisma.rewindChatTurn.findMany({
            select: { id: true, personaId: true, runId: true, status: true },
            where: {
                chatId: chat.id,
                status: {
                    in: [client_1.RewindChatTurnStatus.PLANNED, client_1.RewindChatTurnStatus.GENERATING],
                },
            },
        });
        res.json({
            data: {
                activeTurns,
                chat: {
                    contextRevision: chat.contextRevision,
                    id: chat.id,
                    proactiveMuted: chat.proactiveMuted,
                    unreadCount: chat.unreadCount,
                },
                items: [...page].reverse().map(rewind_chat_serialization_service_1.serializeRewindChatMessage),
                nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
            },
            msg: "Rewind chat messages retrieved",
        });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
async function enqueueMessage(req, res) {
    try {
        const userId = req.userId;
        const user = await db_config_1.prisma.user.findUnique({
            select: { timezone: true },
            where: { id: userId },
        });
        const result = await (0, rewind_chat_v2_service_1.enqueueRewindChatMessage)({
            chatId: String(req.params.chatId),
            content: String(req.body.content),
            idempotencyKey: String(req.body.idempotencyKey),
            timezone: user?.timezone ?? "UTC",
            userId,
        });
        res.status(202).json({ data: result, msg: "Message queued" });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
async function markRead(req, res) {
    try {
        const chat = await getOwnedChat(String(req.params.chatId), req.userId);
        const message = await db_config_1.prisma.rewindChatMessage.findFirst({
            where: {
                chatId: chat.id,
                id: String(req.body.throughMessageId),
                userId: req.userId,
            },
        });
        if (!message)
            throw new rewind_chat_v2_service_1.RewindV2ChatError("MESSAGE_NOT_FOUND", "Message not found", 404);
        await db_config_1.prisma.rewindChat.update({
            data: { lastReadAt: message.createdAt, unreadCount: 0 },
            where: { id: chat.id },
        });
        res.json({
            data: { lastReadAt: message.createdAt.toISOString(), unreadCount: 0 },
            msg: "Chat marked as read",
        });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
async function updatePreferences(req, res) {
    try {
        const chat = await getOwnedChat(String(req.params.chatId), req.userId);
        const updated = await db_config_1.prisma.rewindChat.update({
            data: { proactiveMuted: Boolean(req.body.proactiveMuted) },
            where: { id: chat.id },
        });
        res.json({
            data: { proactiveMuted: updated.proactiveMuted },
            msg: "Chat preferences updated",
        });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
async function getLiveState(req, res) {
    try {
        const chat = await getOwnedChat(String(req.params.chatId), req.userId);
        const runs = await db_config_1.prisma.rewindChatRun.findMany({
            orderBy: { createdAt: "desc" },
            take: 3,
            where: {
                chatId: chat.id,
                status: {
                    in: [
                        client_1.RewindChatRunStatus.QUEUED,
                        client_1.RewindChatRunStatus.PLANNING,
                        client_1.RewindChatRunStatus.GENERATING,
                    ],
                },
            },
            include: {
                turns: {
                    where: {
                        status: {
                            in: [
                                client_1.RewindChatTurnStatus.PLANNED,
                                client_1.RewindChatTurnStatus.GENERATING,
                            ],
                        },
                    },
                    select: { id: true, personaId: true, runId: true, status: true },
                },
            },
        });
        res.json({ data: { runs }, msg: "Rewind chat live state retrieved" });
    }
    catch (error) {
        handleError(error, res, req);
    }
}
