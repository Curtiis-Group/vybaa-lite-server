import logger from "../utils/logger.util";
import type { NotificationPayload } from "./notification.service";
import { publishUserRealtimeEvent } from "./realtime-websocket.service";

export interface NotificationRealtimeSignal {
  latestNotification: NotificationPayload;
  notificationCount: number;
}

export type NotificationRealtimePublish = (
  channelName: string,
  eventName: "notifications_changed",
  signal: NotificationRealtimeSignal,
) => Promise<void>;

export interface NotificationRealtimePublisherOptions {
  batchSize?: number;
  flushDelayMs?: number;
  minimumIntervalMs?: number;
  retryDelayMs?: number;
}

type PendingNotificationSignal = NotificationRealtimeSignal;

const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_DELAY_MS = 150;
const DEFAULT_MINIMUM_INTERVAL_MS = 1000;
const DEFAULT_RETRY_DELAY_MS = 5000;

async function publishToRealtimeSocket(
  channelName: string,
  eventName: "notifications_changed",
  signal: NotificationRealtimeSignal,
): Promise<void> {
  const userId = channelName.startsWith("user:")
    ? channelName.slice("user:".length)
    : channelName;
  await publishUserRealtimeEvent(userId, eventName, signal);
}

/**
 * Converts individual notification writes into a bounded, source-of-truth
 * invalidation signal. Notification data remains in the database and FCM
 * continues to deliver the individual native push messages.
 */
export class NotificationRealtimePublisher {
  private readonly batchSize: number;
  private readonly flushDelayMs: number;
  private readonly minimumIntervalMs: number;
  private readonly pendingByUser = new Map<string, PendingNotificationSignal>();
  private readonly publish: NotificationRealtimePublish;
  private readonly retryDelayMs: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  public constructor(
    publish: NotificationRealtimePublish = publishToRealtimeSocket,
    options: NotificationRealtimePublisherOptions = {},
  ) {
    this.publish = publish;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.minimumIntervalMs =
      options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  }

  public enqueue(userId: string, notification: NotificationPayload): void {
    const current = this.pendingByUser.get(userId);
    this.pendingByUser.set(userId, {
      latestNotification: notification,
      notificationCount: (current?.notificationCount ?? 0) + 1,
    });
    this.scheduleFlush(this.flushDelayMs);
  }

  public async flushNow(): Promise<void> {
    if (this.isFlushing) return;

    this.clearFlushTimer();
    const pendingSignals = this.takePendingSignals();
    if (!pendingSignals.length) return;

    let hasFailures = false;
    this.isFlushing = true;
    try {
      const results = await Promise.allSettled(
        pendingSignals.map((pendingSignal) =>
          Promise.resolve().then(() =>
            this.publish(
              `user:${pendingSignal.userId}`,
              "notifications_changed",
              pendingSignal.signal,
            ),
          ),
        ),
      );
      hasFailures = this.restoreFailedSignals(pendingSignals, results);
    } finally {
      this.isFlushing = false;
      this.scheduleNextFlush(hasFailures);
    }
  }

  public getPendingUserCount(): number {
    return this.pendingByUser.size;
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;

    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private restoreFailedSignals(
    pendingSignals: PendingSignalEntry[],
    results: PromiseSettledResult<void>[],
  ): boolean {
    let failed = 0;
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index];
      const pendingSignal = pendingSignals[index];
      if (!result || !pendingSignal || result.status === "fulfilled") continue;

      failed += 1;
      const current = this.pendingByUser.get(pendingSignal.userId);
      this.pendingByUser.set(pendingSignal.userId, {
        latestNotification:
          current?.latestNotification ??
          pendingSignal.signal.latestNotification,
        notificationCount:
          (current?.notificationCount ?? 0) +
          pendingSignal.signal.notificationCount,
      });
    }

    if (failed) {
      logger.warn("Notification realtime pulse will retry", {
        failed,
        attempted: pendingSignals.length,
      });
    }
    return Boolean(failed);
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer || this.isFlushing || !this.pendingByUser.size) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, delayMs);
    this.flushTimer.unref();
  }

  private scheduleNextFlush(hasFailures: boolean): void {
    if (!this.pendingByUser.size) return;

    const delayMs = hasFailures ? this.retryDelayMs : this.minimumIntervalMs;
    this.scheduleFlush(delayMs);
  }

  private takePendingSignals(): PendingSignalEntry[] {
    const pendingSignals: PendingSignalEntry[] = [];
    for (const [userId, signal] of this.pendingByUser) {
      if (pendingSignals.length >= this.batchSize) break;

      pendingSignals.push({ userId, signal });
      this.pendingByUser.delete(userId);
    }
    return pendingSignals;
  }
}

type PendingSignalEntry = {
  signal: PendingNotificationSignal;
  userId: string;
};

export const notificationRealtimePublisher =
  new NotificationRealtimePublisher();
