"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRevenueCatWebhook = handleRevenueCatWebhook;
const revenuecat_webhook_service_1 = require("../services/revenuecat-webhook.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
async function handleRevenueCatWebhook(req, res) {
    if (!(0, revenuecat_webhook_service_1.isRevenueCatWebhookConfigured)(req.clientApp)) {
        return res.status(503).json({ msg: "RevenueCat webhook is not configured" });
    }
    const signature = req.header("x-revenuecat-webhook-signature");
    if (!signature || !Buffer.isBuffer(req.body)) {
        return res.status(400).json({ msg: "Invalid webhook request" });
    }
    if (!(0, revenuecat_webhook_service_1.verifyRevenueCatWebhookSignature)({
        clientApp: req.clientApp,
        rawBody: req.body,
        signature,
    })) {
        return res.status(401).json({ msg: "Invalid webhook signature" });
    }
    const rawPayload = req.body.toString("utf8");
    const envelope = (0, revenuecat_webhook_service_1.parseRevenueCatWebhook)(rawPayload);
    if (!envelope) {
        return res.status(400).json({ msg: "Invalid webhook payload" });
    }
    try {
        const registration = await (0, revenuecat_webhook_service_1.registerRevenueCatWebhook)({
            clientApp: req.clientApp,
            envelope,
            rawPayload,
        });
        setImmediate(() => {
            void (0, revenuecat_webhook_service_1.processRevenueCatWebhookEvent)(registration.eventId).catch((error) => {
                logger_util_1.default.error("RevenueCat webhook dispatch failed", {
                    errorName: error instanceof Error ? error.name : "UnknownError",
                    eventId: registration.eventId,
                });
            });
        });
        return res.status(200).json({
            duplicate: registration.duplicate,
            msg: "Webhook accepted",
        });
    }
    catch (error) {
        logger_util_1.default.error("RevenueCat webhook registration failed", {
            clientApp: req.clientApp,
            errorName: error instanceof Error ? error.name : "UnknownError",
            eventId: envelope.event.id,
        });
        return res.status(500).json({ msg: "Webhook could not be recorded" });
    }
}
