import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoalReminderCopy,
  getNextGoalReminderOccurrence,
} from "./goal-reminder.util";

test("goal reminder copy turns action titles into natural sentences", () => {
  const reminder = buildGoalReminderCopy({
    goalTitle: "Cook",
    preferredName: "Ese Curtis",
    seed: "goal-1:2026-08-09",
  });

  assert.match(reminder.title, /cook/i);
  assert.match(reminder.message, /Ese/);
  assert.match(reminder.message, /cook/i);
  assert.doesNotMatch(reminder.message, /goal:/i);
});

test("goal reminder copy remains grammatical for non-action titles", () => {
  const reminder = buildGoalReminderCopy({
    goalTitle: "Morning wellbeing",
    preferredName: "Zion",
    seed: "goal-2:2026-08-09",
  });

  assert.match(reminder.title, /Morning wellbeing/);
  assert.match(reminder.message, /Zion/);
});

test("goal reminder occurrences preserve local wall-clock time", () => {
  const now = new Date("2026-08-09T05:00:00.000Z");
  const lagos = getNextGoalReminderOccurrence({
    now,
    reminderTime: "08:00",
    timezone: "Africa/Lagos",
  });
  const newYork = getNextGoalReminderOccurrence({
    now,
    reminderTime: "08:00",
    timezone: "America/New_York",
  });

  assert.equal(lagos?.scheduledFor.toISOString(), "2026-08-09T07:00:00.000Z");
  assert.equal(
    newYork?.scheduledFor.toISOString(),
    "2026-08-09T12:00:00.000Z",
  );
});

test("goal reminder occurrences roll forward by the user's local day", () => {
  const occurrence = getNextGoalReminderOccurrence({
    now: new Date("2026-08-09T20:30:00.000Z"),
    reminderTime: "20:00",
    timezone: "Africa/Lagos",
  });

  assert.equal(occurrence?.dayKey, "2026-08-10");
  assert.equal(
    occurrence?.scheduledFor.toISOString(),
    "2026-08-10T19:00:00.000Z",
  );
});

test("goal reminder occurrences reject invalid timezones and times", () => {
  assert.equal(
    getNextGoalReminderOccurrence({
      now: new Date(),
      reminderTime: "25:00",
      timezone: "UTC",
    }),
    null,
  );
  assert.equal(
    getNextGoalReminderOccurrence({
      now: new Date(),
      reminderTime: "08:00",
      timezone: "Not/AZone",
    }),
    null,
  );
});
