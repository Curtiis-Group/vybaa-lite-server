import assert from "node:assert/strict";
import test from "node:test";

import { calculateSequenceMilestoneAwards } from "../utils/sequence-milestone.util";

test("sequence milestones award escalating points at each interval", () => {
  const awards = calculateSequenceMilestoneAwards({
    bonusPoints: 10,
    currentDay: 15,
    interval: 5,
    points: 20,
    previousDay: 0,
  });

  assert.deepEqual(awards, [
    { pointsAwarded: 20, sequenceIndex: 1, sequenceValue: 5 },
    { pointsAwarded: 30, sequenceIndex: 2, sequenceValue: 10 },
    { pointsAwarded: 40, sequenceIndex: 3, sequenceValue: 15 },
  ]);
});

test("sequence milestones only award newly crossed intervals", () => {
  const awards = calculateSequenceMilestoneAwards({
    bonusPoints: 10,
    currentDay: 11,
    interval: 5,
    points: 20,
    previousDay: 9,
  });

  assert.deepEqual(awards, [
    { pointsAwarded: 30, sequenceIndex: 2, sequenceValue: 10 },
  ]);
});
