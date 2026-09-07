import assert from "node:assert/strict";
import test from "node:test";

import { buildGoalAlarmManifest, getGoalAlarmId } from "./goal-alarm.service";
import { shouldSuppressGoalReminderPush } from "./notification.service";

test("goal alarm manifest is timezone-safe, deterministic, and ordered", () => {
  const source = {
    dueDate: new Date("2026-11-01T00:00:00.000Z"),
    goal: {
      id: "goal_one",
      reminderTimes: ["09:30", "08:15"],
      title: "Walk outside",
      user: {
        firstName: "Ese",
        rewindPersona: "ariel",
        timezone: "America/New_York",
        username: "ese",
      },
    },
    id: "occurrence_one",
  };
  const now = new Date("2026-10-31T12:00:00.000Z");

  const first = buildGoalAlarmManifest([source], now);
  const second = buildGoalAlarmManifest([source], now);

  assert.deepEqual(first, second);
  assert.equal(first.alarms.length, 2);
  assert.equal(first.alarms[0]?.fireAt, "2026-11-01T13:15:00.000Z");
  assert.equal(first.alarms[0]?.id, getGoalAlarmId("occurrence_one", "08:15"));
  assert.equal(first.alarms[0]?.route, "/app/goal/goal_one");
  assert.equal(first.alarms[0]?.snoozeMinutes, 10);
});

test("goal alarm manifest excludes past alarms and caps nearest results", () => {
  const source = {
    dueDate: new Date("2026-09-08T00:00:00.000Z"),
    goal: {
      id: "goal_two",
      reminderTimes: ["08:00", "10:00", "12:00"],
      title: "Read",
      user: {
        firstName: null,
        rewindPersona: null,
        timezone: "Africa/Lagos",
        username: "ese",
      },
    },
    id: "occurrence_two",
  };

  const manifest = buildGoalAlarmManifest(
    [source],
    new Date("2026-09-08T08:30:00.000Z"),
    1,
  );

  assert.equal(manifest.alarms.length, 1);
  assert.equal(manifest.alarms[0]?.fireAt, "2026-09-08T09:00:00.000Z");
});

test("goal pushes are suppressed only for the exact scheduled device alarm", () => {
  const target = {
    goalAlarmIds: ["goal_v2:occurrence_one:08:15"],
    goalAlarmsEnabled: true,
  };

  assert.equal(
    shouldSuppressGoalReminderPush(target, "goal_v2_reminder", {
      alarmId: "goal_v2:occurrence_one:08:15",
    }),
    true,
  );
  assert.equal(
    shouldSuppressGoalReminderPush(target, "goal_v2_reminder", {
      alarmId: "goal_v2:occurrence_one:09:30",
    }),
    false,
  );
  assert.equal(
    shouldSuppressGoalReminderPush(target, "rewind_chat_message", {
      alarmId: "goal_v2:occurrence_one:08:15",
    }),
    false,
  );
});
