import assert from "node:assert/strict";
import test from "node:test";

import {
  formatRewindMessageMoment,
  formatRewindTemporalContext,
  getRewindTemporalContext,
  normalizeRewindContextTimezone,
} from "./rewind-temporal-context.service";

test("Rewind temporal context follows the user's local date and day phase", () => {
  const instant = new Date("2026-09-07T23:30:00.000Z");

  assert.deepEqual(getRewindTemporalContext("Africa/Lagos", instant), {
    dayPhase: "night",
    localDateTime:
      "Tuesday, September 8, 2026 at 12:30 AM (Africa/Lagos, GMT+1)",
    timezone: "Africa/Lagos",
  });
  assert.match(
    formatRewindTemporalContext("America/New_York", instant),
    /Monday, September 7, 2026 at 7:30 PM.*evening/,
  );
});

test("Rewind message moments preserve local wall time and elapsed time", () => {
  const now = new Date("2026-09-07T20:30:00.000Z");

  assert.equal(
    formatRewindMessageMoment(
      new Date("2026-09-07T18:15:00.000Z"),
      "Africa/Lagos",
      now,
    ),
    "Mon, Sep 7 at 7:15 PM (2h ago)",
  );
  assert.equal(
    formatRewindMessageMoment("2026-09-07T20:29:30.000Z", "UTC", now),
    "Mon, Sep 7 at 8:29 PM (just now)",
  );
});

test("invalid Rewind context timezones safely fall back to UTC", () => {
  assert.equal(normalizeRewindContextTimezone("not/a-zone"), "UTC");
  assert.equal(normalizeRewindContextTimezone(undefined), "UTC");
});
