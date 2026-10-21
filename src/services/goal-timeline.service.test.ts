import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  timelineToday,
} from "./goal-timeline.service";
import { listGoalOccurrencesQuerySchema } from "../validators/goal-v2.validators";

test("timeline today respects local midnight, DST and invalid-zone fallback", () => {
  const instant = new Date("2026-10-21T01:30:00Z");
  assert.equal(timelineToday("America/Los_Angeles", instant), "2026-10-20");
  assert.equal(timelineToday("Pacific/Kiritimati", instant), "2026-10-21");
  assert.equal(timelineToday("not-a-zone", instant), "2026-10-21");
  assert.equal(
    timelineToday("America/New_York", new Date("2026-11-01T05:30:00Z")),
    "2026-11-01",
  );
  assert.equal(
    timelineToday("America/New_York", new Date("2026-11-01T06:30:00Z")),
    "2026-11-01",
  );
});

test("timeline cursors reject tampering and cannot cross accounts or tasks", () => {
  const value = {
    version: 1,
    anchorDate: "2026-10-21",
    direction: "before",
    boundary: null,
  } as const;
  const cursor = encodeTimelineCursor(value, "owner", "task");
  assert.deepEqual(decodeTimelineCursor(cursor, "owner", "task"), value);
  for (const [token, user, task] of [
    [cursor, "other", "task"],
    [cursor, "owner", "other"],
    [`x${cursor}`, "owner", "task"],
    ["x".repeat(513), "owner", "task"],
  ]) {
    assert.throws(
      () => decodeTimelineCursor(token, user, task),
      /Refresh the timeline/,
    );
  }
});

test("timeline pagination validates direction, limits and opt-in while retaining legacy parameters", () => {
  assert.ok(
    listGoalOccurrencesQuerySchema.safeParse({
      limit: "20",
      cursor: "old-cursor",
    }).success,
  );
  assert.ok(
    listGoalOccurrencesQuerySchema.safeParse({
      anchor: "today",
      direction: "before",
      limit: "20",
    }).success,
  );
  for (const input of [
    { limit: 51 },
    { limit: 0 },
    { anchor: "today", direction: "sideways" },
    { direction: "before" },
    { anchorDate: "2026-10-21" },
  ]) {
    assert.equal(
      listGoalOccurrencesQuerySchema.safeParse(input).success,
      false,
    );
  }
});
