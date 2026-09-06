"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeRewindChatReaction = serializeRewindChatReaction;
exports.serializeRewindChatMessage = serializeRewindChatMessage;
exports.serializeRewindChatSummary = serializeRewindChatSummary;
function serializeRewindChatReaction(reaction) {
    return {
        actor: reaction.actor,
        kind: reaction.kind,
        personaId: reaction.personaId,
    };
}
function serializeRewindChatMessage(message) {
    return {
        content: message.content,
        createdAt: message.createdAt.toISOString(),
        deliveredAt: message.deliveredAt?.toISOString() ?? null,
        id: message.id,
        localDateKey: message.localDateKey,
        mentions: message.mentions,
        personaId: message.personaId,
        reactions: (message.reactions ?? []).map(serializeRewindChatReaction),
        replyToMessageId: message.replyToMessageId,
        role: message.role,
        runId: message.runId,
        seenAt: message.seenAt?.toISOString() ?? null,
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
