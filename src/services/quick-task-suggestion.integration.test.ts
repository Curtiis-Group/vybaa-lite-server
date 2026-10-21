import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import goalRoutes from "../routes/goal-v2.routes";
import { generateAccessToken } from "../utils/auth.util";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";
import { ensureDailyObservation } from "./daily-observation.service";

test(
  "quick task suggestions persist during the existing AI cycle and reads are owner-safe, private, fresh and AI-free",
  {
    skip: !process.env.SUBTASK_TEST_DATABASE_URL,
  },
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
        email: `suggestions-${randomUUID()}@example.test`,
        isConfirmed: true,
        timezone: "Africa/Lagos",
      },
    });
    const other = await prisma.user.create({
      data: { email: `other-${randomUUID()}@example.test`, isConfirmed: true },
    });
    const now = DateTime.now().setZone("Africa/Lagos");
    const day = now.toISODate();
    assert.ok(day);
    context.after(async () => {
      await prisma.user.deleteMany({
        where: { id: { in: [owner.id, other.id] } },
      });
      await prisma.$disconnect();
    });
    const signal = await prisma.activitySignal.create({
      data: {
        userId: owner.id,
        localDateKey: day,
        happenedAt: new Date(),
        sourceId: "reading-intent",
        sourceType: "REWIND_CHAT",
        eventType: "CHAT_MESSAGE",
        dedupeKey: `suggestions:${owner.id}`,
        description:
          "The user said they wanted to get back into reading, starting with one short chapter rather than a whole book, as a small step this week.",
      },
    });
    const otherSignal = await prisma.activitySignal.create({
      data: {
        userId: other.id,
        localDateKey: day,
        happenedAt: new Date(),
        sourceId: "private-intent",
        sourceType: "JOURNAL",
        eventType: "JOURNAL_WRITTEN",
        dedupeKey: `suggestions:${other.id}`,
        description: "Private journal",
      },
    });
    const originalKey = Env.OPENROUTER_API_KEY;
    Env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
    context.after(() => {
      Env.OPENROUTER_API_KEY = originalKey;
    });
    context.mock.method(logger, "info", () => logger);
    const request = context.mock.method(
      globalThis,
      "fetch",
      async (_url: unknown, init?: RequestInit) => {
        assert.equal(typeof init?.body, "string");
        if (typeof init?.body !== "string")
          throw new Error("Missing generation body");
        assert.ok(init.body.includes(signal.id));
        assert.ok(init.body.includes("taskSuggestions"));
        return Response.json({
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  confidence: 0.8,
                  description: "You seemed ready for a small restart.",
                  homeGreeting: "Hey, small starts count",
                  observations: ["You mentioned wanting to read again."],
                  reflection: "A manageable step might help.",
                  journalDraft: "I want to get back into reading.",
                  taskSuggestions: [
                    {
                      title: "Read one chapter",
                      reason: "You mentioned wanting to return to reading.",
                      signalIds: [signal.id],
                    },
                    {
                      title: "Steal another user's suggestion",
                      reason: "Invalid ownership",
                      signalIds: [otherSignal.id],
                    },
                  ],
                }),
              },
            },
          ],
        });
      },
    );
    const generated = await ensureDailyObservation({
      userId: owner.id,
      localDateKey: day,
      timezone: "Africa/Lagos",
    });
    assert.ok(generated);
    assert.equal(request.mock.callCount(), 1);
    const saved = await prisma.dailyObservation.findUniqueOrThrow({
      where: { id: generated.id },
    });
    assert.deepEqual(saved.taskSuggestions, [
      {
        title: "Read one chapter",
        reason: "You mentioned wanting to return to reading.",
        signalIds: [signal.id],
      },
    ]);
    await ensureDailyObservation({
      userId: owner.id,
      localDateKey: day,
      timezone: "Africa/Lagos",
    });
    assert.equal(request.mock.callCount(), 1);
    request.mock.restore();

    const app = express();
    app.use(express.json());
    app.use("/api/v2/goals", goalRoutes);
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/api/v2/goals/suggestions`;
    context.after(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
    async function read(userId = owner.id) {
      return fetch(endpoint, {
        headers: { Authorization: `Bearer ${generateAccessToken(userId)}` },
      });
    }
    assert.equal((await fetch(endpoint)).status, 401);
    const response = await read();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const first = await response.json();
    assert.equal(first.data.length, 1);
    assert.equal(first.data[0].title, "Read one chapter");
    assert.equal(first.data[0].signalIds, undefined);
    assert.deepEqual((await (await read(other.id)).json()).data, []);
    assert.deepEqual((await (await read()).json()).data, first.data);
    assert.equal(await prisma.goalV2.count({ where: { userId: owner.id } }), 0);
    await prisma.goalV2.create({
      data: {
        userId: owner.id,
        title: "READ one chapter!",
        targetType: "CHECK_IN_COUNT",
        targetValue: 1,
        scheduleType: "ONE_TIME",
        startDate: new Date(),
        hardStopDate: new Date(),
      },
    });
    assert.deepEqual((await (await read()).json()).data, []);
    await prisma.goalV2.deleteMany({ where: { userId: owner.id } });
    await prisma.activitySignal.update({
      where: { id: signal.id },
      data: { privacyEligible: false },
    });
    assert.deepEqual((await (await read()).json()).data, []);
    await prisma.activitySignal.update({
      where: { id: signal.id },
      data: { privacyEligible: true },
    });
    await prisma.user.update({
      where: { id: owner.id },
      data: { rewindPersonalizationEnabled: false },
    });
    assert.deepEqual((await (await read()).json()).data, []);
    await prisma.user.update({
      where: { id: owner.id },
      data: { rewindPersonalizationEnabled: true },
    });
    await prisma.dailyObservation.update({
      where: { id: saved.id },
      data: { localDateKey: now.minus({ days: 4 }).toISODate() ?? "" },
    });
    assert.deepEqual((await (await read()).json()).data, []);
  },
);
