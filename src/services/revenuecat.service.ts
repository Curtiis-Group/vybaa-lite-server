import { Env } from "../utils/env.util";

export const REVENUECAT_ENTITLEMENT_ID = "My Cove Pro";

export const REVENUECAT_PRODUCT_IDS = {
  monthly: "monthly",
  yearly: "yearly",
} as const;

interface RevenueCatEntitlement {
  expires_date?: string | null;
  product_identifier?: string | null;
}

interface RevenueCatSubscriber {
  entitlements?: Record<string, RevenueCatEntitlement>;
  management_url?: string | null;
}

interface RevenueCatSubscriberResponse {
  subscriber?: RevenueCatSubscriber;
}

export interface RevenueCatSubscriptionStatus {
  appUserId: string;
  entitlementId: string;
  isConfigured: boolean;
  isPro: boolean;
  latestExpirationDate: string | null;
  managementURL: string | null;
  productIdentifier: string | null;
  verifiedAt: string;
}

export interface RevenueCatConfig {
  entitlementId: string;
  products: typeof REVENUECAT_PRODUCT_IDS;
}

export function getRevenueCatConfig(): RevenueCatConfig {
  return {
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    products: REVENUECAT_PRODUCT_IDS,
  };
}

export async function getRevenueCatSubscriptionStatus(
  appUserId: string,
): Promise<RevenueCatSubscriptionStatus> {
  const fallback = createFallbackStatus(appUserId);

  if (!Env.REVENUECAT_REST_API_KEY) {
    return fallback;
  }

  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${Env.REVENUECAT_REST_API_KEY}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error("Failed to verify RevenueCat subscription status");
  }

  const payload = (await response.json()) as RevenueCatSubscriberResponse;
  const entitlement =
    payload.subscriber?.entitlements?.[REVENUECAT_ENTITLEMENT_ID] ?? null;

  return {
    appUserId,
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    isConfigured: true,
    isPro: isEntitlementActive(entitlement),
    latestExpirationDate: entitlement?.expires_date ?? null,
    managementURL: payload.subscriber?.management_url ?? null,
    productIdentifier: entitlement?.product_identifier ?? null,
    verifiedAt: new Date().toISOString(),
  };
}

function createFallbackStatus(appUserId: string): RevenueCatSubscriptionStatus {
  return {
    appUserId,
    entitlementId: REVENUECAT_ENTITLEMENT_ID,
    isConfigured: false,
    isPro: false,
    latestExpirationDate: null,
    managementURL: null,
    productIdentifier: null,
    verifiedAt: new Date().toISOString(),
  };
}

function isEntitlementActive(
  entitlement: RevenueCatEntitlement | null,
): boolean {
  if (!entitlement) {
    return false;
  }

  if (!entitlement.expires_date) {
    return true;
  }

  return new Date(entitlement.expires_date).getTime() > Date.now();
}
