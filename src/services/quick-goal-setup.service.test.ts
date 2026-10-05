import assert from "node:assert/strict";
import test from "node:test";

import { normalizeQuickGoalSetupResult } from "./quick-goal-setup.service";

test("quick goal setup defaults omitted schedule dates to the user's current day", () => {
  assert.deepEqual(
    normalizeQuickGoalSetupResult(
      {
        draft: {
          schedule: { type: "DAILY" },
          target: { count: 21, type: "CHECK_IN_COUNT" },
          title: "Sleep better",
        },
        kind: "DRAFT",
      },
      "2026-09-05",
    ),
    {
      draft: {
        reminderTimes: [],
        schedule: { startDate: "2026-09-05", type: "DAILY" },
        target: { count: 21, type: "CHECK_IN_COUNT" },
        title: "Sleep better",
      },
      kind: "DRAFT",
    },
  );
});

test("quick goal setup preserves reminder times when an edit response omits them", () => {
  assert.deepEqual(
    normalizeQuickGoalSetupResult(
      {
        draft: {
          schedule: { type: "DAILY" },
          target: { count: 21, type: "CHECK_IN_COUNT" },
          title: "Sleep better",
        },
        kind: "DRAFT",
      },
      "2026-09-05",
      ["22:30"],
    ),
    {
      draft: {
        reminderTimes: ["22:30"],
        schedule: { startDate: "2026-09-05", type: "DAILY" },
        target: { count: 21, type: "CHECK_IN_COUNT" },
        title: "Sleep better",
      },
      kind: "DRAFT",
    },
  );
});

test("quick goal setup repairs a mixed draft and question response", () => {
  assert.deepEqual(
    normalizeQuickGoalSetupResult(
      {
        kind: "DRAFT",
        questions: [
          {
            question:
              "Did you mean JavaScript, and how many minutes a day can you commit to learning it?",
          },
        ],
      },
      "2026-09-05",
    ),
    {
      kind: "QUESTIONS",
      questions: [
        {
          question:
            "Did you mean JavaScript, and how many minutes a day can you commit to learning it?",
        },
      ],
    },
  );
});
