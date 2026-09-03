import assert from "node:assert/strict";
import test from "node:test";

import {
  extractRewindMentions,
  getRewindChatMessageIdempotencyKey,
} from "./rewind-chat.service";

test("Rewind group chat recognizes explicit partner mentions", () => {
  assert.deepEqual(
    extractRewindMentions("@Ella, can you help me unpack this?"),
    ["ella"],
  );
  assert.deepEqual(extractRewindMentions("Could @jake and @Lyra weigh in?"), [
    "lyra",
    "jake",
  ]);
  assert.deepEqual(extractRewindMentions("I spoke with Ellaine today"), []);
});

test("Rewind chat idempotency is scoped to a user and thread", () => {
  assert.equal(
    getRewindChatMessageIdempotencyKey("user-1", "chat-2", "request-3"),
    "user-1:chat-2:request-3",
  );
});
