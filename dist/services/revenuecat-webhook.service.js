"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRevenueCatWebhookConfigured = isRevenueCatWebhookConfigured;
exports.parseRevenueCatWebhook = parseRevenueCatWebhook;
exports.getRevenueCatWebhookUserCandidates = getRevenueCatWebhookUserCandidates;
exports.getRevenueCatWebhookSubscriptionUpdate = getRevenueCatWebhookSubscriptionUpdate;
exports.verifyRevenueCatWebhookSignature = verifyRevenueCatWebhookSignature;
exports.registerRevenueCatWebhook = registerRevenueCatWebhook;
exports.processRevenueCatWebhookEvent = processRevenueCatWebhookEvent;
exports.processPendingRevenueCatWebhooks = processPendingRevenueCatWebhooks;
const client_1 = require("@prisma/client");
const node_crypto_1 = require("node:crypto");
const db_config_1 = require("../config/db.config");
const client_app_type_1 = require("../types/client-app.type");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const revenuecat_service_1 = require("./revenuecat.service");
const subscription_downgrade_service_1 = require("./subscription-downgrade.service");
const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
const WEBHOOK_BATCH_SIZE = 25;
const WEBHOOK_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const WEBHOOK_MAX_RETRY_DELAY_MS = 60 * 60 * 1000;
const IMMEDIATE_ACCESS_EVENT_TYPES = new Set([
    "INITIAL_PURCHASE",
    "NON_RENEWING_PURCHASE",
    "PRODUCT_CHANGE",
    "REFUND_REVERSED",
    "RENEWAL",
    "SUBSCRIPTION_EXTENDED",
    "TEMPORARY_ENTITLEMENT_GRANT",
    "UNCANCELLATION",
]);
const IMMEDIATE_REVOCATION_EVENT_TYPES = new Set(["EXPIRATION", "REFUND"]);
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string");
}
function getFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function getOptionalString(value) {
    return typeof value === "string" ? value : null;
}
function getWebhookSecret(clientApp) {
    return ((clientApp === "mycove"
        ? env_util_1.Env.MYCOVE_REVENUECAT_WEBHOOK_SECRET
        : env_util_1.Env.REVENUECAT_WEBHOOK_SECRET)?.trim() ?? "");
}
function isRevenueCatWebhookConfigured(clientApp) {
    return Boolean(getWebhookSecret(clientApp));
}
function getSignatureParts(signature) {
    const parts = new Map();
    for (const part of signature.split(",")) {
        const [key, value] = part.trim().split("=", 2);
        if (key && value)
            parts.set(key, value);
    }
    const timestampValue = parts.get("t");
    const value = parts.get("v1");
    if (!timestampValue || !value || !/^[a-f\d]{64}$/i.test(value))
        return null;
    const timestamp = Number(timestampValue);
    if (!Number.isInteger(timestamp))
        return null;
    return { timestamp, value };
}
function parseRevenueCatWebhook(rawPayload) {
    let payload;
    try {
        payload = JSON.parse(rawPayload);
    }
    catch {
        return null;
    }
    if (!isRecord(payload) || !isRecord(payload.event))
        return null;
    const event = payload.event;
    if (typeof event.id !== "string" || typeof event.type !== "string") {
        return null;
    }
    const entitlementIds = getStringArray(event.entitlement_ids);
    const deprecatedEntitlementId = getOptionalString(event.entitlement_id);
    if (deprecatedEntitlementId &&
        !entitlementIds.includes(deprecatedEntitlementId)) {
        entitlementIds.push(deprecatedEntitlementId);
    }
    return {
        event: {
            aliases: getStringArray(event.aliases),
            appUserId: typeof event.app_user_id === "string" ? event.app_user_id : null,
            entitlementIds,
            environment: getOptionalString(event.environment),
            expirationAtMs: getFiniteNumber(event.expiration_at_ms),
            id: event.id,
            periodType: getOptionalString(event.period_type),
            productId: getOptionalString(event.product_id),
            transferredFrom: getStringArray(event.transferred_from),
            transferredTo: getStringArray(event.transferred_to),
            type: event.type,
        },
    };
}
function getRevenueCatWebhookUserCandidates(event) {
    const candidates = [
        event.appUserId,
        ...event.aliases,
        ...event.transferredFrom,
        ...event.transferredTo,
    ].filter((value) => Boolean(value) && !value.startsWith("$RCAnonymousID:"));
    return [...new Set(candidates)];
}
function getExpirationDate(expirationAtMs) {
    if (expirationAtMs === null)
        return null;
    const expirationDate = new Date(expirationAtMs);
    return Number.isNaN(expirationDate.getTime()) ? null : expirationDate;
}
function getRevenueCatWebhookSubscriptionUpdate(clientApp, event, now = new Date()) {
    const eventType = event.type.trim().toUpperCase();
    const isAccessEvent = IMMEDIATE_ACCESS_EVENT_TYPES.has(eventType);
    const isRevocationEvent = IMMEDIATE_REVOCATION_EVENT_TYPES.has(eventType);
    // Cancellation, billing issues, and pauses do not necessarily end access
    // immediately. Let the entitlement API determine the eventual end date.
    // Transfers also need both the source and destination customer reconciled.
    if (!isAccessEvent && !isRevocationEvent)
        return null;
    const configuredEntitlementId = (0, revenuecat_service_1.getRevenueCatConfig)(clientApp).entitlementId;
    const includesConfiguredEntitlement = event.entitlementIds.some((id) => (0, revenuecat_service_1.matchesRevenueCatEntitlementIdentifier)({ id, lookup_key: id }, configuredEntitlementId));
    if (!includesConfiguredEntitlement)
        return null;
    return {
        entitlementId: configuredEntitlementId,
        environment: event.environment?.trim().toUpperCase() ?? null,
        expiresAt: getExpirationDate(event.expirationAtMs),
        isPro: isAccessEvent,
        managementUrl: null,
        periodType: event.periodType,
        productIdentifier: event.productId,
        verifiedAt: now,
    };
}
function verifyRevenueCatWebhookSignature(params) {
    const secret = getWebhookSecret(params.clientApp);
    if (!secret)
        return false;
    const signatureParts = getSignatureParts(params.signature);
    if (!signatureParts)
        return false;
    const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
    if (Math.abs(nowSeconds - signatureParts.timestamp) >
        WEBHOOK_SIGNATURE_TOLERANCE_SECONDS) {
        return false;
    }
    const expected = (0, node_crypto_1.createHmac)("sha256", secret)
        .update(Buffer.from(`${signatureParts.timestamp}.`))
        .update(params.rawBody)
        .digest();
    const received = Buffer.from(signatureParts.value, "hex");
    return (expected.length === received.length && (0, node_crypto_1.timingSafeEqual)(expected, received));
}
async function registerRevenueCatWebhook(params) {
    try {
        const event = await db_config_1.prisma.revenueCatWebhookEvent.create({
            data: {
                appUserId: params.envelope.event.appUserId,
                clientApp: (0, client_app_type_1.toPrismaClientApp)(params.clientApp),
                eventType: params.envelope.event.type,
                externalEventId: params.envelope.event.id,
                rawPayload: params.rawPayload,
            },
            select: { id: true },
        });
        return { duplicate: false, eventId: event.id };
    }
    catch (error) {
        if (!(error instanceof client_1.Prisma.PrismaClientKnownRequestError) ||
            error.code !== "P2002") {
            throw error;
        }
        const existing = await db_config_1.prisma.revenueCatWebhookEvent.findUniqueOrThrow({
            where: {
                clientApp_externalEventId: {
                    clientApp: (0, client_app_type_1.toPrismaClientApp)(params.clientApp),
                    externalEventId: params.envelope.event.id,
                },
            },
            select: { id: true },
        });
        return { duplicate: true, eventId: existing.id };
    }
}
async function findWebhookUserId(webhookEvent) {
    const envelope = parseRevenueCatWebhook(webhookEvent.rawPayload);
    if (!envelope)
        return null;
    const candidates = getRevenueCatWebhookUserCandidates(envelope.event);
    if (!candidates.length)
        return null;
    const user = await db_config_1.prisma.user.findFirst({
        where: { id: { in: candidates } },
        select: { id: true },
    });
    return user?.id ?? null;
}
async function applyWebhookSubscriptionUpdate(webhookEvent, now) {
    const envelope = parseRevenueCatWebhook(webhookEvent.rawPayload);
    if (!envelope)
        return false;
    const userId = await findWebhookUserId(webhookEvent);
    if (!userId)
        return false;
    const update = getRevenueCatWebhookSubscriptionUpdate((0, client_app_type_1.fromPrismaClientApp)(webhookEvent.clientApp), envelope.event, now);
    if (!update)
        return false;
    const previousSnapshot = await db_config_1.prisma.subscriptionSnapshot.findUnique({
        where: {
            userId_clientApp: {
                clientApp: webhookEvent.clientApp,
                userId,
            },
        },
        select: { isPro: true },
    });
    await db_config_1.prisma.subscriptionSnapshot.upsert({
        where: {
            userId_clientApp: {
                clientApp: webhookEvent.clientApp,
                userId,
            },
        },
        create: {
            clientApp: webhookEvent.clientApp,
            entitlementId: update.entitlementId,
            environment: update.environment,
            expiresAt: update.expiresAt,
            isPro: update.isPro,
            managementUrl: update.managementUrl,
            periodType: update.periodType,
            productIdentifier: update.productIdentifier,
            userId,
            verifiedAt: update.verifiedAt,
        },
        update: {
            entitlementId: update.entitlementId,
            environment: update.environment,
            expiresAt: update.expiresAt,
            isPro: update.isPro,
            managementUrl: update.managementUrl,
            periodType: update.periodType,
            productIdentifier: update.productIdentifier,
            verifiedAt: update.verifiedAt,
        },
    });
    if (webhookEvent.clientApp === client_1.ClientApp.VYBAA &&
        previousSnapshot?.isPro &&
        !update.isPro) {
        await (0, subscription_downgrade_service_1.downgradeRewindRoutineToFreeTier)(userId);
    }
    return true;
}
function getRetryTime(attemptCount, now) {
    const delay = Math.min(2 ** Math.max(0, attemptCount - 1) * 60000, WEBHOOK_MAX_RETRY_DELAY_MS);
    return new Date(now.getTime() + delay);
}
async function processRevenueCatWebhookEvent(eventId, now = new Date()) {
    const claim = await db_config_1.prisma.revenueCatWebhookEvent.updateMany({
        where: {
            id: eventId,
            status: {
                in: [client_1.RevenueCatWebhookStatus.RECEIVED, client_1.RevenueCatWebhookStatus.FAILED],
            },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        data: {
            attemptCount: { increment: 1 },
            lastError: null,
            status: client_1.RevenueCatWebhookStatus.PROCESSING,
        },
    });
    if (!claim.count)
        return;
    const webhookEvent = await db_config_1.prisma.revenueCatWebhookEvent.findUniqueOrThrow({
        where: { id: eventId },
    });
    try {
        const appliedImmediately = await applyWebhookSubscriptionUpdate(webhookEvent, now);
        if (!appliedImmediately) {
            const userId = await findWebhookUserId(webhookEvent);
            if (userId) {
                await (0, revenuecat_service_1.getRevenueCatSubscriptionStatus)(userId, (0, client_app_type_1.fromPrismaClientApp)(webhookEvent.clientApp), { forceRefresh: true, now });
            }
        }
        await db_config_1.prisma.revenueCatWebhookEvent.update({
            where: { id: eventId },
            data: {
                nextAttemptAt: null,
                processedAt: now,
                rawPayload: "{}",
                status: client_1.RevenueCatWebhookStatus.COMPLETED,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
        await db_config_1.prisma.revenueCatWebhookEvent.update({
            where: { id: eventId },
            data: {
                lastError: message,
                nextAttemptAt: getRetryTime(webhookEvent.attemptCount, now),
                status: client_1.RevenueCatWebhookStatus.FAILED,
            },
        });
        logger_util_1.default.warn("RevenueCat webhook processing will retry", {
            eventId,
            eventType: webhookEvent.eventType,
        });
    }
}
async function processPendingRevenueCatWebhooks(now = new Date()) {
    await db_config_1.prisma.revenueCatWebhookEvent.updateMany({
        where: {
            status: client_1.RevenueCatWebhookStatus.PROCESSING,
            updatedAt: {
                lt: new Date(now.getTime() - WEBHOOK_PROCESSING_TIMEOUT_MS),
            },
        },
        data: {
            nextAttemptAt: now,
            status: client_1.RevenueCatWebhookStatus.FAILED,
        },
    });
    const pending = await db_config_1.prisma.revenueCatWebhookEvent.findMany({
        where: {
            status: {
                in: [client_1.RevenueCatWebhookStatus.RECEIVED, client_1.RevenueCatWebhookStatus.FAILED],
            },
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: { receivedAt: "asc" },
        select: { id: true },
        take: WEBHOOK_BATCH_SIZE,
    });
    await Promise.all(pending.map((event) => processRevenueCatWebhookEvent(event.id, now)));
    return pending.length;
}
