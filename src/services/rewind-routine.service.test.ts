import assert from "node:assert/strict";
import test from "node:test";
import { RewindFrequency, RewindIntent } from "@prisma/client";
import {
  EVENING_REWIND_TIME,
  MORNING_REWIND_TIME,
  getRewindIntentLabel,
  getRoutineOccurrenceStarts,
  getRoutineTimes,
  normalizeRewindTimezone,
  validateRewindRoutineInput,
} from "./rewind-routine.service";

test("preset Rewind routines use the fixed local defaults", () => {
  assert.deepEqual(
    getRoutineTimes({ frequency: RewindFrequency.MORNINGS_AND_EVENINGS }),
    [MORNING_REWIND_TIME, EVENING_REWIND_TIME],
  );
  assert.deepEqual(
    getRoutineTimes({ frequency: RewindFrequency.JUST_MORNINGS }),
    [MORNING_REWIND_TIME],
  );
  assert.deepEqual(
    getRoutineTimes({ frequency: RewindFrequency.JUST_EVENINGS }),
    [EVENING_REWIND_TIME],
  );
});

test("custom Rewind routines require eight hours between both windows", () => {
  const valid = validateRewindRoutineInput({
    frequency: RewindFrequency.CUSTOM,
    intent: RewindIntent.SPOT_PATTERNS,
    times: ["21:00", "06:00"],
    timezone: "Africa/Lagos",
  });
  assert.deepEqual(valid.times, ["06:00", "21:00"]);

  assert.throws(
    () =>
      validateRewindRoutineInput({
        frequency: RewindFrequency.CUSTOM,
        intent: RewindIntent.SPOT_PATTERNS,
        times: ["08:00", "15:00"],
        timezone: "Africa/Lagos",
      }),
    /eight hours/i,
  );
});

test("custom Rewind intentions and timezone must be valid", () => {
  assert.throws(
    () =>
      validateRewindRoutineInput({
        customIntent: "",
        frequency: RewindFrequency.JUST_EVENINGS,
        intent: RewindIntent.CUSTOM,
        timezone: "Africa/Lagos",
      }),
    /custom rewind intention/i,
  );
  assert.equal(normalizeRewindTimezone("Invalid/Timezone"), "UTC");
});

test("occurrences preserve user wall-clock schedules across timezones and DST", () => {
  const lagosStarts = getRoutineOccurrenceStarts({
    now: new Date("2026-07-18T00:00:00.000Z"),
    times: ["08:00"],
    timezone: "Africa/Lagos",
  });
  assert.equal(lagosStarts[0]?.toFormat("yyyy-LL-dd HH:mm"), "2026-07-18 08:00");

  const newYorkStarts = getRoutineOccurrenceStarts({
    now: new Date("2026-03-08T00:00:00.000Z"),
    times: ["02:30"],
    timezone: "America/New_York",
  });
  const springForwardStart = newYorkStarts.find(
    (start) => start.toFormat("yyyy-LL-dd") === "2026-03-08",
  );
  assert.equal(springForwardStart?.toFormat("HH:mm"), "03:30");

  const fallbackStarts = getRoutineOccurrenceStarts({
    now: new Date("2026-11-01T00:00:00.000Z"),
    times: ["01:30"],
    timezone: "America/New_York",
  }).filter((start) => start.toFormat("yyyy-LL-dd") === "2026-11-01");
  assert.equal(fallbackStarts.length, 1);
});

test("routine intention labels stay meaningful in reflection prompts", () => {
  assert.equal(
    getRewindIntentLabel({
      customIntent: null,
      intent: RewindIntent.BUILD_SMALL_CHANGES,
    }),
    "Turn reflection into small changes",
  );
  assert.equal(
    getRewindIntentLabel({
      customIntent: "Notice when I feel most like myself",
      intent: RewindIntent.CUSTOM,
    }),
    "Notice when I feel most like myself",
  );
});
