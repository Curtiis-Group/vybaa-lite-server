import assert from "node:assert/strict";
import test from "node:test";
import { RewindChatType } from "@prisma/client";

import {
  extractRewindMentions,
  getRewindChatMessageIdempotencyKey,
  selectRewindReplyPersonas,
} from "./rewind-chat.service";
import { resolveRewindDirectorDecision } from "./rewind-chat-v2.service";

test("Rewind group chat recognizes explicit partner mentions", () => {
  assert.deepEqual(
    extractRewindMentions("@Ella, can you help me unpack this?"),
    ["ella"],
  );
  assert.deepEqual(extractRewindMentions("Could @jake and @Lyra weigh in?"), [
    "lyra",
    "jake",
  ]);
  assert.deepEqual(extractRewindMentions("@Tobi ask @neeja too"), [
    "tobi",
    "neeja",
  ]);
  assert.deepEqual(extractRewindMentions("I spoke with Ellaine today"), []);
});

test("Rewind chat idempotency is scoped to a user and thread", () => {
  assert.equal(
    getRewindChatMessageIdempotencyKey("user-1", "chat-2", "request-3"),
    "user-1:chat-2:request-3",
  );
});

test("group chats invite multiple unique partners while direct chats stay focused", () => {
  const groupPersonas = selectRewindReplyPersonas({
    chatType: RewindChatType.GROUP,
    content: "I am not sure what to do next",
    mentions: ["ella"],
  });
  assert.equal(groupPersonas[0], "ella");
  assert.equal(groupPersonas.length, 2);
  assert.equal(new Set(groupPersonas).size, groupPersonas.length);

  assert.deepEqual(
    selectRewindReplyPersonas({
      chatPersonaId: "jake",
      chatType: RewindChatType.PARTNER,
      content: "Help me think",
      mentions: [],
    }),
    ["jake"],
  );
});

test("v2 group direction does not require a mention to answer", () => {
  const decision = resolveRewindDirectorDecision({
    allowed: ["ella", "lyra", "jake", "ariel"],
    decision: { nextConsiderInMinutes: 90, reactions: [], turns: [] },
    mentions: [],
    minimumTurns: 1,
    roomEnergy: [
      { energy: 24, personaId: "ella" },
      { energy: 91, personaId: "lyra" },
      { energy: 52, personaId: "jake" },
      { energy: 10, personaId: "ariel" },
    ],
  });

  assert.equal(decision.turns.length, 1);
  assert.equal(decision.turns[0]?.personaId, "lyra");
});

test("v2 group direction uses a mention as a preference, not a gate", () => {
  const decision = resolveRewindDirectorDecision({
    allowed: ["ella", "lyra", "jake", "ariel"],
    decision: { nextConsiderInMinutes: 90, reactions: [], turns: [] },
    mentions: ["jake"],
    minimumTurns: 1,
    roomEnergy: [
      { energy: 99, personaId: "ella" },
      { energy: 12, personaId: "jake" },
    ],
  });

  assert.equal(decision.turns[0]?.personaId, "jake");
});
