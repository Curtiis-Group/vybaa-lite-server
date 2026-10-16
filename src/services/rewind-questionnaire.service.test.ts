import assert from "node:assert/strict";
import test from "node:test";

import {
  appendQuestionnaireAnswer,
  questionnaireAnswerInputSchema,
  validateQuestionnaireQuestions,
} from "./rewind-questionnaire.service";
import type { RewindQuestionnaireState } from "./rewind-questionnaire.service";

function createDeck(): RewindQuestionnaireState {
  return {
    kind: "questionnaire",
    version: 1,
    answers: [],
    questions: Array.from({ length: 4 }, (_, index) => ({
      id: `question-${index}`,
      text: `What mattered to you at moment ${index}?`,
      emoji: "💭",
      options: ["A small win", "Time to rest", "Being present"],
    })),
  };
}

test("questionnaire answers advance in order and retries cannot duplicate a saved answer", () => {
  const original = createDeck();
  const answer = {
    questionId: "question-0",
    text: "A small win",
    custom: false,
  };
  const next = appendQuestionnaireAnswer(original, answer);
  assert.equal(original.answers.length, 0);
  assert.equal(next.answers.length, 1);
  assert.equal(appendQuestionnaireAnswer(next, answer), next);
  assert.throws(
    () =>
      appendQuestionnaireAnswer(original, {
        ...answer,
        questionId: "question-2",
      }),
    /current question/,
  );
  assert.throws(
    () => appendQuestionnaireAnswer(next, { ...answer, text: "Time to rest" }),
    /current question/,
  );
});

test("only explicit custom answers may depart from a question's predefined options", () => {
  const state = createDeck();
  const input = {
    questionId: "question-0",
    text: "I finally called my sister",
    custom: false,
  };
  assert.throws(
    () => appendQuestionnaireAnswer(state, input),
    /suggested answers/,
  );
  assert.equal(
    appendQuestionnaireAnswer(state, { ...input, custom: true }).answers[0]
      ?.text,
    input.text,
  );
  assert.equal(
    questionnaireAnswerInputSchema.safeParse({ ...input, text: "   " }).success,
    false,
  );
  assert.equal(
    questionnaireAnswerInputSchema.safeParse({
      ...input,
      text: "x".repeat(2001),
    }).success,
    false,
  );
});

test("generated decks reject ambiguous question IDs and duplicated answer choices", () => {
  const deck = createDeck();
  assert.equal(validateQuestionnaireQuestions(deck.questions).length, 4);
  assert.throws(
    () =>
      validateQuestionnaireQuestions(
        deck.questions.map((question) => ({ ...question, id: "same" })),
      ),
    /repeated/,
  );
  assert.throws(
    () =>
      validateQuestionnaireQuestions(
        deck.questions.map((question) => ({
          ...question,
          options: ["Fine", "Fine", "Tired"],
        })),
      ),
    /repeated/,
  );
});
