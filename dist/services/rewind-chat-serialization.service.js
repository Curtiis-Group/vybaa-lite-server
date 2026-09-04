"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeRewindChatMessage = serializeRewindChatMessage;
exports.serializeRewindChatSummary = serializeRewindChatSummary;
function serializeRewindChatMessage(message) {
    return {
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        id: message.id,
        localDateKey: message.localDateKey,
        mentions: message.mentions,
        personaId: message.personaId,
        replyToMessageId: message.replyToMessageId,
        role: message.role,
        runId: message.runId,
        turnId: message.turnId,
    };
}
function serializeRewindChatSummary(chat) {
    return {
        activeParticipants: chat.turns.map((turn) => turn.personaId),
        archivedAt: chat.archivedAt?.toISOString() ?? null,
        contextRevision: chat.contextRevision,
        createdAt: chat.createdAt.toISOString(),
        id: chat.id,
        lastMessage: chat.messages[0]
            ? serializeRewindChatMessage(chat.messages[0])
            : null,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        personaId: chat.personaId,
        proactiveMuted: chat.proactiveMuted,
        threadKey: chat.threadKey,
        title: chat.title,
        type: chat.type,
        unreadCount: chat.unreadCount,
        updatedAt: chat.updatedAt.toISOString(),
    };
}
