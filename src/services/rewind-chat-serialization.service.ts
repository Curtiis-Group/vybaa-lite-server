import type {
  RewindChat,
  RewindChatMessage,
  RewindChatTurn,
} from "@prisma/client";

type RewindChatMessageSource = Pick<
  RewindChatMessage,
  | "content"
  | "createdAt"
  | "id"
  | "localDateKey"
  | "mentions"
  | "personaId"
  | "replyToMessageId"
  | "role"
  | "runId"
  | "turnId"
>;

type RewindChatSummarySource = Pick<
  RewindChat,
  | "archivedAt"
  | "contextRevision"
  | "createdAt"
  | "id"
  | "lastMessageAt"
  | "personaId"
  | "proactiveMuted"
  | "threadKey"
  | "title"
  | "type"
  | "unreadCount"
  | "updatedAt"
> & {
  messages: RewindChatMessageSource[];
  turns: Array<Pick<RewindChatTurn, "personaId">>;
};

export function serializeRewindChatMessage(message: RewindChatMessageSource) {
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

export type SerializedRewindChatMessage = ReturnType<
  typeof serializeRewindChatMessage
>;

export function serializeRewindChatSummary(chat: RewindChatSummarySource) {
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
