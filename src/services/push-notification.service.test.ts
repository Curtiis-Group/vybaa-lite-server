import assert from "node:assert/strict";
import test from "node:test";
import { serializePushPayload } from "./push-notification.service";

test("flattens a nested notification route into FCM data", () => {
  assert.deepEqual(
    serializePushPayload({
      data: { route: "/app/r/rewind_123", type: "rewind_summary_ready" },
      id: "notification_123",
      message: "Your reflection is ready.",
      title: "Your Rewind summary is ready",
    }),
    {
      data: JSON.stringify({
        route: "/app/r/rewind_123",
        type: "rewind_summary_ready",
      }),
      id: "notification_123",
      message: "Your reflection is ready.",
      route: "/app/r/rewind_123",
      title: "Your Rewind summary is ready",
    },
  );
});

test("does not create a route field from unsafe notification data", () => {
  assert.deepEqual(
    serializePushPayload({
      data: { route: "https://untrusted.example" },
      id: "notification_456",
    }),
    {
      data: JSON.stringify({ route: "https://untrusted.example" }),
      id: "notification_456",
    },
  );
});

test("does not flatten a protocol-relative route", () => {
  assert.deepEqual(
    serializePushPayload({
      data: { route: "//untrusted.example/app/rewind" },
      id: "notification_789",
    }),
    {
      data: JSON.stringify({ route: "//untrusted.example/app/rewind" }),
      id: "notification_789",
    },
  );
});
