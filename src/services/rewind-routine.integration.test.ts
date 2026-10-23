import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { prisma } from "../config/db.config";
import {
  markExpiredRewindOccurrencesMissed,
  materializeRewindOccurrences,
  saveRewindRoutine,
} from "./rewind-routine.service";

test(
  "scheduled Rewinds stay independent of user tasks",
  { skip: !process.env.REWIND_ROUTINE_TEST_DATABASE_URL },
  async (context) => {
    const url = new URL(process.env.REWIND_ROUTINE_TEST_DATABASE_URL ?? "");
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.pathname, "/vybaa_rewind_tasks_test_20261022");
    assert.equal(
      process.env.DATABASE_URL,
      process.env.REWIND_ROUTINE_TEST_DATABASE_URL,
    );
    const user = await prisma.user.create({
      data: {
        email: `rewind-independent-${randomUUID()}@example.test`,
        timezone: "Africa/Lagos",
        rewindPersona: "ella",
      },
    });
    context.after(async () => {
      await prisma.user.delete({ where: { id: user.id } });
      await prisma.$disconnect();
    });
    const date = new Date("2031-03-08T00:00:00Z");
    const task = await prisma.goalV2.create({
      data: {
        userId: user.id,
        title: "Rewind w/ Ella",
        targetType: "CHECK_IN_COUNT",
        targetValue: 1,
        scheduleType: "ONE_TIME",
        startDate: date,
        hardStopDate: date,
      },
    });
    await prisma.rewindRoutine.create({
      data: {
        userId: user.id,
        frequency: "MORNINGS_AND_EVENINGS",
        intent: "SPOT_PATTERNS",
        times: ["08:00", "20:00"],
      },
    });
    await materializeRewindOccurrences({ user, now: date });
    assert.equal(
      await prisma.rewindSession.count({ where: { userId: user.id } }),
      4,
    );
    assert.equal(await prisma.goalV2.count({ where: { userId: user.id } }), 1);
    await markExpiredRewindOccurrencesMissed({
      userId: user.id,
      now: new Date("2031-03-10T00:00:00Z"),
    });
    assert.equal(
      await prisma.rewindSession.count({
        where: { userId: user.id, status: "MISSED" },
      }),
      4,
    );
    await saveRewindRoutine({
      userId: user.id,
      input: {
        frequency: "FLEXIBLE",
        intent: "SPOT_PATTERNS",
        timezone: user.timezone,
      },
    });
    assert.equal(await prisma.goalV2.count({ where: { userId: user.id } }), 1);
    const unchanged = await prisma.goalV2.findUniqueOrThrow({
      where: { id: task.id },
    });
    assert.equal(unchanged.status, "ACTIVE");
    assert.equal(unchanged.progressValue, 0);
  },
);
