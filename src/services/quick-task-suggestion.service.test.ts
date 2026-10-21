import assert from "node:assert/strict";
import test from "node:test";

import {
  parseGeneratedDailyObservation,
  parseGeneratedDailyObservationResponse,
} from "./daily-observation.service";
import {
  groundTaskSuggestions,
  parseTaskSuggestions,
  taskTitleKey,
} from "./quick-task-suggestion.service";

const suggestion = {
  title: "Read one chapter",
  reason: "You mentioned wanting to get back into reading.",
  signalIds: ["reading-intention"],
};

test("quick task suggestions validate optional output, bound content and deduplicate titles", () => {
  assert.deepEqual(parseTaskSuggestions(undefined), []);
  assert.deepEqual(parseTaskSuggestions({ title: "bad" }), []);
  assert.deepEqual(
    parseTaskSuggestions([
      { ...suggestion, title: "x".repeat(121) },
      { ...suggestion, signalIds: [] },
      suggestion,
      { ...suggestion, title: "READ one chapter!" },
      ...Array.from({ length: 5 }, (_, index) => ({
        ...suggestion,
        title: `Read chapter ${index}`,
      })),
    ]).map((item) => item.title),
    ["Read one chapter", "Read chapter 0", "Read chapter 1"],
  );
  assert.equal(taskTitleKey("  Ｒｅａｄ one chapter! "), "read one chapter");
});

test("quick tasks require every reference to be eligible evidence and exclude existing tasks", () => {
  const signals = [
    {
      id: "reading-intention",
      sourceType: "REWIND_CHAT",
      privacyEligible: true,
    },
    { id: "private", sourceType: "JOURNAL", privacyEligible: false },
    { id: "reward", sourceType: "REWARD", privacyEligible: true },
  ] satisfies Parameters<typeof groundTaskSuggestions>[1];
  assert.deepEqual(groundTaskSuggestions([suggestion], signals), [suggestion]);
  assert.deepEqual(
    groundTaskSuggestions([suggestion], signals, ["READ one chapter!"]),
    [],
  );
  for (const id of ["another-users-signal", "private", "reward"]) {
    assert.deepEqual(
      groundTaskSuggestions(
        [{ ...suggestion, signalIds: ["reading-intention", id] }],
        signals,
      ),
      [],
    );
  }
});

test("old observations and malformed suggestion extras still preserve all existing observation content", () => {
  const observation = {
    confidence: 0.8,
    description: "You seemed ready to return to reading.",
    homeGreeting: "Ada, a small start counts",
    journalDraft: "I want to make time for reading.",
    observations: ["You mentioned wanting to read again."],
    reflection: "A manageable step might help.",
  };
  assert.deepEqual(
    parseGeneratedDailyObservation(observation).taskSuggestions,
    [],
  );
  const parsed = parseGeneratedDailyObservation({
    ...observation,
    taskSuggestions: [suggestion, { title: "bad" }],
  });
  assert.deepEqual(parsed.taskSuggestions, [suggestion]);
  const { taskSuggestions: _suggestions, ...preserved } = parsed;
  assert.deepEqual(preserved, observation);
});

test("markdown suggestion extras never become part of the journal draft", () => {
  const content = [
    "**confidence**: 0.8",
    "**description**: A small start seemed useful.",
    "**homeGreeting**: Ada, small starts count",
    "**observations**: - You mentioned reading again.",
    "**reflection**: A manageable step might help.",
    "**journalDraft**: I want to read again.",
    "**taskSuggestions**: ",
  ].join("\n");
  for (const extra of ["malformed extras", JSON.stringify([suggestion])]) {
    const parsed = parseGeneratedDailyObservationResponse(content + extra);
    assert.equal(parsed.journalDraft, "I want to read again.");
    assert.deepEqual(
      parsed.taskSuggestions,
      extra === "malformed extras" ? [] : [suggestion],
    );
  }
});
