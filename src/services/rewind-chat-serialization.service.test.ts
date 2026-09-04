import assert from "node:assert/strict";
import test from "node:test";
import {
  RewindChatMessageRole,
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
      | "id"
      | "localDateKey"
      | "mentions"
      | "personaId"
      | "replyToMessageId"
      | "role"
      | "runId"
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
  const message = serializeRewindChatMessage({
    content: "I hear you.",
    createdAt,
    id: "message-1",
    localDateKey: "2026-09-04",
    mentions: [],
    personaId: "ella",
    replyToMessageId: null,
    role: RewindChatMessageRole.PARTNER,
    runId: "run-1",
    turnId: "turn-1",
  });

  assert.equal(message.runId, "run-1");
  assert.equal(message.turnId, "turn-1");
});
