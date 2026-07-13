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

test("sequence milestones respect an inclusive day range", () => {
  const awards = calculateSequenceMilestoneAwards({
    bonusPoints: 10,
    currentDay: 30,
    endDay: 24,
    interval: 5,
    points: 20,
    previousDay: 0,
    startDay: 4,
  });

  assert.deepEqual(awards, [
    { pointsAwarded: 20, sequenceIndex: 1, sequenceValue: 4 },
    { pointsAwarded: 30, sequenceIndex: 2, sequenceValue: 9 },
    { pointsAwarded: 40, sequenceIndex: 3, sequenceValue: 14 },
    { pointsAwarded: 50, sequenceIndex: 4, sequenceValue: 19 },
    { pointsAwarded: 60, sequenceIndex: 5, sequenceValue: 24 },
  ]);
});

test("sequence milestones ignore progress outside the configured range", () => {
  assert.deepEqual(
    calculateSequenceMilestoneAwards({
      bonusPoints: 10,
      currentDay: 3,
      endDay: 24,
      interval: 5,
      points: 20,
      previousDay: 0,
      startDay: 4,
    }),
    [],
  );

  assert.deepEqual(
    calculateSequenceMilestoneAwards({
      bonusPoints: 10,
      currentDay: 30,
      endDay: 24,
      interval: 5,
      points: 20,
      previousDay: 24,
      startDay: 4,
    }),
    [],
  );
});

test("sequence range can be shorter than its repeat interval", () => {
  const awards = calculateSequenceMilestoneAwards({
    bonusPoints: 10,
    currentDay: 3,
    endDay: 3,
    interval: 20,
    points: 20,
    previousDay: 0,
    startDay: 1,
  });

  assert.deepEqual(awards, [
    { pointsAwarded: 20, sequenceIndex: 1, sequenceValue: 1 },
  ]);
});
