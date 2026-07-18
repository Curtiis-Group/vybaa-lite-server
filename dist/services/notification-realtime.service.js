"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationRealtimePublisher = exports.NotificationRealtimePublisher = void 0;
const ably_config_1 = require("../config/ably.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_DELAY_MS = 150;
const DEFAULT_MINIMUM_INTERVAL_MS = 1000;
const DEFAULT_RETRY_DELAY_MS = 5000;
async function publishToAbly(channelName, eventName, signal) {
    await (0, ably_config_1.getAblyClient)()
        .channels.get(channelName)
        .publish(eventName, signal);
}
/**
 * Converts individual notification writes into a bounded, source-of-truth
 * invalidation signal. Notification data remains in the database and FCM
 * continues to deliver the individual native push messages.
 */
class NotificationRealtimePublisher {
    constructor(publish = publishToAbly, options = {}) {
        this.pendingByUser = new Map();
        this.flushTimer = null;
        this.isFlushing = false;
        this.publish = publish;
        this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
        this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
        this.minimumIntervalMs =
            options.minimumIntervalMs ?? DEFAULT_MINIMUM_INTERVAL_MS;
        this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    }
    enqueue(userId, notification) {
        const current = this.pendingByUser.get(userId);
        this.pendingByUser.set(userId, {
            latestNotification: notification,
            notificationCount: (current?.notificationCount ?? 0) + 1,
        });
        this.scheduleFlush(this.flushDelayMs);
    }
    async flushNow() {
        if (this.isFlushing)
            return;
        this.clearFlushTimer();
        const pendingSignals = this.takePendingSignals();
        if (!pendingSignals.length)
            return;
        let hasFailures = false;
        this.isFlushing = true;
        try {
            const results = await Promise.allSettled(pendingSignals.map((pendingSignal) => Promise.resolve().then(() => this.publish(`user:${pendingSignal.userId}`, "notifications_changed", pendingSignal.signal))));
            hasFailures = this.restoreFailedSignals(pendingSignals, results);
        }
        finally {
            this.isFlushing = false;
            this.scheduleNextFlush(hasFailures);
        }
    }
    getPendingUserCount() {
        return this.pendingByUser.size;
    }
    clearFlushTimer() {
        if (!this.flushTimer)
            return;
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
    }
    restoreFailedSignals(pendingSignals, results) {
        let failed = 0;
        for (let index = 0; index < results.length; index += 1) {
            const result = results[index];
            const pendingSignal = pendingSignals[index];
            if (!result || !pendingSignal || result.status === "fulfilled")
                continue;
            failed += 1;
            const current = this.pendingByUser.get(pendingSignal.userId);
            this.pendingByUser.set(pendingSignal.userId, {
                latestNotification: current?.latestNotification ?? pendingSignal.signal.latestNotification,
                notificationCount: (current?.notificationCount ?? 0) +
                    pendingSignal.signal.notificationCount,
            });
        }
        if (failed) {
            logger_util_1.default.warn("Notification realtime pulse will retry", {
                failed,
                attempted: pendingSignals.length,
            });
        }
        return Boolean(failed);
    }
    scheduleFlush(delayMs) {
        if (this.flushTimer || this.isFlushing || !this.pendingByUser.size)
            return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flushNow();
        }, delayMs);
        this.flushTimer.unref();
    }
    scheduleNextFlush(hasFailures) {
        if (!this.pendingByUser.size)
            return;
        const delayMs = hasFailures
            ? this.retryDelayMs
            : this.minimumIntervalMs;
        this.scheduleFlush(delayMs);
    }
    takePendingSignals() {
        const pendingSignals = [];
        for (const [userId, signal] of this.pendingByUser) {
            if (pendingSignals.length >= this.batchSize)
                break;
            pendingSignals.push({ userId, signal });
            this.pendingByUser.delete(userId);
        }
        return pendingSignals;
    }
}
exports.NotificationRealtimePublisher = NotificationRealtimePublisher;
exports.notificationRealtimePublisher = new NotificationRealtimePublisher();
