import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  buildOpeningPrompt,
  buildResumePrompt,
  createRewindWsToken,
  verifyRewindWsToken,
} from "./rewind.controller";

process.env.JWT_SECRET = "test-secret-that-is-not-a-production-default";

test("opening is relaxed and does not require a scripted question", () => {
  const prompt = buildOpeningPrompt("ella", { shouldIntroduce: true });
  assert.match(prompt, /relaxed/i);
  assert.match(prompt, /low-pressure/i);
  assert.doesNotMatch(prompt, /exactly two/i);
  assert.doesNotMatch(prompt, /ask exactly/i);
});

test("resume forbids invented context and limits follow-up questions", () => {
  const prompt = buildResumePrompt();
  assert.match(prompt, /without inventing details/i);
  assert.match(prompt, /at most one natural follow-up/i);
});

test("Rewind token is audience-bound and single use", () => {
  const token = createRewindWsToken("user-1", "ella", "session-1");
  const verified = verifyRewindWsToken(token);
  assert.equal(verified?.userId, "user-1");
  assert.equal(verifyRewindWsToken(token), null);
});

test("Rewind rejects a token with the wrong audience", () => {
  const token = jwt.sign(
    { userId: "user-1", personaId: "ella", type: "rewind_ws" },
    process.env.JWT_SECRET!,
    { audience: "wrong", expiresIn: "10m", issuer: "vybaa-api", jwtid: "bad-audience" },
  );
  assert.equal(verifyRewindWsToken(token), null);
});

test("Rewind rejects expired and tampered tokens", () => {
  const expired = jwt.sign(
    { userId: "user-1", personaId: "ella", type: "rewind_ws" },
    process.env.JWT_SECRET!,
    { audience: "vybaa-rewind-live", expiresIn: -1, issuer: "vybaa-api", jwtid: "expired" },
  );
  assert.equal(verifyRewindWsToken(expired), null);

  const valid = createRewindWsToken("user-1", "ella");
  assert.equal(verifyRewindWsToken(`${valid.slice(0, -1)}x`), null);
});
