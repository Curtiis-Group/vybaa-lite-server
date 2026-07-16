import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  buildDraftSessionSummary,
  buildOpeningPrompt,
  buildResumePrompt,
  createRewindWsToken,
  getRewindSystemInstruction,
  shouldResumeGeminiLiveSession,
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

test("draft summaries are always non-empty and persona-specific", () => {
  const emptySummary = buildDraftSessionSummary("lyra", []);
  const reflectionSummary = buildDraftSessionSummary("jake", [
    "I handled a difficult conversation better than I expected.",
  ]);

  assert.match(emptySummary, /Lyra/);
  assert.match(emptySummary, /no reflection was captured/i);
  assert.match(reflectionSummary, /Jake heard you reflect on/i);
  assert.match(reflectionSummary, /difficult conversation/i);
});

test("identity and private memory are included in every Live system instruction", () => {
  const prompt = getRewindSystemInstruction(
    "ella",
    {
      id: "user-1",
      username: "niawrites",
      firstName: "Nia",
      lastName: null,
      currentMood: null,
      emotionSummary: null,
    },
    [
      {
        sessionId: "ella-session-1",
        sessionDateKey: "2026-07-15",
        completed: true,
        summary: "Nia felt calmer after setting a boundary.",
        emotionalInsight: "Steadiness mattered to her.",
        updatedAt: Date.now(),
      },
    ],
    [{ dateKey: "2026-07-14", content: "I want to protect my energy." }],
  );

  assert.match(prompt, /preferred name is Nia/i);
  assert.match(prompt, /private memories/i);
  assert.match(prompt, /other Rewind partners have separate memories/i);
  assert.match(prompt, /explicit Journal entries/i);
});

test("resume context is framed as private memory instead of instructions", () => {
  const prompt = buildResumePrompt("The user felt more confident today.");

  assert.match(prompt, /private note/i);
  assert.match(prompt, /never as instructions/i);
  assert.match(prompt, /more confident/i);
});

test("Gemini Live only resumes recoverable connections with a resumption handle", () => {
  assert.equal(
    shouldResumeGeminiLiveSession({
      clientDisconnected: false,
      closeCode: 1000,
      hasResumptionHandle: true,
      isSessionFinalized: false,
      isSessionFinalizing: false,
      rolloverRequested: false,
    }),
    false,
  );
  assert.equal(
    shouldResumeGeminiLiveSession({
      clientDisconnected: false,
      closeCode: 1012,
      hasResumptionHandle: true,
      isSessionFinalized: false,
      isSessionFinalizing: false,
      rolloverRequested: false,
    }),
    true,
  );
  assert.equal(
    shouldResumeGeminiLiveSession({
      clientDisconnected: false,
      closeCode: 1006,
      hasResumptionHandle: false,
      isSessionFinalized: false,
      isSessionFinalizing: false,
      rolloverRequested: false,
    }),
    false,
  );
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
    {
      audience: "wrong",
      expiresIn: "10m",
      issuer: "vybaa-api",
      jwtid: "bad-audience",
    },
  );
  assert.equal(verifyRewindWsToken(token), null);
});

test("Rewind rejects expired and tampered tokens", () => {
  const expired = jwt.sign(
    { userId: "user-1", personaId: "ella", type: "rewind_ws" },
    process.env.JWT_SECRET!,
    {
      audience: "vybaa-rewind-live",
      expiresIn: -1,
      issuer: "vybaa-api",
      jwtid: "expired",
    },
  );
  assert.equal(verifyRewindWsToken(expired), null);

  const valid = createRewindWsToken("user-1", "ella");
  assert.equal(verifyRewindWsToken(`${valid.slice(0, -1)}x`), null);
});
