import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { TestContext } from "node:test";
import type { Prisma } from "@prisma/client";
import express from "express";

import { prisma } from "../config/db.config";
import flexxRoutes from "../routes/flexx.routes";
import { generateAccessToken } from "../utils/auth.util";
import { fallbackFlexxDesigns } from "./flexx-design.service";
import { hasSubstantiveSignalDescriptions } from "./daily-observation.service";
import {
  FlexxAnswerError,
  flexxAnswerInputSchema,
  listFlexxAnswers,
  saveFlexxAnswer,
} from "./flexx-questionnaire.service";

const now = new Date("2026-10-19T23:40:00Z");
const designId = "collection:flexx-v3-99:0";
const input = {
  designId,
  localDateKey: "2026-10-20",
  answer: "Feeling steady",
  custom: false,
};
const question = {
  ...fallbackFlexxDesigns("all", 0)[3],
  layout: "questionnaire",
  blocks: [],
  questionnaire: {
    question: "What is taking up space in your mind today?",
    options: ["Feeling steady", "A little overwhelmed", "Taking it slowly"],
  },
};

function setup(context: TestContext, personalized = true) {
  const originalUser = prisma.user.findUnique;
  const originalCollection = prisma.flexxDesignCollection.findFirst;
  const originalSave = prisma.activitySignal.upsert;
  const originalList = prisma.activitySignal.findMany;
  Object.assign(prisma.user, {
    findUnique: async () => ({
      timezone: "Asia/Tokyo",
      rewindPersonalizationEnabled: personalized,
      suspendedAt: null,
    }),
  });
  Object.assign(prisma.flexxDesignCollection, {
    findFirst: async () => ({ designs: [question] }),
  });
  const writes = context.mock.fn(
    async (args: Prisma.ActivitySignalUpsertArgs) => ({
      metadata: args.create.metadata,
      privacyEligible: args.create.privacyEligible,
    }),
  );
  const reads = context.mock.fn(
    async (_args: Prisma.ActivitySignalFindManyArgs) => [
      {
        sourceId: designId,
        metadata: { answer: input.answer, custom: false },
        privacyEligible: personalized,
      },
    ],
  );
  Object.assign(prisma.activitySignal, { upsert: writes, findMany: reads });
  context.after(() => {
    Object.assign(prisma.user, { findUnique: originalUser });
    Object.assign(prisma.flexxDesignCollection, {
      findFirst: originalCollection,
    });
    Object.assign(prisma.activitySignal, {
      upsert: originalSave,
      findMany: originalList,
    });
  });
  return { writes, reads };
}

test("Flexx answers are bounded and cannot choose user IDs, prompts or attribution", () => {
  assert.equal(flexxAnswerInputSchema.safeParse(input).success, true);
  for (const bad of [
    { ...input, userId: "someone-else" },
    { ...input, question: "Fake prompt" },
    { ...input, answer: " " },
    { ...input, answer: "x".repeat(801) },
    { ...input, designId: "collection:../../secret:1" },
  ])
    assert.equal(flexxAnswerInputSchema.safeParse(bad).success, false);
});

test("answers join the authenticated owner's local-day reflection evidence without an AI call", async (context) => {
  const { writes } = setup(context);
  const calls = context.mock.method(globalThis, "fetch", async () => {
    throw new Error("No model calls should occur");
  });
  const result = await saveFlexxAnswer("owner", input, now);
  assert.equal(result.localDateKey, "2026-10-20");
  assert.equal(result.contributesToReflection, true);
  const write = writes.mock.calls[0]?.arguments[0];
  assert.ok(write);
  assert.equal(write.create.userId, "owner");
  assert.equal(write.create.sourceType, "FLEXX");
  assert.equal(write.create.eventType, "FLEXX_QUESTIONNAIRE_ANSWERED");
  assert.equal(write.create.localDateKey, "2026-10-20");
  assert.equal(write.create.privacyEligible, true);
  assert.ok(write.create.description.includes(question.questionnaire.question));
  assert.ok(write.create.description.includes(input.answer));
  assert.equal(
    hasSubstantiveSignalDescriptions([write.create.description]),
    true,
  );
  assert.deepEqual(write.update, {});
  assert.equal(calls.mock.callCount(), 0);
});

test("personalization-off answers remain private and reads are owner/date scoped", async (context) => {
  const { writes, reads } = setup(context, false);
  const saved = await saveFlexxAnswer("private-owner", input, now);
  assert.equal(saved.contributesToReflection, false);
  assert.equal(
    writes.mock.calls[0]?.arguments[0].create.privacyEligible,
    false,
  );
  const result = await listFlexxAnswers("private-owner", now);
  assert.equal(result.personalizationEnabled, false);
  assert.equal(result.answers[0]?.contributesToReflection, false);
  assert.equal(
    reads.mock.calls[0]?.arguments[0].where?.userId,
    "private-owner",
  );
  assert.equal(
    reads.mock.calls[0]?.arguments[0].where?.localDateKey,
    "2026-10-20",
  );
});

test("midnight, missing questions and invalid option answers fail before persistence", async (context) => {
  const { writes } = setup(context);
  await assert.rejects(
    saveFlexxAnswer("owner", { ...input, localDateKey: "2026-10-19" }, now),
    (error: unknown) =>
      error instanceof FlexxAnswerError && error.statusCode === 409,
  );
  await assert.rejects(
    saveFlexxAnswer(
      "owner",
      { ...input, answer: "Not a supplied choice" },
      now,
    ),
    (error: unknown) =>
      error instanceof FlexxAnswerError && error.statusCode === 400,
  );
  await assert.rejects(
    saveFlexxAnswer(
      "owner",
      { ...input, designId: "collection:flexx-v3-99:9" },
      now,
    ),
    (error: unknown) =>
      error instanceof FlexxAnswerError && error.statusCode === 404,
  );
  assert.equal(writes.mock.callCount(), 0);
  const result = await saveFlexxAnswer(
    "owner",
    { ...input, custom: true, answer: "I need a quieter evening." },
    now,
  );
  assert.equal(result.answer, "I need a quieter evening.");
});

test("retries reuse the same daily key and cannot overwrite an already answered question", async (context) => {
  const { writes } = setup(context);
  await saveFlexxAnswer("owner", input, now);
  await saveFlexxAnswer("owner", input, now);
  assert.deepEqual(
    writes.mock.calls[0]?.arguments[0].where,
    writes.mock.calls[1]?.arguments[0].where,
  );
  Object.assign(prisma.activitySignal, {
    upsert: async () => ({
      metadata: { answer: "Already answered", custom: true },
      privacyEligible: true,
    }),
  });
  await assert.rejects(
    saveFlexxAnswer("owner", input, now),
    (error: unknown) =>
      error instanceof FlexxAnswerError && error.statusCode === 409,
  );
});

test("questionnaire routes enforce auth and strict payload validation", async (context) => {
  const { writes } = setup(context);
  const app = express();
  app.use(express.json());
  app.use("/api/v1/flexx", flexxRoutes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/flexx/questionnaire/answers`;
  const headers = {
    authorization: `Bearer ${generateAccessToken("owner")}`,
    "content-type": "application/json",
  };
  try {
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...input, userId: "other" }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...input, localDateKey: "1900-01-01" }),
        })
      ).status,
      409,
    );
    assert.equal(writes.mock.callCount(), 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
