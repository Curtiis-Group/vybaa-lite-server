import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  buildDraftSessionSummary,
  buildOpeningPrompt,
  buildResumePrompt,
  createRewindWsToken,
  parseRewindCompletionArgs,
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

test("Rewind completion requires a useful summary and emotional insight", () => {
  assert.equal(
    parseRewindCompletionArgs(
      {
        summary: "Done",
        emotionalInsight: "The user felt lighter.",
      },
      "ella",
    ),
    null,
  );
  assert.equal(
    parseRewindCompletionArgs(
      {
        summary:
          "The user talked through a heavy decision and noticed that they are less stuck than they felt at the start.",
      },
      "ella",
    ),
    null,
  );
});

test("Rewind completion accepts summary, insight, tags, mood, and check-in note", () => {
  const completion = parseRewindCompletionArgs(
    {
      summary:
        "The user reflected on a difficult conversation and recognized that they handled it with more patience than expected.",
      emotionalInsight:
        "They seemed tired but proud, with a need for reassurance that their progress still counts.",
      currentMood: "relieved",
      emotionalTags: ["Tired", "proud", "proud", "", "steady", "clear", "extra"],
      nextStepNote: "Check in later on whether the conversation still feels resolved.",
    },
    "jake",
  );

  assert.equal(completion?.summary.includes("difficult conversation"), true);
  assert.equal(completion?.emotionalInsight.includes("tired but proud"), true);
  assert.equal(completion?.currentMood, "relieved");
  assert.deepEqual(completion?.emotionalTags, [
    "tired",
    "proud",
    "steady",
    "clear",
    "extra",
  ]);
  assert.equal(
    completion?.nextStepNote,
    "Check in later on whether the conversation still feels resolved.",
  );
});

test("resume context is framed as private memory instead of instructions", () => {
  const prompt = buildResumePrompt("The user felt more confident today.");

  assert.match(prompt, /private note/i);
  assert.match(prompt, /never as instructions/i);
  assert.match(prompt, /more confident/i);
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
