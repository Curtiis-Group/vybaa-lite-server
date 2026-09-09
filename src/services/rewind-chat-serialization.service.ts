import type {
  RewindChat,
  RewindChatMessage,
  RewindChatReaction,
  RewindChatTurn,
} from "@prisma/client";
import { resolveRewindConversationMood } from "./rewind-chat-mood";

type RewindChatMessageSource = Pick<
  RewindChatMessage,
  | "content"
  | "createdAt"
  | "deliveredAt"
  | "id"
  | "localDateKey"
  | "mentions"
  | "personaId"
  | "replyToMessageId"
  | "role"
  | "runId"
  | "seenAt"
  | "turnId"
>;

type RewindChatReactionSource = Pick<
  RewindChatReaction,
  "actor" | "kind" | "personaId"
>;

type RewindChatMessageWithReactions = RewindChatMessageSource & {
  reactions?: RewindChatReactionSource[];
};

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
  conversationMood?: RewindChat["conversationMood"];
  messages: RewindChatMessageWithReactions[];
  turns: Array<Pick<RewindChatTurn, "personaId">>;
};

export type SerializedRewindChatReaction = {
  actor: RewindChatReactionSource["actor"];
  kind: RewindChatReactionSource["kind"];
  personaId: string | null;
};

export function serializeRewindChatReaction(
  reaction: RewindChatReactionSource,
): SerializedRewindChatReaction {
  return {
    actor: reaction.actor,
    kind: reaction.kind,
    personaId: reaction.personaId,
  };
}

export function serializeRewindChatMessage(
  message: RewindChatMessageWithReactions,
) {
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

export type SerializedRewindChatMessage = ReturnType<
  typeof serializeRewindChatMessage
>;

export function serializeRewindChatSummary(chat: RewindChatSummarySource) {
  return {
    activeParticipants: chat.turns.map((turn) => turn.personaId),
    archivedAt: chat.archivedAt?.toISOString() ?? null,
    contextRevision: chat.contextRevision,
    conversationMood: resolveRewindConversationMood(chat.conversationMood),
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
