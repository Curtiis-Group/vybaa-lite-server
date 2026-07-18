import assert from "node:assert/strict";
import test from "node:test";
import { RewindFrequency, RewindIntent } from "@prisma/client";
import {
  EVENING_REWIND_TIME,
  MORNING_REWIND_TIME,
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
