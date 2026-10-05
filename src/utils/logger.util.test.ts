import assert from "node:assert/strict";
import test from "node:test";

import { redactRequestPath } from "./logger.util";

test("request paths redact sensitive query values without hiding useful context", () => {
  assert.equal(
    redactRequestPath(
      "/api/v2/realtime/live/.websocket?token=secret.jwt.value&limit=30",
    ),
    "/api/v2/realtime/live/.websocket?token=REDACTED&limit=30",
  );
  assert.equal(
    redactRequestPath("/api/v2/auth/callback?code=abc123&state=keep-me"),
    "/api/v2/auth/callback?code=REDACTED&state=keep-me",
  );
  assert.equal(
    redactRequestPath("/api/v2/rewind/chats?limit=30"),
    "/api/v2/rewind/chats?limit=30",
  );
});
