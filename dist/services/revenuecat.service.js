"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REVENUECAT_PRODUCT_IDS = exports.REVENUECAT_ENTITLEMENT_ID = void 0;
exports.getRevenueCatConfig = getRevenueCatConfig;
exports.getRevenueCatSubscriptionStatus = getRevenueCatSubscriptionStatus;
const env_util_1 = require("../utils/env.util");
exports.REVENUECAT_ENTITLEMENT_ID = "My Cove Pro";
exports.REVENUECAT_PRODUCT_IDS = {
    monthly: "monthly",
    yearly: "yearly",
};
function getRevenueCatConfig() {
    return {
        entitlementId: exports.REVENUECAT_ENTITLEMENT_ID,
        products: exports.REVENUECAT_PRODUCT_IDS,
    };
}
async function getRevenueCatSubscriptionStatus(appUserId) {
    const fallback = createFallbackStatus(appUserId);
    if (!env_util_1.Env.REVENUECAT_REST_API_KEY) {
        return fallback;
    }
    const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${env_util_1.Env.REVENUECAT_REST_API_KEY}`,
        },
    });
    if (!response.ok) {
        throw new Error("Failed to verify RevenueCat subscription status");
    }
    const payload = (await response.json());
    const entitlement = payload.subscriber?.entitlements?.[exports.REVENUECAT_ENTITLEMENT_ID] ?? null;
    return {
        appUserId,
        entitlementId: exports.REVENUECAT_ENTITLEMENT_ID,
        isConfigured: true,
        isPro: isEntitlementActive(entitlement),
        latestExpirationDate: entitlement?.expires_date ?? null,
        managementURL: payload.subscriber?.management_url ?? null,
        productIdentifier: entitlement?.product_identifier ?? null,
        verifiedAt: new Date().toISOString(),
    };
}
function createFallbackStatus(appUserId) {
    return {
        appUserId,
        entitlementId: exports.REVENUECAT_ENTITLEMENT_ID,
        isConfigured: false,
        isPro: false,
        latestExpirationDate: null,
        managementURL: null,
        productIdentifier: null,
        verifiedAt: new Date().toISOString(),
    };
}
function isEntitlementActive(entitlement) {
    if (!entitlement) {
        return false;
    }
    if (!entitlement.expires_date) {
        return true;
    }
    return new Date(entitlement.expires_date).getTime() > Date.now();
}
