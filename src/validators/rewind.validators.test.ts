import assert from "node:assert/strict";
import test from "node:test";

import {
  rewindV2ReactionSchema,
  sendRewindChatMessageSchema,
} from "./rewind.validators";

test("Rewind v2 chat accepts a bounded optional reply target", () => {
  const base = {
    content: "I meant this part.",
    idempotencyKey: "message-key-123",
  };

  assert.equal(
    sendRewindChatMessageSchema.safeParse({
      ...base,
      replyToMessageId: "message-1",
    }).success,
    true,
  );
  assert.equal(
    sendRewindChatMessageSchema.safeParse({
      ...base,
      replyToMessageId: null,
    }).success,
    true,
  );
  assert.equal(
    sendRewindChatMessageSchema.safeParse({
      ...base,
      replyToMessageId: " ",
    }).success,
    false,
  );
});

test("Rewind v2 chat allows exactly four reaction kinds or removal", () => {
  for (const reaction of ["LOVE", "LAUGH", "CRY", "LIKE", null]) {
    assert.equal(rewindV2ReactionSchema.safeParse({ reaction }).success, true);
  }
  for (const reaction of ["FIRE", "ANGRY", "", 1, undefined]) {
    assert.equal(rewindV2ReactionSchema.safeParse({ reaction }).success, false);
  }
});
