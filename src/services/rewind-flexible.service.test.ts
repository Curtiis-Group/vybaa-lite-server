import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  RewindFrequency,
  RewindIntent,
  RewindSessionStatus,
} from "@prisma/client";
import type { Prisma, RewindRoutine } from "@prisma/client";

import { prisma } from "../config/db.config";
import {
  getRewindRoutineOverview,
  materializeRewindOccurrences,
  RewindRoutineAvailabilityError,
  saveRewindRoutine,
  startOrResumeRewindOccurrence,
} from "./rewind-routine.service";
import { downgradeRewindRoutineToFreeTier } from "./subscription-downgrade.service";

const now = new Date("2026-10-18T23:30:00Z");

function mockStore(context: TestContext) {
  const routine: RewindRoutine = {
    id: "routine",
    userId: "owner",
    frequency: RewindFrequency.FLEXIBLE,
    intent: RewindIntent.SPOT_PATTERNS,
    times: [],
    enabled: true,
    customIntent: null,
    createdAt: now,
    updatedAt: now,
  };
  const user = {
    id: "owner",
    timezone: "Africa/Lagos",
    rewindPersona: "ella",
    rewindRoutine: routine,
  };
  type Session = {
    id: string;
    userId: string;
    personaId: string;
    isTestSession: boolean;
    status: RewindSessionStatus;
    scheduledFor: Date | null;
    windowEndsAt: Date | null;
    startedAt: Date | null;
    sessionDateKey: string | null;
    timezone: string | null;
    responses?: Prisma.JsonValue;
  };
  const sessions: Session[] = [];
  const originals = {
    user: { findUnique: prisma.user.findUnique, update: prisma.user.update },
    routine: {
      findUnique: prisma.rewindRoutine.findUnique,
      upsert: prisma.rewindRoutine.upsert,
    },
    session: {
      findFirst: prisma.rewindSession.findFirst,
      findMany: prisma.rewindSession.findMany,
      create: prisma.rewindSession.create,
      upsert: prisma.rewindSession.upsert,
      deleteMany: prisma.rewindSession.deleteMany,
      updateMany: prisma.rewindSession.updateMany,
    },
    transaction: prisma.$transaction,
    queryRaw: prisma.$queryRaw,
  };
  const lock = context.mock.fn(async () => [{ id: user.id }]);
  const create = context.mock.fn(async ({ data }: { data: Session }) => {
    sessions.push({ ...data, isTestSession: false });
    return sessions.at(-1);
  });
  const upsert = context.mock.fn(async () => {
    throw new Error("Flexible must not materialize slots");
  });
  const deleteMany = context.mock.fn(
    async (_args: Prisma.RewindSessionDeleteManyArgs) => ({ count: 0 }),
  );
  const updateMany = context.mock.fn(
    async (_args: Prisma.RewindSessionUpdateManyArgs) => ({ count: 0 }),
  );
  const routineUpsert = context.mock.fn(
    async (_args: Prisma.RewindRoutineUpsertArgs) => routine,
  );
  Object.assign(prisma.user, {
    findUnique: async () => user,
    update: async () => user,
  });
  Object.assign(prisma.rewindRoutine, {
    findUnique: async () => routine,
    upsert: routineUpsert,
  });
  Object.assign(prisma.rewindSession, {
    create,
    upsert,
    deleteMany,
    updateMany,
    findMany: async () => [],
    findFirst: async ({ where }: Prisma.RewindSessionFindFirstArgs) => {
      assert.equal(where?.userId, "owner");
      assert.equal(where?.isTestSession, false);
      return (
        sessions.find((session) => {
          if (session.userId !== where.userId || session.isTestSession)
            return false;
          if (where.id && session.id !== where.id) return false;
          if (where.scheduledFor === null && session.scheduledFor !== null)
            return false;
          if (where.windowEndsAt === null && session.windowEndsAt !== null)
            return false;
          if (typeof where.status === "string")
            return session.status === where.status;
          return (
            session.status === RewindSessionStatus.COMPLETED ||
            session.status === RewindSessionStatus.MISSED
          );
        }) ?? null
      );
    },
  });
  // Model transaction serialization in memory; the real implementation locks
  // PostgreSQL's user row, which is not exercised by this unit test.
  let pending = Promise.resolve();
  Object.assign(prisma, {
    $queryRaw: lock,
    $transaction: async <T>(
      work: (transaction: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> => {
      const previous = pending;
      let release = (): void => {};
      pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await work(prisma);
      } finally {
        release();
      }
    },
  });
  context.after(() => {
    Object.assign(prisma.user, originals.user);
    Object.assign(prisma.rewindRoutine, originals.routine);
    Object.assign(prisma.rewindSession, originals.session);
    Object.assign(prisma, {
      $transaction: originals.transaction,
      $queryRaw: originals.queryRaw,
    });
  });
  return {
    routine,
    user,
    sessions,
    create,
    upsert,
    lock,
    deleteMany,
    updateMany,
    routineUpsert,
  };
}

test("Flexible overview is read-only and never materializes scheduled slots", async (context) => {
  const store = mockStore(context);
  // Defensive against stale times left over from a scheduled routine.
  store.routine.times = ["08:00", "20:00"];
  await materializeRewindOccurrences({ now, user: store.user });
  const overview = await getRewindRoutineOverview({ now, userId: "owner" });
  assert.equal(overview?.currentSession, null);
  assert.equal(overview?.nextSession, null);
  assert.equal(store.create.mock.callCount(), 0);
  assert.equal(store.upsert.mock.callCount(), 0);
});

test("simultaneous Flexible requests create one session and preserve answers on resume", async (context) => {
  const store = mockStore(context);
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      startOrResumeRewindOccurrence({ now, userId: "owner" }),
    ),
  );
  assert.equal(new Set(results.map((result) => result.occurrence.id)).size, 1);
  assert.equal(store.create.mock.callCount(), 1);
  assert.equal(store.lock.mock.callCount(), 5);
  const session = store.sessions[0];
  assert.ok(session);
  session.responses = { answers: ["Feeling good"] };
  const resumed = await startOrResumeRewindOccurrence({
    now: new Date("2026-10-21T10:00:00Z"),
    requestedSessionId: session.id,
    userId: "owner",
  });
  assert.deepEqual(resumed.occurrence.responses, session.responses);
  assert.equal(resumed.occurrence.windowEndsAt, null);
  assert.equal(resumed.occurrence.scheduledFor, null);
  assert.equal(resumed.occurrence.sessionDateKey, "2026-10-19");
  assert.equal(resumed.occurrence.personaId, "ella");
});

test("completed Flexible sessions remain in overview and allow a fresh Rewind immediately", async (context) => {
  const store = mockStore(context);
  const first = await startOrResumeRewindOccurrence({ now, userId: "owner" });
  store.sessions[0].status = RewindSessionStatus.COMPLETED;
  const overview = await getRewindRoutineOverview({ now, userId: "owner" });
  assert.equal(overview?.latestSession?.id, first.occurrence.id);
  assert.equal(overview?.currentSession, null);
  const second = await startOrResumeRewindOccurrence({ now, userId: "owner" });
  assert.notEqual(second.occurrence.id, first.occurrence.id);
  assert.equal(store.create.mock.callCount(), 2);
});

test("explicit foreign, missing, completed and test session IDs cannot be resumed", async (context) => {
  const store = mockStore(context);
  await startOrResumeRewindOccurrence({ now, userId: "owner" });
  const original = store.sessions[0];
  store.sessions.push(
    { ...original, id: "foreign", userId: "someone-else" },
    { ...original, id: "closed", status: RewindSessionStatus.COMPLETED },
    { ...original, id: "test", isTestSession: true },
  );
  for (const requestedSessionId of ["foreign", "missing", "closed", "test"]) {
    await assert.rejects(
      startOrResumeRewindOccurrence({
        now,
        requestedSessionId,
        userId: "owner",
      }),
      (error: unknown) =>
        error instanceof RewindRoutineAvailabilityError &&
        error.reason === "not_resumable",
    );
  }
  assert.equal(store.create.mock.callCount(), 1);
});

test("disabled Flexible routines cannot start and are not downgraded to a timed schedule", async (context) => {
  const store = mockStore(context);
  await downgradeRewindRoutineToFreeTier("owner");
  assert.equal(store.routineUpsert.mock.callCount(), 0);
  store.routine.enabled = false;
  await assert.rejects(
    startOrResumeRewindOccurrence({ now, userId: "owner" }),
    (error: unknown) =>
      error instanceof RewindRoutineAvailabilityError &&
      error.reason === "not_configured",
  );
  assert.equal(store.create.mock.callCount(), 0);
});

test("switching to Flexible removes unstarted windows but preserves the active questionnaire", async (context) => {
  const store = mockStore(context);
  await saveRewindRoutine({
    userId: "owner",
    input: {
      frequency: RewindFrequency.FLEXIBLE,
      intent: RewindIntent.SPOT_PATTERNS,
      times: ["08:00", "20:00"],
      timezone: "Africa/Lagos",
    },
  });
  const removal = store.deleteMany.mock.calls[0].arguments[0].where;
  assert.equal(removal?.userId, "owner");
  assert.equal(removal?.status, RewindSessionStatus.SCHEDULED);
  assert.equal(removal?.OR?.length, 2);
  const conversion = store.updateMany.mock.calls[0].arguments[0];
  assert.equal(conversion.where?.status, RewindSessionStatus.IN_PROGRESS);
  assert.equal(conversion.where?.userId, "owner");
  assert.deepEqual(conversion.data, { scheduledFor: null, windowEndsAt: null });
  assert.deepEqual(
    store.routineUpsert.mock.calls[0].arguments[0].update?.times,
    [],
  );
});
