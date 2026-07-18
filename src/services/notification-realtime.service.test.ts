import assert from "node:assert/strict";
import test from "node:test";
import {
  NotificationRealtimePublisher,
  type NotificationRealtimeSignal,
} from "./notification-realtime.service";
import type { NotificationPayload } from "./notification.service";

function createPayload(id: string): NotificationPayload {
  return {
    id,
    type: "system",
    title: `Title ${id}`,
    message: `Message ${id}`,
    createdAt: "2026-07-18T12:00:00.000Z",
  };
}

test("coalesces a notification burst into one signal per user", async () => {
  const published: Array<{
    channelName: string;
    eventName: string;
    signal: NotificationRealtimeSignal;
  }> = [];
  const publisher = new NotificationRealtimePublisher(
    async (channelName, eventName, signal): Promise<void> => {
      published.push({ channelName, eventName, signal });
    },
    { flushDelayMs: 60_000 },
  );

  publisher.enqueue("user-a", createPayload("first"));
  publisher.enqueue("user-a", createPayload("latest"));
  publisher.enqueue("user-b", createPayload("other"));
  await publisher.flushNow();

  assert.equal(published.length, 2);
  assert.deepEqual(published[0], {
    channelName: "user:user-a",
    eventName: "notifications_changed",
    signal: {
      latestNotification: createPayload("latest"),
      notificationCount: 2,
    },
  });
  assert.deepEqual(published[1], {
    channelName: "user:user-b",
    eventName: "notifications_changed",
    signal: {
      latestNotification: createPayload("other"),
      notificationCount: 1,
    },
  });
});

test("bounds a flush and retains overflow for the next interval", async () => {
  const published: string[] = [];
  const publisher = new NotificationRealtimePublisher(
    async (channelName): Promise<void> => {
      published.push(channelName);
    },
    { batchSize: 2, flushDelayMs: 60_000 },
  );

  publisher.enqueue("user-a", createPayload("a"));
  publisher.enqueue("user-b", createPayload("b"));
  publisher.enqueue("user-c", createPayload("c"));
  await publisher.flushNow();

  assert.equal(published.length, 2);
  assert.equal(publisher.getPendingUserCount(), 1);

  await publisher.flushNow();
  assert.equal(published.length, 3);
  assert.equal(publisher.getPendingUserCount(), 0);
});

test("retries a failed notification pulse without dropping it", async () => {
  let attempts = 0;
  const publisher = new NotificationRealtimePublisher(
    async (): Promise<void> => {
      attempts += 1;
      if (attempts === 1) throw new Error("rate limited");
    },
    { flushDelayMs: 60_000 },
  );

  publisher.enqueue("user-a", createPayload("retry"));
  await publisher.flushNow();
  assert.equal(publisher.getPendingUserCount(), 1);

  await publisher.flushNow();
  assert.equal(attempts, 2);
  assert.equal(publisher.getPendingUserCount(), 0);
});
