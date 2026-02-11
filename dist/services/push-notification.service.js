"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pushNotificationService = exports.PushNotificationService = void 0;
const firebase_config_1 = require("../config/firebase.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
class PushNotificationService {
    buildBaseMessage(title, body, payload = {}, silent = false) {
        const data = Object.keys(payload || {}).reduce((acc, key) => {
            acc[key] =
                typeof payload[key] === "string"
                    ? payload[key]
                    : JSON.stringify(payload[key]);
            return acc;
        }, {});
        return {
            data,
            notification: silent ? undefined : { title, body },
            webpush: {
                headers: { Urgency: "high" },
                notification: {
                    body,
                    requireInteraction: true,
                    badge: "/badge-icon.png",
                },
            },
            android: {
                notification: {
                    channelId: silent ? "" : "vybaa_notifications",
                    sound: silent ? undefined : "default",
                },
            },
            apns: {
                payload: {
                    aps: {
                        sound: silent ? undefined : "default",
                        badge: 1,
                    },
                },
            },
        };
    }
    /**
     * Send FCM push notification to multiple tokens
     * @param userFcmTokens Array of FCM tokens to send to
     * @param title Notification title
     * @param body Notification body
     * @param payload Additional data payload (notification ID, type, etc.)
     * @param silent If true, send as data-only notification (no visual notification)
     */
    async sendFCMPush(userFcmTokens, title, body, payload = {}, silent = false) {
        if (!userFcmTokens || userFcmTokens.length === 0) {
            logger_util_1.default.debug("No FCM tokens provided, skipping push notification");
            return [];
        }
        const message = this.buildBaseMessage(title, body, payload, silent);
        const results = await Promise.allSettled(userFcmTokens.map(async (token) => {
            try {
                const result = await (0, firebase_config_1.firebaseClient)()
                    .messaging()
                    .send({
                    ...message,
                    token,
                });
                logger_util_1.default.debug("FCM push sent successfully", {
                    token: token.substring(0, 20) + "...",
                    result,
                });
                return { success: true, token, result };
            }
            catch (error) {
                console.log(error);
                logger_util_1.default.error("Failed to send FCM push", {
                    token: token.substring(0, 20) + "...",
                    error: error.message,
                    code: error.code,
                });
                // Handle invalid tokens - they should be removed from database
                if (error.code === "messaging/invalid-registration-token" ||
                    error.code === "messaging/registration-token-not-registered") {
                    logger_util_1.default.warn("Invalid FCM token detected, should be removed", {
                        token: token.substring(0, 20) + "...",
                    });
                }
                return { success: false, token, error: error.message };
            }
        }));
        const successful = results.filter((r) => r.status === "fulfilled" && r.value.success).length;
        const failed = results.length - successful;
        if (failed > 0) {
            logger_util_1.default.warn("Some FCM pushes failed", {
                successful,
                failed,
                total: results.length,
            });
        }
        else {
            logger_util_1.default.info("All FCM pushes sent successfully", { count: successful });
        }
        return results.map((r) => r.status === "fulfilled" ? r.value : { success: false, error: "Unknown error" });
    }
    /**
     * Send a multicast message to up to 500 tokens at a time using Admin SDK sendEachForMulticast.
     * Automatically chunks if tokens > 500.
     */
    async sendFCMMulticast(userFcmTokens, title, body, payload = {}, silent = false) {
        if (!userFcmTokens?.length) {
            logger_util_1.default.debug("No FCM tokens provided for multicast, skipping");
            return { successCount: 0, failureCount: 0, failedTokens: [] };
        }
        const chunkSize = 500;
        const base = this.buildBaseMessage(title, body, payload, silent);
        const failedTokens = [];
        let successCount = 0;
        let failureCount = 0;
        for (let i = 0; i < userFcmTokens.length; i += chunkSize) {
            const tokens = userFcmTokens.slice(i, i + chunkSize);
            try {
                const resp = await (0, firebase_config_1.firebaseClient)()
                    .messaging()
                    .sendEachForMulticast({
                    ...base,
                    tokens,
                });
                successCount += resp.successCount;
                failureCount += resp.failureCount;
                if (resp.failureCount > 0) {
                    resp.responses.forEach((r, idx) => {
                        if (!r.success)
                            failedTokens.push(tokens[idx]);
                    });
                }
            }
            catch (error) {
                logger_util_1.default.error("Multicast send failed for chunk", {
                    error: error?.message,
                });
                // Consider all in chunk failed
                failureCount += tokens.length;
                failedTokens.push(...tokens);
            }
        }
        if (failureCount > 0) {
            logger_util_1.default.warn("Multicast sends completed with failures", {
                successCount,
                failureCount,
            });
        }
        else {
            logger_util_1.default.info("Multicast sends completed successfully", { successCount });
        }
        return { successCount, failureCount, failedTokens };
    }
    /**
     * Send a customized list of up to 500 messages using sendEach.
     * Accepts per-recipient overrides (title/body/payload/silent).
     * Automatically chunks if >500.
     */
    async sendFCMBatchMessages(messages) {
        if (!messages?.length)
            return { successCount: 0, failureCount: 0, failedTokens: [] };
        const chunkSize = 500;
        const failedTokens = [];
        let successCount = 0;
        let failureCount = 0;
        for (let i = 0; i < messages.length; i += chunkSize) {
            const chunk = messages.slice(i, i + chunkSize);
            const built = chunk.map((m) => ({
                ...this.buildBaseMessage(m.title, m.body, m.payload || {}, m.silent || false),
                token: m.token,
            }));
            try {
                const resp = await (0, firebase_config_1.firebaseClient)().messaging().sendEach(built);
                successCount += resp.successCount;
                failureCount += resp.failureCount;
                if (resp.failureCount > 0) {
                    resp.responses.forEach((r, idx) => {
                        if (!r.success)
                            failedTokens.push(chunk[idx].token);
                    });
                }
            }
            catch (error) {
                logger_util_1.default.error("Batch sendEach failed for chunk", {
                    error: error?.message,
                });
                failureCount += chunk.length;
                failedTokens.push(...chunk.map((m) => m.token));
            }
        }
        if (failureCount > 0) {
            logger_util_1.default.warn("Batch sendEach completed with failures", {
                successCount,
                failureCount,
            });
        }
        else {
            logger_util_1.default.info("Batch sendEach completed successfully", { successCount });
        }
        return { successCount, failureCount, failedTokens };
    }
}
exports.PushNotificationService = PushNotificationService;
exports.pushNotificationService = new PushNotificationService();
