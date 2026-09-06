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
        schedule: { startDate: "2026-09-05", type: "DAILY" },
        target: { count: 21, type: "CHECK_IN_COUNT" },
        title: "Sleep better",
      },
      kind: "DRAFT",
    },
  );
});
