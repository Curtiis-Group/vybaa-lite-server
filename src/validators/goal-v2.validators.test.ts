import assert from "node:assert/strict";
import test from "node:test";

import {
  quickGoalSetupDecisionSchema,
  quickGoalSetupSchema,
} from "./goal-v2.validators";

test("quick goal setup accepts a bounded planning answer set", () => {
  assert.equal(
    quickGoalSetupSchema.safeParse({
      answers: [
        { answer: "After dinner", question: "When will you do it?" },
        { answer: "Twenty minutes", question: "How long is realistic?" },
      ],
      prompt: "Read more",
    }).success,
    true,
  );
  assert.equal(
    quickGoalSetupSchema.safeParse({
      answers: [
        { answer: "After dinner", question: "When will you do it?" },
        { answer: "Twenty minutes", question: "How long is realistic?" },
        { answer: "Daily", question: "How often?" },
      ],
      prompt: "Read more",
    }).success,
    false,
  );
});

test("quick goal setup returns either focused questions or an editable draft", () => {
  assert.equal(
    quickGoalSetupDecisionSchema.safeParse({
      kind: "QUESTIONS",
      questions: [{ question: "What time of day will you read?" }],
    }).success,
    true,
  );
  assert.equal(
    quickGoalSetupDecisionSchema.safeParse({
      draft: {
        schedule: { startDate: "2026-09-06", type: "DAILY" },
        target: { count: 14, type: "CHECK_IN_COUNT" },
        title: "Read after dinner",
      },
      kind: "DRAFT",
    }).success,
    true,
  );
  assert.equal(
    quickGoalSetupDecisionSchema.safeParse({
      kind: "QUESTIONS",
      questions: [
        { question: "What time of day will you read?" },
        { question: "How long will you read?" },
        { question: "How many days?" },
      ],
    }).success,
    false,
  );
});

test("quick goal setup accepts an adjustment request with the current draft", () => {
  assert.equal(
    quickGoalSetupSchema.safeParse({
      edit: {
        draft: {
          schedule: { startDate: "2026-09-06", type: "DAILY" },
          target: { count: 21, type: "CHECK_IN_COUNT" },
          title: "Sleep better",
        },
        instruction: "Make it 30 minutes before bed",
      },
      prompt: "I want to sleep better",
    }).success,
    true,
  );
});
