import assert from "node:assert/strict";
import test from "node:test";
import { createRewindWsToken, verifyRewindWsToken } from "./rewind.controller";

process.env.JWT_SECRET = "test-secret-that-is-not-a-production-default";

test("issues and verifies 100 concurrent-client token batches without replay", () => {
  const startedAt = performance.now();
  const tokens = Array.from({ length: 100 }, (_, index) =>
    createRewindWsToken(`stress-user-${index}`, "ella", `session-${index}`),
  );
  const verified = tokens.map(verifyRewindWsToken);
  assert.equal(verified.filter(Boolean).length, 100);
  assert.equal(tokens.map(verifyRewindWsToken).filter(Boolean).length, 0);
  assert.ok(performance.now() - startedAt < 2_000);
});

test("keeps token verification memory bounded after expiry cleanup", () => {
  const before = process.memoryUsage().heapUsed;
  for (let index = 0; index < 5_000; index += 1) {
    verifyRewindWsToken(createRewindWsToken(`load-user-${index}`, "jake"));
  }
  const growth = process.memoryUsage().heapUsed - before;
  assert.ok(growth < 64 * 1024 * 1024, `heap grew by ${growth} bytes`);
});
