import assert from "node:assert/strict";
import test from "node:test";

import {
  hasSubstantiveSignalDescriptions,
  parseGeneratedDailyObservation,
} from "./daily-observation.service";

test("daily observations require meaningful evidence", () => {
  assert.equal(hasSubstantiveSignalDescriptions([]), false);
  assert.equal(hasSubstantiveSignalDescriptions(["Opened a page"]), false);
  assert.equal(
    hasSubstantiveSignalDescriptions([
      "Completed the reading goal after writing about feeling more focused than yesterday.",
    ]),
    true,
  );
  assert.equal(
    hasSubstantiveSignalDescriptions(["Completed a goal", "Wrote a journal"]),
    true,
  );
});

test("daily observation parsing is bounded and rejects incomplete output", () => {
  const parsed = parseGeneratedDailyObservation({
    confidence: 4,
    description: "  You seemed to protect your time today.  ",
    homeGreeting: "Ese, I liked how you protected your time today",
    journalDraft: "I protected my time by declining an extra commitment.",
    observations: ["You completed the goal you had paused earlier."],
    reflection: "A smaller commitment may have made follow-through easier.",
  });

  assert.equal(parsed.confidence, 1);
  assert.equal(parsed.description, "You seemed to protect your time today.");
  assert.equal(
    parsed.homeGreeting,
    "Ese, I liked how you protected your time today",
  );
  assert.throws(
    () => parseGeneratedDailyObservation({ confidence: 0.5 }),
    /omitted required content/,
  );
});
