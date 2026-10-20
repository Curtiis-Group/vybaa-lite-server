import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import { prisma } from "../config/db.config";
import goalRoutes from "../routes/goal-v2.routes";
import { generateAccessToken } from "../utils/auth.util";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

test(
  "subtasks persist through authenticated routes, preserve parent progress, reject conflicts and enforce ownership",
  {
    skip: !process.env.SUBTASK_TEST_DATABASE_URL,
  },
  async (context) => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
    assert.equal(url.pathname, "/vybaa_subtask_test");
    assert.equal(
      process.env.DATABASE_URL,
      process.env.SUBTASK_TEST_DATABASE_URL,
    );
    const suffix = randomUUID();
    const owner = await prisma.user.create({
      data: {
        email: `owner-${suffix}@example.test`,
        isConfirmed: true,
        timezone: "Africa/Lagos",
      },
    });
    const other = await prisma.user.create({
      data: { email: `other-${suffix}@example.test`, isConfirmed: true },
    });
    const goal = await prisma.goalV2.create({
      data: {
        userId: owner.id,
        title: `Subtask integration ${suffix}`,
        targetType: "CHECK_IN_COUNT",
        targetValue: 1,
        scheduleType: "ONE_TIME",
        startDate: new Date(),
        hardStopDate: new Date(),
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
    const token = generateAccessToken(owner.id);
    const otherToken = generateAccessToken(other.id);
    context.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await prisma.goalV2.deleteMany({
        where: { id: goal.id, userId: owner.id },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, other.id] } },
      });
      await prisma.$disconnect();
    });
    async function request(
      path: string,
      method = "GET",
      body?: unknown,
      auth = token,
    ) {
      return fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${auth}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    const path = `/${goal.id}/subtasks`;
    assert.equal((await fetch(`${base}${path}`)).status, 401);
    const id = randomUUID();
    assert.equal(
      (await request(path, "POST", { id, title: "  Read chapter one  " }))
        .status,
      201,
    );
    assert.equal(
      (await request(path, "POST", { id, title: "Read chapter one" })).status,
      201,
    );
    let response = object(await (await request(path)).json());
    assert.ok(Array.isArray(response.data));
    assert.equal(response.data.length, 1);
    assert.equal(object(response.data[0]).title, "Read chapter one");
    assert.equal(
      (
        await request(path, "POST", {
          id: randomUUID(),
          title: "bad",
          userId: other.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(path, "GET", undefined, otherToken)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `${path}/${id}`,
          "PATCH",
          { revision: 0, completed: true },
          otherToken,
        )
      ).status,
      404,
    );
    let changed = await request(`${path}/${id}`, "PATCH", {
      revision: 0,
      completed: true,
    });
    assert.equal(changed.status, 200);
    const completed = object(object(await changed.json()).data);
    assert.equal(completed.revision, 1);
    assert.equal(typeof completed.completedAt, "string");
    assert.equal(
      (await request(`${path}/${id}`, "PATCH", { revision: 0, title: "stale" }))
        .status,
      409,
    );
    changed = await request(`${path}/${id}`, "PATCH", {
      revision: 1,
      title: "Read the introduction",
      completed: false,
    });
    assert.equal(changed.status, 200);
    assert.equal(object(object(await changed.json()).data).completedAt, null);
    assert.equal(
      (await request(`${path}/${id}`, "PATCH", { revision: 2, deleted: true }))
        .status,
      200,
    );
    response = object(await (await request(path)).json());
    assert.deepEqual(response.data, []);
    assert.equal(
      (await request(`${path}/${id}`, "PATCH", { revision: 3, deleted: false }))
        .status,
      200,
    );
    await prisma.goalV2.update({
      where: { id: goal.id },
      data: { status: "PAUSED" },
    });
    assert.equal(
      (
        await request(`${path}/${id}`, "PATCH", {
          revision: 4,
          completed: true,
        })
      ).status,
      409,
    );
    await prisma.goalV2.update({
      where: { id: goal.id },
      data: { status: "COMPLETED" },
    });
    assert.equal(
      (await request(path, "POST", { id: randomUUID(), title: "too late" }))
        .status,
      409,
    );
    assert.equal((await request(path)).status, 200);
    await prisma.goalV2.update({
      where: { id: goal.id },
      data: { status: "ACTIVE" },
    });
    await prisma.goalSubtask.createMany({
      data: Array.from({ length: 98 }, (_, index) => ({
        id: randomUUID(),
        goalId: goal.id,
        title: `Step ${index}`,
      })),
    });
    const competing = await Promise.all([
      request(path, "POST", { id: randomUUID(), title: "Last slot A" }),
      request(path, "POST", { id: randomUUID(), title: "Last slot B" }),
    ]);
    assert.deepEqual(competing.map((item) => item.status).sort(), [201, 409]);
    assert.equal(
      await prisma.goalSubtask.count({
        where: { goalId: goal.id, deletedAt: null },
      }),
      100,
    );
    const parent = await prisma.goalV2.findUniqueOrThrow({
      where: { id: goal.id },
    });
    assert.equal(parent.progressValue, 0);
    assert.equal(parent.completedOccurrences, 0);
    assert.equal(
      await prisma.goalRewardAward.count({ where: { goalId: goal.id } }),
      0,
    );
    const search = await request(
      `?filter=ACTIVE&query=${encodeURIComponent(suffix)}&limit=1`,
    );
    assert.equal(search.status, 200);
    response = object(await search.json());
    assert.ok(Array.isArray(response.data));
    assert.equal(response.data.length, 1);
    assert.equal(object(response.data[0]).id, goal.id);
    const hiddenSearch = object(
      await (
        await request(
          `?query=${encodeURIComponent(suffix)}`,
          "GET",
          undefined,
          otherToken,
        )
      ).json(),
    );
    assert.deepEqual(hiddenSearch.data, []);
  },
);
