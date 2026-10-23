import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { TestContext } from "node:test";
import express from "express";
import type { Prisma } from "@prisma/client";

import { prisma } from "../config/db.config";
import flexxRoutes from "../routes/flexx.routes";
import { generateAccessToken } from "../utils/auth.util";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";
import { flexxDesignSchema } from "../validators/flexx-design.validators";
import { refreshScheduledFlexxDesigns } from "./flexx-generation.service";
import {
  decodeFlexxCursor,
  decodeFlexxFeedCursor,
  encodeFlexxCursor,
  fallbackFlexxDesigns,
  getFlexxDesignPage,
  parseFlexxDesignBatch,
  parseSavedFlexxDesign,
} from "./flexx-design.service";

const originalCollectionMethods = {
  findMany: prisma.flexxDesignCollection.findMany,
  create: prisma.flexxDesignCollection.create,
  updateMany: prisma.flexxDesignCollection.updateMany,
};
const QUESTIONNAIRE_INDICES: readonly number[] = [3, 5, 6, 7, 8, 9];
const QUESTIONNAIRE_PROMPTS = [
  "What felt most present today?",
  "What small moment do you want to remember?",
  "What would make tomorrow feel kinder?",
  "What did you need more of today?",
  "Which tiny thing surprised you today?",
  "What would you leave out of tomorrow?",
] as const;

function mockCollectionMethod<T extends (...args: never[]) => unknown>(
  context: TestContext,
  name: "findMany" | "create" | "updateMany",
  implementation: T,
) {
  const delegate = prisma.flexxDesignCollection;
  const original = originalCollectionMethods[name];
  const mocked = context.mock.fn(implementation);
  Object.assign(delegate, { [name]: mocked });
  context.after(() => Object.assign(delegate, { [name]: original }));
  return mocked;
}

async function setup(context: TestContext): Promise<void> {
  const key = Env.OPENROUTER_API_KEY;
  Env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  context.after(() => {
    Env.OPENROUTER_API_KEY = key;
  });
  context.mock.method(logger, "info", () => logger);
  context.mock.method(logger, "warn", () => logger);
  context.mock.method(logger, "error", () => logger);
  mockCollectionMethod(context, "findMany", async () => [
    { id: "saved-two", designs: generatedDesigns(1) },
    { id: "saved-one", designs: generatedDesigns(0) },
  ]);
}

function generatedDesigns(seed = 0) {
  return fallbackFlexxDesigns("all", seed).map((design, index) => {
    const questionIndex = QUESTIONNAIRE_INDICES.indexOf(index);
    if (questionIndex >= 0) {
      const question = QUESTIONNAIRE_PROMPTS[questionIndex];
      if (!question) throw new Error("Missing questionnaire test fixture");
      return {
        ...design,
        category: "rewind",
        layout: "questionnaire",
        symbol: "rewind",
        blocks: [],
        editorial: null,
        questionnaire: {
          question,
          options: ["I felt grounded", "I need a little space", "Not sure yet"],
        },
        likedBy: index % 2 ? ["ella"] : [],
      };
    }
    return { ...design, likedBy: index % 3 ? ["ella", "lyra"] : [] };
  });
}

function completion(): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({ designs: generatedDesigns() }),
        },
      },
    ],
    usage: { total_tokens: 100 },
  });
}

test("Flexx validates layouts and metric bindings, rejecting executable content and invented values", () => {
  const base = fallbackFlexxDesigns("all", 0)[0];
  assert.ok(base);
  assert.ok(base.editorial);
  assert.equal(flexxDesignSchema.safeParse(base).success, true);
  for (const input of [
    { ...base, headline: "You completed 999 goals" },
    { ...base, html: "<script>bad()</script>" },
    { ...base, palette: "#ffffff" },
    { ...base, author: { kind: "partner", partnerId: "imaginary-person" } },
    { ...base, author: { kind: "self", partnerId: "ella" } },
    { ...base, simulatedLikes: -1 },
    { ...base, simulatedLikes: 25_001 },
    { ...base, simulatedLikes: 1.5 },
    { ...base, blocks: [{ slot: "hero", metric: "madeUpScore" }] },
    { ...base, blocks: [{ slot: "hero", metric: "rewindSessions" }] },
    {
      ...base,
      blocks: [
        { slot: "hero", metric: "totalGoals" },
        { slot: "hero", metric: "currentStreak" },
      ],
    },
    {
      ...base,
      layout: "ring",
      blocks: [{ slot: "hero", metric: "totalCheckIns" }],
    },
  ])
    assert.equal(flexxDesignSchema.safeParse(input).success, false);
});

test("legacy author/count/white maps are normalized without changing stored history", () => {
  const base = fallbackFlexxDesigns("all", 0)[0];
  assert.ok(base);
  const {
    editorial: _editorial,
    likedBy: _likedBy,
    questionnaire: _question,
    ...rest
  } = base;
  const legacy = {
    ...rest,
    palette: "paper",
    author: { kind: "self", partnerId: null },
    simulatedLikes: 9000,
  };
  const result = parseSavedFlexxDesign(legacy);
  assert.deepEqual(result.author, { partnerIds: ["ella"] });
  assert.equal(result.palette, "slate");
  assert.equal(result.editorial, null);
  assert.deepEqual(result.likedBy, []);
  assert.equal("simulatedLikes" in result, false);
  assert.equal(legacy.author.kind, "self");

  const { editorial: _savedEditorial, ...savedDesign } = base;
  assert.equal(parseSavedFlexxDesign(savedDesign).editorial, null);
});

test("mixed design batches need distinct compositions and varied palettes and layouts", () => {
  const batch = fallbackFlexxDesigns("all", 0);
  assert.equal(parseFlexxDesignBatch({ designs: batch }, "all").length, 10);
  assert.throws(() =>
    parseFlexxDesignBatch(
      { designs: Array.from({ length: 10 }, () => batch[0]) },
      "all",
    ),
  );
  assert.throws(() => parseFlexxDesignBatch({ designs: batch }, "daily"));
  assert.throws(() =>
    parseFlexxDesignBatch({ designs: fallbackFlexxDesigns("daily", 0) }, "all"),
  );
  const withoutEditorial = batch.map((design, index) =>
    index === 0 ? { ...design, editorial: null } : design,
  );
  assert.throws(() =>
    parseFlexxDesignBatch({ designs: withoutEditorial }, "all"),
  );
});

test("Flexx cursors are bounded, category-specific and bound to the authenticated owner", () => {
  const cursor = encodeFlexxCursor("daily", 2, "owner");
  assert.equal(decodeFlexxCursor(cursor, "daily", "owner"), 2);
  assert.equal(decodeFlexxCursor(undefined, "daily", "owner"), 0);
  assert.throws(() => decodeFlexxCursor(cursor, "daily", "someone-else"));
  assert.throws(() => decodeFlexxCursor(cursor, "all", "owner"));
  assert.throws(() => decodeFlexxCursor(`${cursor}x`, "daily", "owner"));
  assert.throws(() =>
    decodeFlexxCursor(
      encodeFlexxCursor("daily", 100, "owner"),
      "daily",
      "owner",
    ),
  );
});

test("concurrent feed reads use saved designs with owner-bound snapshot cursors and zero AI calls", async (context) => {
  await setup(context);
  const calls = context.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      assert.equal(typeof init?.body, "string");
      assert.ok(String(init?.body).includes('"FLEXX_DESIGNS"') === false);
      assert.equal(String(init?.body).includes("private-user-name"), false);
      return completion();
    },
  );
  const [first, other] = await Promise.all([
    getFlexxDesignPage({ category: "all", page: 0, userId: "owner" }),
    getFlexxDesignPage({
      category: "all",
      page: 0,
      userId: "private-user-name",
    }),
  ]);
  assert.equal(first.source, "ai");
  assert.deepEqual(first.designs, other.designs);
  assert.notEqual(first.nextCursor, other.nextCursor);
  await getFlexxDesignPage({ category: "all", page: 0, userId: "owner" });
  assert.equal(calls.mock.callCount(), 0);
  assert.ok(first.nextCursor);
  const cursor = decodeFlexxFeedCursor(first.nextCursor, "all", "owner");
  assert.equal(cursor.page, 1);
  assert.ok(cursor.snapshot);
  const next = await getFlexxDesignPage({
    category: "all",
    userId: "owner",
    ...cursor,
  });
  assert.equal(next.nextCursor, null);
  assert.ok(
    next.designs.every(
      (design) =>
        !first.designs.some((otherDesign) => otherDesign.id === design.id),
    ),
  );
  assert.equal(calls.mock.callCount(), 0);
});

test("empty saved feed returns starters and a terminal cursor without generating on demand", async (context) => {
  await setup(context);
  mockCollectionMethod(context, "findMany", async () => []);
  const calls = context.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { message: "Unavailable", code: 400 } },
      { status: 400 },
    ),
  );
  const first = await getFlexxDesignPage({
    category: "all",
    page: 0,
    userId: "owner",
  });
  const second = await getFlexxDesignPage({
    category: "all",
    page: 1,
    userId: "owner",
  });
  assert.equal(first.source, "fallback");
  assert.equal(second.designs.length, 0);
  assert.equal(first.nextCursor, null);
  assert.equal(first.designs.length, 10);
  assert.equal(calls.mock.callCount(), 0);
});

test("authenticated design endpoint validates query and cursor before generation", async (context) => {
  await setup(context);
  const original = prisma.user.findUnique;
  Object.assign(prisma.user, {
    findUnique: async () => ({ suspendedAt: null }),
  });
  context.after(() => Object.assign(prisma.user, { findUnique: original }));
  // Only the provider URL is mocked; HTTP calls to Express remain real.
  const realFetch = globalThis.fetch;
  const aiCalls: string[] = [];
  context.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (String(input).startsWith("https://openrouter.ai/")) {
        aiCalls.push(String(input));
        return completion();
      }
      return realFetch(input, init);
    },
  );
  const app = express();
  app.use("/api/v1/flexx", flexxRoutes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/flexx/designs`;
  const headers = { Authorization: `Bearer ${generateAccessToken("owner")}` };
  try {
    assert.equal((await realFetch(endpoint)).status, 401);
    assert.equal(
      (await realFetch(`${endpoint}?category=invalid`, { headers })).status,
      400,
    );
    assert.equal(
      (await realFetch(`${endpoint}?cursor=broken`, { headers })).status,
      400,
    );
    assert.equal(
      (await realFetch(`${endpoint}?category=all&limit=999`, { headers }))
        .status,
      400,
    );
    assert.equal(aiCalls.length, 0);
    const result = await realFetch(`${endpoint}?category=all`, { headers });
    assert.equal(result.status, 200);
    const body: unknown = await result.json();
    assert.ok(body && typeof body === "object" && "data" in body);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(aiCalls.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("scheduled generation persists one batch per cycle despite concurrent workers", async (context) => {
  await setup(context);
  assert.equal(
    generatedDesigns().filter((design) => design.questionnaire).length,
    6,
  );
  assert.equal(
    generatedDesigns().filter(
      (design) => !design.questionnaire && design.editorial,
    ).length,
    4,
  );
  let created = false;
  const create = mockCollectionMethod(context, "create", async () => {
    if (created)
      throw Object.assign(new Error("Unique cycle"), { code: "P2002" });
    created = true;
    return {};
  });
  const writes = mockCollectionMethod(
    context,
    "updateMany",
    async (input: Prisma.FlexxDesignCollectionUpdateManyArgs) => ({
      count: input.data.status === "READY" ? 1 : 0,
    }),
  );
  const calls = context.mock.method(globalThis, "fetch", async () =>
    completion(),
  );
  const now = new Date();
  const results = await Promise.all([
    refreshScheduledFlexxDesigns(now),
    refreshScheduledFlexxDesigns(now),
  ]);
  assert.deepEqual(results.map((result) => result.generated).sort(), [0, 10]);
  assert.equal((await refreshScheduledFlexxDesigns(now)).generated, 0);
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(create.mock.callCount(), 3);
  const publish = writes.mock.calls.find(
    (call) => call.arguments[0]?.data.status === "READY",
  )?.arguments[0];
  assert.ok(publish);
  assert.ok(JSON.stringify(publish).includes('"likedBy"'));
  assert.ok(JSON.stringify(publish).includes('"questionnaire"'));
  assert.ok(JSON.stringify(publish).includes('"leaseToken"'));
});

test("scheduled generation corrects one batch that fails Flexx schema validation", async (context) => {
  await setup(context);
  mockCollectionMethod(context, "create", async () => ({}));
  mockCollectionMethod(
    context,
    "updateMany",
    async (input: Prisma.FlexxDesignCollectionUpdateManyArgs) => ({
      count: input.data.status === "READY" ? 1 : 0,
    }),
  );
  const invalidDesigns = generatedDesigns().map((design, index) =>
    index === 0 ? { ...design, headline: "100 tasks completed" } : design,
  );
  let calls = 0;
  const fetch = context.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return calls === 1
      ? Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({ designs: invalidDesigns }),
              },
            },
          ],
        })
      : completion();
  });

  const result = await refreshScheduledFlexxDesigns(new Date());

  assert.equal(result.generated, 10);
  assert.equal(calls, 2);
  assert.equal(fetch.mock.callCount(), 2);
});

test("scheduled failures do not publish partial content and delay retries", async (context) => {
  await setup(context);
  mockCollectionMethod(context, "create", async () => ({}));
  const writes = mockCollectionMethod(
    context,
    "updateMany",
    async (_input: Prisma.FlexxDesignCollectionUpdateManyArgs) => ({
      count: 1,
    }),
  );
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: { message: "Unavailable", code: 400 } },
      { status: 400 },
    ),
  );
  const now = new Date();
  await assert.rejects(refreshScheduledFlexxDesigns(now));
  const write = writes.mock.calls[0]?.arguments[0];
  assert.ok(write);
  assert.equal(write.data.status, "FAILED");
  assert.ok(write.data.leaseUntil instanceof Date);
  assert.ok(write.data.leaseUntil.getTime() > now.getTime());
  const saved = await getFlexxDesignPage({
    category: "all",
    page: 0,
    userId: "owner",
  });
  assert.equal(saved.source, "ai");
  assert.equal(saved.designs.length, 10);
});

test("an expired generation lease can be reclaimed and publication is token-guarded", async (context) => {
  await setup(context);
  mockCollectionMethod(context, "create", async () => {
    throw Object.assign(new Error("Existing cycle"), { code: "P2002" });
  });
  const writes = mockCollectionMethod(
    context,
    "updateMany",
    async (_input: Prisma.FlexxDesignCollectionUpdateManyArgs) => ({
      count: 1,
    }),
  );
  context.mock.method(globalThis, "fetch", async () => completion());
  const now = new Date();
  assert.equal((await refreshScheduledFlexxDesigns(now)).generated, 10);
  const claim = writes.mock.calls[0]?.arguments[0];
  const publish = writes.mock.calls[1]?.arguments[0];
  assert.ok(claim && publish);
  assert.ok(claim.where && publish.where);
  assert.deepEqual(claim.where.leaseUntil, { lte: now });
  assert.equal(claim.data.leaseToken, publish.where.leaseToken);
  assert.deepEqual(claim.where.status, { in: ["GENERATING", "FAILED"] });
});

test("pagination keeps its published-at snapshot while newer collections arrive", async (context) => {
  await setup(context);
  const reads = mockCollectionMethod(
    context,
    "findMany",
    async (_input: Prisma.FlexxDesignCollectionFindManyArgs) => [
      { id: "snapshot-b", designs: generatedDesigns(1) },
      { id: "snapshot-a", designs: generatedDesigns(0) },
    ],
  );
  const first = await getFlexxDesignPage({
    category: "all",
    page: 0,
    userId: "owner",
  });
  assert.ok(first.nextCursor);
  const cursor = decodeFlexxFeedCursor(first.nextCursor, "all", "owner");
  await getFlexxDesignPage({ category: "all", userId: "owner", ...cursor });
  const firstRead = reads.mock.calls[0]?.arguments[0];
  const nextRead = reads.mock.calls[1]?.arguments[0];
  assert.deepEqual(firstRead?.where?.publishedAt, nextRead?.where?.publishedAt);
  assert.equal(nextRead?.take, 24);
});
