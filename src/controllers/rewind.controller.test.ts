import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import {
  averageRewindSignals,
  buildElevenLabsFirstMessage,
  buildDraftSessionSummary,
  buildOpeningPrompt,
  buildResumePrompt,
  createRewindWsToken,
  getRewindTemporalContext,
  getRewindSystemInstruction,
  isExplicitRewindEndRequest,
  normalizeRewindTimezone,
  shouldResumeGeminiLiveSession,
  verifyRewindWsToken,
} from "./rewind.controller";

process.env.JWT_SECRET = "test-secret-that-is-not-a-production-default";

const REWIND_PROMPT_TEST_USER = {
  currentMood: null,
  emotionSummary: null,
  firstName: "Nia",
  id: "user-1",
  lastName: null,
  username: "niawrites",
};

test("Rewind insights are available from the first valid reflection", () => {
  const signals = averageRewindSignals([
    {
      wellbeingSignals: {
        agency: 64,
        clarity: 72,
        connection: 58,
        emotionalSteadiness: 61,
        energy: 49,
      },
    },
  ]);

  assert.deepEqual(signals, {
    agency: 64,
    clarity: 72,
    connection: 58,
    emotionalSteadiness: 61,
    energy: 49,
  });
  assert.equal(averageRewindSignals([{ wellbeingSignals: null }]), null);
});

test("opening is relaxed and does not require a scripted question", () => {
  const prompt = buildOpeningPrompt("ella", { shouldIntroduce: true });
  assert.match(prompt, /relaxed/i);
  assert.match(prompt, /low-pressure/i);
  assert.doesNotMatch(prompt, /exactly two/i);
  assert.doesNotMatch(prompt, /ask exactly/i);
});

test("ElevenLabs Live opens as the selected partner without scripted copy", () => {
  assert.equal(
    buildElevenLabsFirstMessage("tobi", REWIND_PROMPT_TEST_USER, false),
    "how far Nia, Tobi here. what's up?",
  );
  assert.match(
    buildElevenLabsFirstMessage("lyra", REWIND_PROMPT_TEST_USER, true),
    /welcome back/i,
  );
});

test("spoken end requests close Rewind without matching negated or ordinary speech", () => {
  assert.equal(isExplicitRewindEndRequest("please end this session"), true);
  assert.equal(isExplicitRewindEndRequest("I'm done"), true);
  assert.equal(isExplicitRewindEndRequest("let's finish"), true);
  assert.equal(isExplicitRewindEndRequest("can we end here?"), true);
  assert.equal(isExplicitRewindEndRequest("I want to wrap it up"), true);
  assert.equal(isExplicitRewindEndRequest("that's all for tonight"), true);

  assert.equal(isExplicitRewindEndRequest("don't end this session"), false);
  assert.equal(
    isExplicitRewindEndRequest("I don't want to end this session"),
    false,
  );
  assert.equal(
    isExplicitRewindEndRequest("not yet, let's keep talking"),
    false,
  );
  assert.equal(isExplicitRewindEndRequest("work was finished at five"), false);
});

test("opening context respects the user's local time instead of assuming a finished day", () => {
  const temporalContext = getRewindTemporalContext(
    new Date("2026-07-18T06:30:00.000Z"),
    "Africa/Lagos",
  );
  const prompt = buildOpeningPrompt("ella", {
    shouldIntroduce: true,
    temporalContext,
  });

  assert.equal(temporalContext.dayPhase, "morning");
  assert.equal(temporalContext.timezone, "Africa/Lagos");
  assert.match(prompt, /do not frame the day as finished/i);
  assert.equal(normalizeRewindTimezone("not/a-timezone"), "UTC");
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
  assert.match(prompt, /memories from this partner/i);
  assert.match(prompt, /belong only to this partner/i);
  assert.doesNotMatch(prompt, /Cross-partner memories/i);
  assert.match(prompt, /explicit Journal entries/i);
  assert.match(prompt, /local time is/i);
  assert.match(prompt, /pause_session/i);
  assert.doesNotMatch(prompt, /Open by asking how their day went/i);
});

test("Live system instructions keep all six partner personalities distinct", () => {
  const ellaPrompt = getRewindSystemInstruction(
    "ella",
    REWIND_PROMPT_TEST_USER,
  );
  const lyraPrompt = getRewindSystemInstruction(
    "lyra",
    REWIND_PROMPT_TEST_USER,
  );
  const jakePrompt = getRewindSystemInstruction(
    "jake",
    REWIND_PROMPT_TEST_USER,
  );
  const arielPrompt = getRewindSystemInstruction(
    "ariel",
    REWIND_PROMPT_TEST_USER,
  );
  const tobiPrompt = getRewindSystemInstruction(
    "tobi",
    REWIND_PROMPT_TEST_USER,
  );
  const neejaPrompt = getRewindSystemInstruction(
    "neeja",
    REWIND_PROMPT_TEST_USER,
  );

  assert.match(
    ellaPrompt,
    /intensely emotional, expressive, and deeply feeling/i,
  );
  assert.match(
    ellaPrompt,
    /genuine warmth, concern, delight, frustration, or hurt/i,
  );
  assert.match(ellaPrompt, /never perform emotion/i);

  assert.match(lyraPrompt, /nonchalant, low-key, dry, and hard to rattle/i);
  assert.match(lyraPrompt, /occasional wry aside/i);
  assert.match(lyraPrompt, /never gush, chase, pressure, or over-explain/i);

  assert.match(jakePrompt, /very blunt, unsentimental, and concise/i);
  assert.match(jakePrompt, /call out excuses, avoidance, and contradictions/i);
  assert.match(jakePrompt, /do not sugarcoat/i);

  assert.match(arielPrompt, /grounded big-sibling figure/i);
  assert.match(arielPrompt, /protective, practical, steady/i);
  assert.match(arielPrompt, /needed reality check/i);
  assert.match(arielPrompt, /without coddling or trying to control/i);
  assert.match(tobiPrompt, /playful, socially sharp/i);
  assert.match(tobiPrompt, /Nigerian slang/i);
  assert.match(tobiPrompt, /honest thing/i);
  assert.match(neejaPrompt, /perceptive, composed/i);
  assert.match(neejaPrompt, /subtext and small details/i);
  assert.match(neejaPrompt, /never clinical or superior/i);
});

test("every Live partner is independent and never deferential or flattering", () => {
  const prompts = [
    getRewindSystemInstruction("ella", REWIND_PROMPT_TEST_USER),
    getRewindSystemInstruction("lyra", REWIND_PROMPT_TEST_USER),
    getRewindSystemInstruction("jake", REWIND_PROMPT_TEST_USER),
    getRewindSystemInstruction("ariel", REWIND_PROMPT_TEST_USER),
    getRewindSystemInstruction("tobi", REWIND_PROMPT_TEST_USER),
    getRewindSystemInstruction("neeja", REWIND_PROMPT_TEST_USER),
  ];

  for (const prompt of prompts) {
    assert.match(prompt, /independent peer/i);
    assert.match(
      prompt,
      /not the user's attendant, fan, therapist, subordinate/i,
    );
    assert.match(prompt, /user is not always right/i);
    assert.match(prompt, /disagree, challenge/i);
    assert.match(prompt, /never flatter, worship/i);
    assert.match(prompt, /without centering every utterance on pleasing them/i);
  }
});

test("Rewind closing instructions require a spoken farewell before saving", () => {
  const prompt = getRewindSystemInstruction("jake", {
    currentMood: null,
    emotionSummary: null,
    firstName: "Nia",
    id: "user-1",
    lastName: null,
    username: "niawrites",
  });

  assert.match(prompt, /short flowing recap-farewell/i);
  assert.match(prompt, /ending this Rewind now/i);
  assert.match(prompt, /return next time/i);
  assert.match(prompt, /ask another question/i);
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
      isSessionPaused: false,
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
      isSessionPaused: false,
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
      isSessionPaused: false,
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
      isSessionPaused: true,
      isSessionFinalized: false,
      isSessionFinalizing: false,
      rolloverRequested: false,
    }),
    false,
  );
});

test("Rewind token is audience-bound, timezone-aware, and single use", () => {
  const token = createRewindWsToken(
    "user-1",
    "ella",
    "session-1",
    "Africa/Lagos",
  );
  const verified = verifyRewindWsToken(token);
  assert.equal(verified?.userId, "user-1");
  assert.equal(verified?.timezone, "Africa/Lagos");
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
