import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import type { Prisma } from "@prisma/client";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import { getPaginatedRewindSessions } from "./rewind.controller";

test("reflection pages use stable chronological ordering, not last-edited order", async (context) => {
  const original = {
    findMany: prisma.rewindSession.findMany,
    count: prisma.rewindSession.count,
    groupBy: prisma.rewindSession.groupBy,
  };
  const findMany = context.mock.fn(
    async (_args?: Prisma.RewindSessionFindManyArgs) => [],
  );
  Object.assign(prisma.rewindSession, {
    findMany,
    count: context.mock.fn(async () => 0),
    groupBy: context.mock.fn(async () => []),
  });
  context.after(() => {
    Object.assign(prisma.rewindSession, original);
  });
  const app = express();
  app.get("/history", (request: AuthRequest, response) => {
    request.userId = "history-owner";
    return getPaginatedRewindSessions(request, response);
  });
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/history?page=2&limit=2&personaId=ella&day=2026-10-18`,
    );
    assert.equal(response.status, 200);
    const historyQuery = findMany.mock.calls.find(
      (call) => call.arguments[0]?.take === 2,
    )?.arguments[0];
    assert.ok(historyQuery);
    assert.deepEqual(historyQuery.orderBy, [
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    assert.equal(historyQuery.skip, 2);
    assert.deepEqual(historyQuery.where, {
      userId: "history-owner",
      isTestSession: false,
      personaId: "ella",
      sessionDateKey: "2026-10-18",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
