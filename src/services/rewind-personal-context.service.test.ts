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
  observations: [],
  partnerContinuity: null,
  personalizationEnabled: true,
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

test("personal context is empty when activity personalization is disabled", () => {
  assert.equal(
    formatRewindPersonalContext({
      ...context,
      personalizationEnabled: false,
    }),
    "",
  );
});

test("personal context keeps one partner's private memory isolated", () => {
  const formatted = formatRewindPersonalContext({
    ...context,
    memories: [
      {
        comparisonInsight: null,
        dateKey: "2026-09-04",
        emotionalInsight: null,
        partner: "Lyra",
        summary: "The user was anxious about a deadline.",
      },
    ],
    partnerContinuity: {
      directChat: ["User: dont tell the group", "Lyra: course not"],
      directChatSummary: "The deadline concern is private.",
      groupChat: ["Jake: we still going tomorrow?", "User: yh"],
      groupChatSummary: "The group planned to meet tomorrow.",
      partner: "Lyra",
      personaId: "lyra",
      relationship: {
        anger: 2,
        hate: 0,
        jealousy: 1,
        love: 34,
        malice: 0,
        memorySummary: "Still worried the user is avoiding the deadline.",
      },
    },
  });

  assert.match(formatted, /belongs only to Lyra/);
  assert.match(formatted, /dont tell the group/);
  assert.match(formatted, /Group messages are shared facts only/);
  assert.doesNotMatch(formatted, /Cross-partner memories/);
});
