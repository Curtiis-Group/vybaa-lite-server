import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRewindPersonalContext,
  type RewindPersonalContext,
} from "./rewind-personal-context.service";

const context: RewindPersonalContext = {
  achievements: [],
  balances: { playPoints: 2.85, realPoints: 40 },
  goalConclusions: [],
  goals: [],
  memories: [
    {
      comparisonInsight: null,
      dateKey: "2026-08-31",
      emotionalInsight: "Boundaries brought relief.",
      partner: "Ella",
      summary: "The user protected their energy.",
    },
  ],
  recentRewards: [],
};

test("personal context keeps balances separate and credits partner memories", () => {
  const formatted = formatRewindPersonalContext(context);

  assert.match(formatted, /Play Points: 2\.85/);
  assert.match(formatted, /Real-points balance: 40/);
  assert.match(formatted, /Ella, 2026-08-31/);
  assert.match(formatted, /Boundaries brought relief/);
});

test("personal context is bounded before entering the live prompt", () => {
  const oversized: RewindPersonalContext = {
    ...context,
    memories: Array.from({ length: 30 }, (_, index) => ({
      comparisonInsight: null,
      dateKey: `2026-08-${String(index + 1).padStart(2, "0")}`,
      emotionalInsight: "x".repeat(900),
      partner: "Lyra",
      summary: "y".repeat(1_200),
    })),
  };

  assert.ok(formatRewindPersonalContext(oversized).length <= 14_000);
});
