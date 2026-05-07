import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGuidedFlowInstruction,
  buildOpeningPrompt,
  buildResumePrompt,
  buildResumePromptWithGuidedState,
  recordGuidedFlowResponse,
  summarizeShortResponse,
} from "./rewind.controller";

test("buildOpeningPrompt introduces the persona on first opening", () => {
  const prompt = buildOpeningPrompt("ella", { shouldIntroduce: true });

  assert.match(prompt, /first time/i);
  assert.match(prompt, /introduce yourself as Ella/i);
  assert.match(prompt, /ask exactly: "Hey, how are you\?"/i);
  assert.match(prompt, /exactly two short sentences/i);
});

test("buildOpeningPrompt skips re-introduction after first opening", () => {
  const prompt = buildOpeningPrompt("jake", { shouldIntroduce: false });

  assert.match(prompt, /ask exactly: "Hey, how are you\?"/i);
  assert.match(prompt, /Do not introduce yourself again\./i);
  assert.doesNotMatch(prompt, /introduce yourself as Jake/i);
});

test("buildResumePrompt requires reference to the previous session", () => {
  const prompt = buildResumePrompt();

  assert.match(prompt, /previous Rewind session is being restored/i);
  assert.match(prompt, /exactly two short sentences/i);
  assert.match(prompt, /briefly mention what we were just talking about or where we left off/i);
  assert.match(prompt, /ask one simple follow-up question/i);
  assert.match(prompt, /Do not reintroduce yourself\./i);
});

test("guided flow instruction contains the exact rewind questions in order", () => {
  const prompt = buildGuidedFlowInstruction();

  assert.match(prompt, /1\. What felt most meaningful about your day today\?/);
  assert.match(prompt, /2\. What drained your energy the most\?/);
  assert.match(prompt, /3\. Did you move closer to what you want, even a little\?/);
  assert.match(prompt, /4\. What’s one thing you wish you handled differently\?/);
  assert.match(prompt, /5\. What do you need more of tomorrow — focus, rest, or courage\?/);
  assert.match(prompt, /do not skip, merge, or reorder/i);
  assert.match(prompt, /do not sound like you are reading from a checklist or script/i);
  assert.match(prompt, /vary the wording naturally and make it conversational/i);
});

test("recordGuidedFlowResponse stores concise summaries in sequence", () => {
  const sessionState = {
    sessionId: "session_1",
    userId: "user_1",
    personaId: "ella" as const,
    sessionDateKey: "2026-04-28",
    guidedFlow: {
      openingAnswered: false,
      currentQuestionIndex: 0,
      completed: false,
      responses: {},
    },
    updatedAt: 0,
  };

  recordGuidedFlowResponse(sessionState, "I'm okay, just a little tired.");
  assert.equal(sessionState.guidedFlow.openingAnswered, true);
  assert.equal(sessionState.guidedFlow.currentQuestionIndex, 0);

  recordGuidedFlowResponse(
    sessionState,
    "Finishing my work early and having dinner with my sister felt the most meaningful today.",
  );
  assert.equal(sessionState.guidedFlow.currentQuestionIndex, 1);
  assert.equal(
    sessionState.guidedFlow.responses.meaningful?.shortSummary,
    "Finishing my work early and having dinner with my sister felt the...",
  );
  assert.equal(sessionState.guidedFlow.responses.meaningful?.score, null);
});

test("buildResumePromptWithGuidedState carries the next pending question", () => {
  const sessionState = {
    sessionId: "session_2",
    userId: "user_1",
    personaId: "jake" as const,
    sessionDateKey: "2026-04-28",
    guidedFlow: {
      openingAnswered: true,
      currentQuestionIndex: 2,
      completed: false,
      responses: {
        meaningful: {
          questionId: "meaningful" as const,
          shortSummary: "Seeing my daughter after work",
          score: null,
          updatedAt: 10,
        },
      },
    },
    updatedAt: 0,
  };

  const prompt = buildResumePromptWithGuidedState(sessionState);

  assert.match(prompt, /Current question index: 2/i);
  assert.match(prompt, /Next exact question: Did you move closer to what you want, even a little\?/i);
  assert.match(prompt, /meaningful: Seeing my daughter after work/i);
  assert.match(prompt, /do not restart from question one/i);
});

test("summarizeShortResponse keeps a compact first-sentence summary", () => {
  const summary = summarizeShortResponse(
    "I felt proud of how calm I stayed during a difficult meeting. It changed the whole afternoon.",
  );

  assert.equal(summary, "I felt proud of how calm I stayed during a difficult meeting");
});
