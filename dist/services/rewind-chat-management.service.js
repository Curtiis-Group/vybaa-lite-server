"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renameRewindGroupChat = renameRewindGroupChat;
exports.deleteRewindChatMessages = deleteRewindChatMessages;
const client_1 = require("@prisma/client");
const node_crypto_1 = require("node:crypto");
const db_config_1 = require("../config/db.config");
const rewind_chat_realtime_service_1 = require("./rewind-chat-realtime.service");
const rewind_chat_v2_service_1 = require("./rewind-chat-v2.service");
const ACTIVE_RUN_STATUSES = [
    client_1.RewindChatRunStatus.QUEUED,
    client_1.RewindChatRunStatus.PLANNING,
    client_1.RewindChatRunStatus.GENERATING,
];
const ACTIVE_TURN_STATUSES = [
    client_1.RewindChatTurnStatus.PLANNED,
    client_1.RewindChatTurnStatus.GENERATING,
];
async function publishInvalidation(params) {
    await Promise.all([
        ...params.turns.map((turn) => (0, rewind_chat_realtime_service_1.publishRewindChatEvent)(params.userId, {
            chatId: params.chatId,
            personaId: turn.personaId,
            runId: turn.runId,
            turnId: turn.turnId,
            type: "typing_stopped",
        })),
        ...params.runIds.map((runId) => (0, rewind_chat_realtime_service_1.publishRewindChatEvent)(params.userId, {
            chatId: params.chatId,
            runId,
            status: client_1.RewindChatRunStatus.CANCELLED,
            type: "run_state",
        })),
    ]);
    await (0, rewind_chat_realtime_service_1.publishRewindChatEvent)(params.userId, {
        chatId: params.chatId,
        runId: `management:${(0, node_crypto_1.randomUUID)()}`,
        type: "chat_invalidated",
    });
}
async function renameRewindGroupChat(params) {
    const chat = await db_config_1.prisma.rewindChat.findFirst({
        select: { id: true, type: true },
        where: { id: params.chatId, userId: params.userId },
    });
    if (!chat) {
        throw new rewind_chat_v2_service_1.RewindV2ChatError("CHAT_NOT_FOUND", "Chat not found", 404);
    }
    if (chat.type !== client_1.RewindChatType.GROUP) {
        throw new rewind_chat_v2_service_1.RewindV2ChatError("CHAT_TITLE_LOCKED", "Only the group chat name can be changed", 400);
    }
    const updated = await db_config_1.prisma.rewindChat.update({
        data: { title: params.title },
        select: { title: true },
        where: { id: chat.id },
    });
    await (0, rewind_chat_realtime_service_1.publishRewindChatEvent)(params.userId, {
        chatId: chat.id,
        runId: `management:${(0, node_crypto_1.randomUUID)()}`,
        type: "chat_invalidated",
    });
    return updated;
}
async function deleteRewindChatMessages(params) {
    const now = new Date();
    const result = await db_config_1.prisma.$transaction(async (tx) => {
        const chat = await tx.rewindChat.findFirst({
            select: { id: true, lastReadAt: true },
            where: { id: params.chatId, userId: params.userId },
        });
        if (!chat) {
            throw new rewind_chat_v2_service_1.RewindV2ChatError("CHAT_NOT_FOUND", "Chat not found", 404);
        }
        if (params.messageId) {
            const message = await tx.rewindChatMessage.findFirst({
                select: { id: true },
                where: {
                    chatId: chat.id,
                    id: params.messageId,
                    userId: params.userId,
                },
            });
            if (!message) {
                throw new rewind_chat_v2_service_1.RewindV2ChatError("MESSAGE_NOT_FOUND", "Message not found", 404);
            }
        }
        const [activeRuns, activeTurns] = await Promise.all([
            tx.rewindChatRun.findMany({
                select: { id: true },
                where: { chatId: chat.id, status: { in: ACTIVE_RUN_STATUSES } },
            }),
            tx.rewindChatTurn.findMany({
                select: { id: true, personaId: true, runId: true },
                where: { chatId: chat.id, status: { in: ACTIVE_TURN_STATUSES } },
            }),
        ]);
        await tx.rewindChatTurn.updateMany({
            data: { cancelledAt: now, status: client_1.RewindChatTurnStatus.CANCELLED },
            where: { chatId: chat.id, status: { in: ACTIVE_TURN_STATUSES } },
        });
        await tx.rewindChatRun.updateMany({
            data: { cancelledAt: now, status: client_1.RewindChatRunStatus.CANCELLED },
            where: { chatId: chat.id, status: { in: ACTIVE_RUN_STATUSES } },
        });
        const deleted = await tx.rewindChatMessage.deleteMany({
            where: {
                chatId: chat.id,
                userId: params.userId,
                ...(params.messageId ? { id: params.messageId } : {}),
            },
        });
        const latestMessage = await tx.rewindChatMessage.findFirst({
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { createdAt: true },
            where: { chatId: chat.id },
        });
        const unreadCount = chat.lastReadAt
            ? await tx.rewindChatMessage.count({
                where: {
                    chatId: chat.id,
                    createdAt: { gt: chat.lastReadAt },
                    role: client_1.RewindChatMessageRole.PARTNER,
                },
            })
            : await tx.rewindChatMessage.count({
                where: { chatId: chat.id, role: client_1.RewindChatMessageRole.PARTNER },
            });
        const updatedChat = await tx.rewindChat.update({
            data: {
                contextRevision: { increment: 1 },
                contextSummary: null,
                contextSummaryThroughMessageId: null,
                contextSummaryUpdatedAt: null,
                lastMessageAt: latestMessage?.createdAt ?? null,
                ...(params.messageId
                    ? { unreadCount }
                    : { lastReadAt: null, unreadCount: 0 }),
            },
            select: { contextRevision: true },
            where: { id: chat.id },
        });
        await tx.rewindPartnerMind.updateMany({
            data: {
                confidence: null,
                contextRevision: updatedChat.contextRevision,
                intentSummary: null,
                state: client_1.RewindPartnerMindState.WATCHING,
            },
            where: { chatId: chat.id, userId: params.userId },
        });
        return {
            deletedCount: deleted.count,
            runIds: activeRuns.map((run) => run.id),
            turns: activeTurns.map((turn) => ({
                personaId: turn.personaId,
                runId: turn.runId,
                turnId: turn.id,
            })),
        };
    });
    await publishInvalidation({
        chatId: params.chatId,
        runIds: result.runIds,
        turns: result.turns,
        userId: params.userId,
    });
    return { deletedCount: result.deletedCount };
}
