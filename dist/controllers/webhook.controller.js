"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePaystackWebhook = handlePaystackWebhook;
exports.handlePolarWebhook = handlePolarWebhook;
const node_crypto_1 = __importDefault(require("node:crypto"));
const client_1 = require("@prisma/client");
const db_config_1 = require("../config/db.config");
const activity_signal_service_1 = require("../services/activity-signal.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
// NOTE: This handler expects `req.body` to be a raw Buffer.
// We mount it with `express.raw({ type: 'application/json' })` at the app level.
async function handlePaystackWebhook(req, res) {
    try {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) {
            return res.status(500).json({ msg: "Paystack not configured" });
        }
        const signature = req.headers["x-paystack-signature"];
        const rawBody = req.body;
        if (!signature || !rawBody) {
            return res.status(400).json({ msg: "Invalid webhook payload" });
        }
        const computed = node_crypto_1.default
            .createHmac("sha512", secret)
            .update(rawBody)
            .digest("hex");
        if (computed !== signature) {
            logger_util_1.default.warn("Paystack signature mismatch", { signature, computed });
            return res.status(401).json({ msg: "Invalid signature" });
        }
        const payload = JSON.parse(rawBody.toString());
        if (payload.event === "charge.success") {
            const reference = payload.data?.reference;
            const amountKobo = payload.data?.amount;
            if (!reference) {
                logger_util_1.default.warn("Paystack webhook without reference", { payload });
            }
            else {
                const tx = await db_config_1.prisma.transaction.findFirst({
                    where: { referenceId: reference },
                    select: {
                        id: true,
                        recipientId: true,
                        status: true,
                        fiatAmount: true,
                    },
                });
                if (tx && tx.status !== "COMPLETED") {
                    const fiatAmount = tx.fiatAmount ?? (amountKobo ? amountKobo / 100 : 0);
                    const credit = Math.floor(fiatAmount || 0);
                    if (credit > 0) {
                        await db_config_1.prisma.$transaction([
                            db_config_1.prisma.transaction.update({
                                where: { id: tx.id },
                                data: { status: "COMPLETED" },
                            }),
                            db_config_1.prisma.user.update({
                                where: { id: tx.recipientId },
                                data: {
                                    realPointsBalance: {
                                        increment: credit,
                                    },
                                },
                            }),
                        ]);
                        try {
                            const recipient = await db_config_1.prisma.user.findUnique({
                                select: { timezone: true },
                                where: { id: tx.recipientId },
                            });
                            await (0, activity_signal_service_1.recordActivitySignal)({
                                dedupeKey: `wallet-funding:${tx.id}:completed`,
                                description: `Added ${credit} real points to the wallet.`,
                                eventType: "REAL_POINTS_ADDED",
                                sourceId: tx.id,
                                sourceType: client_1.ActivitySignalSourceType.REWARD,
                                timezone: recipient?.timezone ?? "UTC",
                                userId: tx.recipientId,
                            });
                        }
                        catch (signalError) {
                            logger_util_1.default.warn("Unable to record wallet funding activity signal", {
                                errorName: signalError instanceof Error
                                    ? signalError.name
                                    : "UnknownError",
                                transactionId: tx.id,
                            });
                        }
                    }
                    else {
                        await db_config_1.prisma.transaction.update({
                            where: { id: tx.id },
                            data: { status: "COMPLETED" },
                        });
                    }
                }
            }
        }
        return res.status(200).json({ msg: "Webhook received" });
    }
    catch (error) {
        logger_util_1.default.error("Paystack webhook handler error:", { error });
        return res.status(500).json({ msg: "Internal server error" });
    }
}
async function handlePolarWebhook(_req, res) {
    // Stub: implement full signature verification + credit logic when Polar is configured
    return res.status(200).json({ msg: "Polar webhook received" });
}
