"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRO_SUBSCRIPTION_LIMITS = exports.FREE_SUBSCRIPTION_LIMITS = exports.VYBAA_PRODUCT_IDS = exports.VYBAA_OFFERING_ID = exports.VYBAA_ENTITLEMENT_ID = exports.SUBSCRIPTION_SNAPSHOT_TTL_MS = void 0;
exports.getRevenueCatConfig = getRevenueCatConfig;
exports.isEntitlementActive = isEntitlementActive;
exports.refreshRevenueCatSubscription = refreshRevenueCatSubscription;
exports.getRevenueCatSubscriptionStatus = getRevenueCatSubscriptionStatus;
exports.getLimitsForAccess = getLimitsForAccess;
const db_config_1 = require("../config/db.config");
const client_app_type_1 = require("../types/client-app.type");
const env_util_1 = require("../utils/env.util");
const subscription_downgrade_service_1 = require("./subscription-downgrade.service");
exports.SUBSCRIPTION_SNAPSHOT_TTL_MS = 5 * 60 * 1000;
exports.VYBAA_ENTITLEMENT_ID = "vybaa_pro";
exports.VYBAA_OFFERING_ID = "default";
exports.VYBAA_PRODUCT_IDS = {
    annual: "com.vybaa.app.pro.annual",
    monthly: "com.vybaa.app.pro.monthly",
};
exports.FREE_SUBSCRIPTION_LIMITS = {
    activeGoals: 3,
    insightRanges: ["7d"],
    ownedCommunities: 1,
    rewindSessionsPerDay: 1,
};
exports.PRO_SUBSCRIPTION_LIMITS = {
    activeGoals: null,
    insightRanges: ["7d", "30d", "90d"],
    ownedCommunities: 10,
    rewindSessionsPerDay: 2,
};
function getRevenueCatClientConfig(clientApp) {
    if (clientApp === "mycove") {
        return {
            entitlementId: env_util_1.Env.MYCOVE_REVENUECAT_ENTITLEMENT_ID?.trim() || "My Cove Pro",
            offeringId: "default",
            products: { annual: "yearly", monthly: "monthly" },
            restApiKey: env_util_1.Env.MYCOVE_REVENUECAT_REST_API_KEY,
        };
    }
    return {
        entitlementId: env_util_1.Env.REVENUECAT_ENTITLEMENT_ID?.trim() || exports.VYBAA_ENTITLEMENT_ID,
        offeringId: exports.VYBAA_OFFERING_ID,
        products: exports.VYBAA_PRODUCT_IDS,
        restApiKey: env_util_1.Env.REVENUECAT_REST_API_KEY,
    };
}
function getRevenueCatConfig(clientApp) {
    const config = getRevenueCatClientConfig(clientApp);
    return {
        entitlementId: config.entitlementId,
        free: exports.FREE_SUBSCRIPTION_LIMITS,
        offeringId: config.offeringId,
        pro: exports.PRO_SUBSCRIPTION_LIMITS,
        products: config.products,
    };
}
function isEntitlementActive(entitlement, now) {
    if (!entitlement)
        return false;
    if (!entitlement.expires_date)
        return true;
    return new Date(entitlement.expires_date).getTime() > now.getTime();
}
function snapshotToAccess(snapshot, clientApp, isConfigured, now) {
    const isPro = snapshot.isPro &&
        (!snapshot.expiresAt || snapshot.expiresAt.getTime() > now.getTime());
    return {
        clientApp,
        entitlementId: snapshot.entitlementId,
        environment: snapshot.environment,
        expiresAt: snapshot.expiresAt?.toISOString() ?? null,
        isConfigured,
        isPro,
        isTrial: isPro && snapshot.periodType?.toLowerCase() === "trial",
        managementURL: snapshot.managementUrl,
        productIdentifier: snapshot.productIdentifier,
        tier: isPro ? "pro" : "free",
        verifiedAt: snapshot.verifiedAt.toISOString(),
    };
}
function createFreeAccess(clientApp, isConfigured, now) {
    return {
        clientApp,
        entitlementId: getRevenueCatClientConfig(clientApp).entitlementId,
        environment: null,
        expiresAt: null,
        isConfigured,
        isPro: false,
        isTrial: false,
        managementURL: null,
        productIdentifier: null,
        tier: "free",
        verifiedAt: now.toISOString(),
    };
}
async function fetchRevenueCatSubscriber(appUserId, restApiKey) {
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${restApiKey}`,
        },
    });
    if (!response.ok) {
        throw new Error(`RevenueCat verification failed with status ${response.status}`);
    }
    return (await response.json());
}
async function refreshRevenueCatSubscription(appUserId, clientApp, now = new Date()) {
    const config = getRevenueCatClientConfig(clientApp);
    if (!config.restApiKey) {
        return createFreeAccess(clientApp, false, now);
    }
    const payload = await fetchRevenueCatSubscriber(appUserId, config.restApiKey);
    const entitlement = payload.subscriber?.entitlements?.[config.entitlementId] ?? null;
    const productIdentifier = entitlement?.product_identifier ?? null;
    const subscription = productIdentifier
        ? payload.subscriber?.subscriptions?.[productIdentifier]
        : undefined;
    const expiresAtValue = entitlement?.expires_date ?? subscription?.expires_date ?? null;
    const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
    const isPro = isEntitlementActive(entitlement, now);
    const previousSnapshot = await db_config_1.prisma.subscriptionSnapshot.findUnique({
        where: {
            userId_clientApp: {
                clientApp: (0, client_app_type_1.toPrismaClientApp)(clientApp),
                userId: appUserId,
            },
        },
    });
    const snapshot = await db_config_1.prisma.subscriptionSnapshot.upsert({
        where: {
            userId_clientApp: {
                clientApp: (0, client_app_type_1.toPrismaClientApp)(clientApp),
                userId: appUserId,
            },
        },
        create: {
            clientApp: (0, client_app_type_1.toPrismaClientApp)(clientApp),
            entitlementId: config.entitlementId,
            environment: subscription?.is_sandbox ? "SANDBOX" : "PRODUCTION",
            expiresAt,
            isPro,
            managementUrl: payload.subscriber?.management_url ?? null,
            periodType: subscription?.period_type ?? null,
            productIdentifier,
            userId: appUserId,
            verifiedAt: now,
        },
        update: {
            entitlementId: config.entitlementId,
            environment: subscription?.is_sandbox ? "SANDBOX" : "PRODUCTION",
            expiresAt,
            isPro,
            managementUrl: payload.subscriber?.management_url ?? null,
            periodType: subscription?.period_type ?? null,
            productIdentifier,
            verifiedAt: now,
        },
    });
    if (clientApp === "vybaa" && previousSnapshot?.isPro && !isPro) {
        await (0, subscription_downgrade_service_1.downgradeRewindRoutineToFreeTier)(appUserId);
    }
    return snapshotToAccess(snapshot, clientApp, true, now);
}
async function getRevenueCatSubscriptionStatus(appUserId, clientApp, options = {}) {
    const now = options.now ?? new Date();
    const config = getRevenueCatClientConfig(clientApp);
    const snapshot = await db_config_1.prisma.subscriptionSnapshot.findUnique({
        where: {
            userId_clientApp: {
                clientApp: (0, client_app_type_1.toPrismaClientApp)(clientApp),
                userId: appUserId,
            },
        },
    });
    const isFresh = snapshot &&
        now.getTime() - snapshot.verifiedAt.getTime() <
            exports.SUBSCRIPTION_SNAPSHOT_TTL_MS;
    if (!options.forceRefresh && isFresh) {
        return snapshotToAccess(snapshot, clientApp, Boolean(config.restApiKey), now);
    }
    try {
        return await refreshRevenueCatSubscription(appUserId, clientApp, now);
    }
    catch (error) {
        if (snapshot) {
            return snapshotToAccess(snapshot, clientApp, true, now);
        }
        throw error;
    }
}
function getLimitsForAccess(access) {
    return access.isPro ? exports.PRO_SUBSCRIPTION_LIMITS : exports.FREE_SUBSCRIPTION_LIMITS;
}
