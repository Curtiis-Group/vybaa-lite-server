"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRO_SUBSCRIPTION_LIMITS = exports.FREE_SUBSCRIPTION_LIMITS = exports.VYBAA_PRODUCT_IDS = exports.VYBAA_OFFERING_ID = exports.VYBAA_ENTITLEMENT_ID = exports.SUBSCRIPTION_SNAPSHOT_TTL_MS = void 0;
exports.getRevenueCatConfig = getRevenueCatConfig;
exports.isEntitlementActive = isEntitlementActive;
exports.matchesRevenueCatEntitlementIdentifier = matchesRevenueCatEntitlementIdentifier;
exports.parseRevenueCatV2Access = parseRevenueCatV2Access;
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
            entitlementId: env_util_1.Env.MYCOVE_REVENUECAT_ENTITLEMENT_ID?.trim() || "vybaa_pro",
            offeringId: "default",
            products: { annual: "yearly", monthly: "monthly" },
            projectId: env_util_1.Env.MYCOVE_REVENUECAT_PROJECT_ID,
            restApiKey: env_util_1.Env.MYCOVE_REVENUECAT_REST_API_KEY,
        };
    }
    return {
        entitlementId: env_util_1.Env.REVENUECAT_ENTITLEMENT_ID?.trim() || exports.VYBAA_ENTITLEMENT_ID,
        offeringId: exports.VYBAA_OFFERING_ID,
        products: exports.VYBAA_PRODUCT_IDS,
        projectId: env_util_1.Env.REVENUECAT_PROJECT_ID,
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
        isTrial: isPro && Boolean(snapshot.periodType?.toLowerCase().includes("trial")),
        managementURL: snapshot.managementUrl,
        productIdentifier: snapshot.productIdentifier,
        tier: isPro ? "pro" : "free",
        verifiedAt: snapshot.verifiedAt.toISOString(),
    };
}
function normalizeEntitlementIdentifier(identifier) {
    return identifier
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
}
function matchesRevenueCatEntitlementIdentifier(entitlement, configuredIdentifier) {
    if (entitlement.id === configuredIdentifier ||
        entitlement.lookup_key === configuredIdentifier) {
        return true;
    }
    const normalizedIdentifier = normalizeEntitlementIdentifier(configuredIdentifier);
    return (normalizeEntitlementIdentifier(entitlement.lookup_key ?? "") ===
        normalizedIdentifier);
}
function parseRevenueCatTimestamp(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function getSubscriptionEndTime(subscription) {
    return (subscription.current_period_ends_at ?? subscription.ends_at ?? 0);
}
function parseRevenueCatV2Access(payload, now) {
    const activeEntitlement = (payload.activeEntitlements.items ?? []).find((item) => item.entitlement_id === payload.entitlement.id);
    const entitlementExpiresAt = parseRevenueCatTimestamp(activeEntitlement?.expires_at);
    const hasActiveEntitlement = Boolean(activeEntitlement) &&
        (!entitlementExpiresAt || entitlementExpiresAt.getTime() > now.getTime());
    if (!hasActiveEntitlement) {
        return {
            environment: null,
            expiresAt: null,
            isPro: false,
            managementURL: null,
            periodType: null,
            productIdentifier: null,
        };
    }
    const productsById = new Map((payload.products.items ?? []).flatMap((product) => product.id ? [[product.id, product]] : []));
    const candidates = (payload.subscriptions.items ?? []).filter((subscription) => Boolean(subscription.product_id) &&
        productsById.has(subscription.product_id ?? ""));
    candidates.sort((left, right) => {
        const accessDifference = Number(Boolean(right.gives_access)) - Number(Boolean(left.gives_access));
        if (accessDifference !== 0)
            return accessDifference;
        return getSubscriptionEndTime(right) - getSubscriptionEndTime(left);
    });
    const match = candidates[0];
    const subscriptionExpiresAt = parseRevenueCatTimestamp(match?.current_period_ends_at ?? match?.ends_at);
    const product = match?.product_id
        ? productsById.get(match.product_id)
        : undefined;
    return {
        environment: match?.environment?.toUpperCase() ?? null,
        expiresAt: entitlementExpiresAt ?? subscriptionExpiresAt,
        isPro: true,
        managementURL: null,
        periodType: match?.status ?? null,
        productIdentifier: product?.store_identifier ?? match?.product_id ?? null,
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
async function fetchRevenueCatV2Subscriptions(appUserId, projectId, restApiKey) {
    const response = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(appUserId)}/subscriptions?limit=100`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${restApiKey}`,
        },
    });
    if (response.status === 404)
        return { items: [] };
    if (!response.ok) {
        throw new Error(`RevenueCat API v2 verification failed with status ${response.status}`);
    }
    return (await response.json());
}
async function fetchRevenueCatV2Entitlements(projectId, restApiKey) {
    const response = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/entitlements?limit=100`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${restApiKey}`,
        },
    });
    if (!response.ok) {
        throw new Error(`RevenueCat API v2 entitlement lookup failed with status ${response.status}`);
    }
    return (await response.json());
}
async function fetchRevenueCatV2EntitlementProducts(projectId, entitlementId, restApiKey) {
    const response = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/entitlements/${encodeURIComponent(entitlementId)}/products?limit=100`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${restApiKey}`,
        },
    });
    if (!response.ok) {
        throw new Error(`RevenueCat API v2 entitlement product lookup failed with status ${response.status}`);
    }
    return (await response.json());
}
async function fetchRevenueCatV2ActiveEntitlements(appUserId, projectId, restApiKey) {
    const response = await fetch(`https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(appUserId)}/active_entitlements?limit=100`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${restApiKey}`,
        },
    });
    if (response.status === 404)
        return { items: [] };
    if (!response.ok) {
        throw new Error(`RevenueCat API v2 active entitlement lookup failed with status ${response.status}`);
    }
    return (await response.json());
}
async function refreshRevenueCatSubscription(appUserId, clientApp, now = new Date()) {
    const config = getRevenueCatClientConfig(clientApp);
    if (!config.restApiKey) {
        return createFreeAccess(clientApp, false, now);
    }
    let verification;
    if (config.projectId?.trim()) {
        const projectId = config.projectId.trim();
        const [entitlements, activeEntitlements, subscriptions] = await Promise.all([
            fetchRevenueCatV2Entitlements(projectId, config.restApiKey),
            fetchRevenueCatV2ActiveEntitlements(appUserId, projectId, config.restApiKey),
            fetchRevenueCatV2Subscriptions(appUserId, projectId, config.restApiKey),
        ]);
        const entitlement = (entitlements.items ?? []).find((item) => matchesRevenueCatEntitlementIdentifier(item, config.entitlementId));
        if (!entitlement?.id) {
            throw new Error(`RevenueCat entitlement ${config.entitlementId} is not configured for project ${projectId}`);
        }
        const products = await fetchRevenueCatV2EntitlementProducts(projectId, entitlement.id, config.restApiKey);
        verification = parseRevenueCatV2Access({ activeEntitlements, entitlement, products, subscriptions }, now);
    }
    else {
        const payload = await fetchRevenueCatSubscriber(appUserId, config.restApiKey);
        const entitlement = payload.subscriber?.entitlements?.[config.entitlementId] ?? null;
        const productIdentifier = entitlement?.product_identifier ?? null;
        const subscription = productIdentifier
            ? payload.subscriber?.subscriptions?.[productIdentifier]
            : undefined;
        const expiresAtValue = entitlement?.expires_date ?? subscription?.expires_date ?? null;
        verification = {
            environment: subscription?.is_sandbox ? "SANDBOX" : "PRODUCTION",
            expiresAt: expiresAtValue ? new Date(expiresAtValue) : null,
            isPro: isEntitlementActive(entitlement, now),
            managementURL: payload.subscriber?.management_url ?? null,
            periodType: subscription?.period_type ?? null,
            productIdentifier,
        };
    }
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
            environment: verification.environment,
            expiresAt: verification.expiresAt,
            isPro: verification.isPro,
            managementUrl: verification.managementURL,
            periodType: verification.periodType,
            productIdentifier: verification.productIdentifier,
            userId: appUserId,
            verifiedAt: now,
        },
        update: {
            entitlementId: config.entitlementId,
            environment: verification.environment,
            expiresAt: verification.expiresAt,
            isPro: verification.isPro,
            managementUrl: verification.managementURL,
            periodType: verification.periodType,
            productIdentifier: verification.productIdentifier,
            verifiedAt: now,
        },
    });
    if (clientApp === "vybaa" &&
        previousSnapshot?.isPro &&
        !verification.isPro) {
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
