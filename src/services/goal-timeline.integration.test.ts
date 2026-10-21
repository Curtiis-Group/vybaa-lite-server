import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { DateTime } from "luxon";
import { z } from "zod";

import { prisma } from "../config/db.config";
import goalRoutes from "../routes/goal-v2.routes";
import { generateAccessToken } from "../utils/auth.util";

const responseSchema = z.object({
  data: z.array(z.object({ id: z.string(), dueDate: z.string() })),
  pagination: z.object({
    anchorDate: z.string(),
    nextCursor: z.string().nullable(),
    previousCursor: z.string().nullable(),
    hasPreviousPage: z.boolean(),
    hasNextPage: z.boolean(),
  }),
});

test(
  "today-anchored HTTP timeline pages both ways without gaps, preserves legacy clients and rejects foreign/stale cursors",
  { skip: !process.env.SUBTASK_TEST_DATABASE_URL },
  async (context) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.equal(url.pathname, "/vybaa_subtask_test");
    assert.equal(
      process.env.DATABASE_URL,
      process.env.SUBTASK_TEST_DATABASE_URL,
    );
    const owner = await prisma.user.create({
      data: {
        email: `timeline-${randomUUID()}@example.test`,
        timezone: "Pacific/Kiritimati",
        isConfirmed: true,
      },
    });
    const other = await prisma.user.create({
      data: {
        email: `timeline-other-${randomUUID()}@example.test`,
        isConfirmed: true,
      },
    });
    const today = DateTime.now().setZone(owner.timezone).toISODate();
    assert.ok(today);
    const anchor = DateTime.fromISO(today, { zone: "UTC" });
    const goal = await prisma.goalV2.create({
      data: {
        userId: owner.id,
        title: "Timeline test",
        targetType: "CHECK_IN_COUNT",
        targetValue: 91,
        scheduleType: "DAILY",
        startDate: anchor.minus({ days: 45 }).toJSDate(),
        hardStopDate: anchor.plus({ days: 45 }).toJSDate(),
      },
    });
    const empty = await prisma.goalV2.create({
      data: {
        userId: owner.id,
        title: "Past-only task",
        status: "COMPLETED",
        targetType: "CHECK_IN_COUNT",
        targetValue: 1,
        scheduleType: "ONE_TIME",
        startDate: anchor.minus({ days: 1 }).toJSDate(),
        hardStopDate: anchor.minus({ days: 1 }).toJSDate(),
      },
    });
    await prisma.goalOccurrence.createMany({
      data: Array.from({ length: 91 }, (_, index) => {
        const date = anchor.plus({ days: index - 45 });
        return {
          goalId: goal.id,
          dueDate: date.toJSDate(),
          originalDueDate: date.toJSDate(),
          closesAt: date.endOf("day").toJSDate(),
        };
      }),
    });
    await prisma.goalOccurrence.create({
      data: {
        goalId: empty.id,
        dueDate: anchor.minus({ days: 1 }).toJSDate(),
        originalDueDate: anchor.minus({ days: 1 }).toJSDate(),
        closesAt: new Date(),
        status: "COMPLETED",
      },
    });
    const app = express();
    app.use(express.json());
    app.use("/api/v2/goals", goalRoutes);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/v2/goals`;
    context.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, other.id] } },
      });
      await prisma.$disconnect();
    });
    async function read(query: string, id = goal.id, user = owner.id) {
      return fetch(`${base}/${id}/occurrences?${query}`, {
        headers: { Authorization: `Bearer ${generateAccessToken(user)}` },
      });
    }
    const initial = responseSchema.parse(
      await (await read("anchor=today")).json(),
    );
    assert.equal(initial.pagination.anchorDate, today);
    assert.equal(initial.data.length, 20);
    assert.equal(initial.data[0]?.dueDate.slice(0, 10), today);
    assert.ok(
      initial.pagination.hasPreviousPage && initial.pagination.hasNextPage,
    );
    const ids = new Set(initial.data.map((item) => item.id));
    let previous = initial.pagination.previousCursor;
    while (previous) {
      const page = responseSchema.parse(
        await (
          await read(
            `anchor=today&direction=before&cursor=${encodeURIComponent(previous)}`,
          )
        ).json(),
      );
      assert.ok(page.data.length <= 20);
      assert.deepEqual(
        page.data.map((item) => item.dueDate),
        page.data.map((item) => item.dueDate).sort(),
      );
      for (const item of page.data) {
        assert.ok(!ids.has(item.id));
        ids.add(item.id);
        assert.ok(item.dueDate.slice(0, 10) < today);
      }
      previous = page.pagination.previousCursor;
    }
    let next = initial.pagination.nextCursor;
    while (next) {
      const page = responseSchema.parse(
        await (
          await read(
            `anchor=today&direction=after&cursor=${encodeURIComponent(next)}`,
          )
        ).json(),
      );
      for (const item of page.data) {
        assert.ok(!ids.has(item.id));
        ids.add(item.id);
      }
      next = page.pagination.nextCursor;
    }
    assert.equal(ids.size, 91);
    const legacy = await (await read("limit=20")).json();
    assert.equal(
      legacy.data[0].dueDate.slice(0, 10),
      anchor.minus({ days: 45 }).toISODate(),
    );
    assert.equal(legacy.pagination.anchorDate, undefined);
    const cursor = initial.pagination.nextCursor;
    assert.ok(cursor);
    assert.equal(
      (
        await read(
          `anchor=today&cursor=${encodeURIComponent(cursor)}`,
          goal.id,
          other.id,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await read(
          `anchor=today&cursor=${encodeURIComponent(cursor)}`,
          empty.id,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await read(
          `anchor=today&direction=before&cursor=${encodeURIComponent(cursor)}`,
        )
      ).status,
      400,
    );
    assert.equal((await read("anchor=today&limit=51")).status, 400);
    assert.equal(
      (await read("anchor=today&anchorDate=2026-02-31")).status,
      400,
    );
    const pastOnly = responseSchema.parse(
      await (await read("anchor=today", empty.id)).json(),
    );
    assert.deepEqual(pastOnly.data, []);
    assert.ok(pastOnly.pagination.hasPreviousPage);
    assert.equal(pastOnly.pagination.hasNextPage, false);
    assert.equal(
      responseSchema.parse(
        await (
          await read(
            `anchor=today&direction=before&cursor=${encodeURIComponent(pastOnly.pagination.previousCursor ?? "")}`,
            empty.id,
          )
        ).json(),
      ).data.length,
      1,
    );
    const boundaryId = initial.data.at(-1)?.id;
    assert.ok(boundaryId);
    await prisma.goalOccurrence.update({
      where: { id: boundaryId },
      data: { dueDate: anchor.plus({ days: 100 }).toJSDate() },
    });
    assert.equal(
      (await read(`anchor=today&cursor=${encodeURIComponent(cursor)}`)).status,
      400,
    );
    const unchanged = await prisma.goalV2.findUniqueOrThrow({
      where: { id: goal.id },
    });
    assert.equal(unchanged.progressValue, 0);
    assert.equal(
      await prisma.goalRewardAward.count({ where: { goalId: goal.id } }),
      0,
    );
  },
);
