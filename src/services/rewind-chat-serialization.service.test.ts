import assert from "node:assert/strict";
import test from "node:test";
import {
  RewindChatMessageRole,
  RewindChatReactionActor,
  RewindChatReactionKind,
  RewindChatType,
  type RewindChat,
  type RewindChatMessage,
  type RewindChatTurn,
} from "@prisma/client";

import {
  serializeRewindChatMessage,
  serializeRewindChatSummary,
} from "./rewind-chat-serialization.service";

type SummarySource = Pick<
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
  messages: Array<
    Pick<
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
    >
  >;
  turns: Array<Pick<RewindChatTurn, "personaId">>;
};

function createPartnerChat(personaId: string): SummarySource {
  const createdAt = new Date("2026-09-04T08:00:00.000Z");
  return {
    archivedAt: null,
    contextRevision: 2,
    createdAt,
    id: `chat-${personaId}`,
    lastMessageAt: null,
    messages: [],
    personaId,
    proactiveMuted: false,
    threadKey: `partner:${personaId}`,
    title: personaId,
    turns: [],
    type: RewindChatType.PARTNER,
    unreadCount: 0,
    updatedAt: createdAt,
  };
}

test("v2 chat summaries preserve each direct partner identity", () => {
  const personaIds = ["ella", "lyra", "jake", "ariel"];
  const summaries = personaIds.map((personaId) =>
    serializeRewindChatSummary(createPartnerChat(personaId)),
  );

  assert.deepEqual(
    summaries.map((summary) => summary.personaId),
    personaIds,
  );
  assert.deepEqual(
    summaries.map((summary) => summary.threadKey),
    personaIds.map((personaId) => `partner:${personaId}`),
  );
});

test("serialized messages retain their run and turn identity", () => {
  const createdAt = new Date("2026-09-04T08:00:00.000Z");
  const deliveredAt = new Date("2026-09-04T08:00:01.000Z");
  const seenAt = new Date("2026-09-04T08:00:03.000Z");
  const message = serializeRewindChatMessage({
    content: "I hear you.",
    createdAt,
    deliveredAt,
    id: "message-1",
    localDateKey: "2026-09-04",
    mentions: [],
    personaId: "ella",
    replyToMessageId: null,
    role: RewindChatMessageRole.PARTNER,
    runId: "run-1",
    seenAt,
    turnId: "turn-1",
  });

  assert.equal(message.runId, "run-1");
  assert.equal(message.deliveredAt, deliveredAt.toISOString());
  assert.equal(message.seenAt, seenAt.toISOString());
  assert.equal(message.turnId, "turn-1");
  assert.deepEqual(message.reactions, []);
});

test("serialized messages include user and partner reactions", () => {
  const createdAt = new Date("2026-09-05T08:00:00.000Z");
  const message = serializeRewindChatMessage({
    content: "fr 😂",
    createdAt,
    deliveredAt: null,
    id: "message-reacted",
    localDateKey: "2026-09-05",
    mentions: [],
    personaId: "jake",
    reactions: [
      {
        actor: RewindChatReactionActor.USER,
        kind: RewindChatReactionKind.LAUGH,
        personaId: null,
      },
      {
        actor: RewindChatReactionActor.PARTNER,
        kind: RewindChatReactionKind.LIKE,
        personaId: "lyra",
      },
    ],
    replyToMessageId: null,
    role: RewindChatMessageRole.PARTNER,
    runId: "run-2",
    seenAt: null,
    turnId: "turn-2",
  });

  assert.deepEqual(message.reactions, [
    { actor: "USER", kind: "LAUGH", personaId: null },
    { actor: "PARTNER", kind: "LIKE", personaId: "lyra" },
  ]);
});
