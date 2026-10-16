import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSocialInferenceContext,
  type SocialInferenceSource,
} from "./social-content-inference.util";

test("social inference context uses only the curated source labels", () => {
  const context = formatSocialInferenceContext([
    {
      dateKey: "2026-10-12",
      id: "rewind-1",
      text: "A useful reflection.",
      type: "REWIND",
    },
    {
      dateKey: "2026-10-11",
      id: "goal-1",
      text: "Finished the scheduled progress.",
      type: "GOAL_PROGRESS",
    },
    {
      dateKey: "2026-10-10",
      id: "achievement-1",
      text: "Earned a milestone.",
      type: "ACHIEVEMENT",
    },
  ]);

  assert.match(context, /Completed Rewind summary, 2026-10-12/);
  assert.match(context, /Completed goal progress, 2026-10-11/);
  assert.match(context, /Achievement, 2026-10-10/);
  assert.doesNotMatch(context, /journal|private chat|relationship state/i);
});

test("social inference context is bounded by source count and text length", () => {
  const sources: SocialInferenceSource[] = Array.from(
    { length: 10 },
    (_, index) => ({
      dateKey: "2026-10-12",
      id: `source-${index}`,
      text: "x".repeat(900),
      type: "REWIND",
    }),
  );
  const context = formatSocialInferenceContext(sources);

  assert.equal((context.match(/Completed Rewind summary/g) ?? []).length, 7);
  assert.ok(context.length <= 5_000);
  assert.ok(context.length > 0);
});
