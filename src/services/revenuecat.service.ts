import type { SubscriptionSnapshot } from "@prisma/client";

import { prisma } from "../config/db.config";
import type { ClientApp } from "../types/client-app.type";
import { toPrismaClientApp } from "../types/client-app.type";
import { Env } from "../utils/env.util";
import { downgradeRewindRoutineToFreeTier } from "./subscription-downgrade.service";

export const SUBSCRIPTION_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

export const VYBAA_ENTITLEMENT_ID = "vybaa_pro";
export const VYBAA_OFFERING_ID = "default";

export const VYBAA_PRODUCT_IDS = {
  annual: "com.vybaa.app.pro.annual",
  monthly: "com.vybaa.app.pro.monthly",
} as const;

export const FREE_SUBSCRIPTION_LIMITS = {
  activeGoals: 3,
  insightRanges: ["7d"] as const,
  ownedCommunities: 1,
  rewindSessionsPerDay: 1,
} as const;

export const PRO_SUBSCRIPTION_LIMITS = {
  activeGoals: null,
  insightRanges: ["7d", "30d", "90d"] as const,
  ownedCommunities: 10,
  rewindSessionsPerDay: 2,
} as const;

interface RevenueCatEntitlement {
  expires_date?: string | null;
  product_identifier?: string | null;
}

interface RevenueCatSubscription {
  expires_date?: string | null;
  is_sandbox?: boolean;
  period_type?: string | null;
}

interface RevenueCatSubscriber {
  entitlements?: Record<string, RevenueCatEntitlement>;
  management_url?: string | null;
  subscriptions?: Record<string, RevenueCatSubscription>;
}

interface RevenueCatSubscriberResponse {
  subscriber?: RevenueCatSubscriber;
}

interface RevenueCatClientConfig {
  entitlementId: string;
  offeringId: string;
  products: {
    annual: string;
    monthly: string;
  };
  restApiKey?: string;
}

export interface SubscriptionAccess {
  clientApp: ClientApp;
  entitlementId: string;
  environment: string | null;
  expiresAt: string | null;
  isConfigured: boolean;
  isPro: boolean;
  isTrial: boolean;
  managementURL: string | null;
  productIdentifier: string | null;
  tier: "free" | "pro";
  verifiedAt: string;
}

export interface SubscriptionConfig {
  entitlementId: string;
  free: typeof FREE_SUBSCRIPTION_LIMITS;
  offeringId: string;
  pro: typeof PRO_SUBSCRIPTION_LIMITS;
  products: RevenueCatClientConfig["products"];
}

function getRevenueCatClientConfig(clientApp: ClientApp): RevenueCatClientConfig {
  if (clientApp === "mycove") {
    return {
      entitlementId:
        Env.MYCOVE_REVENUECAT_ENTITLEMENT_ID?.trim() || "My Cove Pro",
      offeringId: "default",
      products: { annual: "yearly", monthly: "monthly" },
      restApiKey: Env.MYCOVE_REVENUECAT_REST_API_KEY,
    };
  }

  return {
    entitlementId:
      Env.REVENUECAT_ENTITLEMENT_ID?.trim() || VYBAA_ENTITLEMENT_ID,
    offeringId: VYBAA_OFFERING_ID,
    products: VYBAA_PRODUCT_IDS,
    restApiKey: Env.REVENUECAT_REST_API_KEY,
  };
}

export function getRevenueCatConfig(clientApp: ClientApp): SubscriptionConfig {
  const config = getRevenueCatClientConfig(clientApp);
  return {
    entitlementId: config.entitlementId,
    free: FREE_SUBSCRIPTION_LIMITS,
    offeringId: config.offeringId,
    pro: PRO_SUBSCRIPTION_LIMITS,
    products: config.products,
  };
}

export function isEntitlementActive(
  entitlement: RevenueCatEntitlement | null,
  now: Date,
): boolean {
  if (!entitlement) return false;
  if (!entitlement.expires_date) return true;
  return new Date(entitlement.expires_date).getTime() > now.getTime();
}

function snapshotToAccess(
  snapshot: SubscriptionSnapshot,
  clientApp: ClientApp,
  isConfigured: boolean,
  now: Date,
): SubscriptionAccess {
  const isPro =
    snapshot.isPro &&
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

function createFreeAccess(
  clientApp: ClientApp,
  isConfigured: boolean,
  now: Date,
): SubscriptionAccess {
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

async function fetchRevenueCatSubscriber(
  appUserId: string,
  restApiKey: string,
): Promise<RevenueCatSubscriberResponse> {
  const response = await fetch(
    `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${restApiKey}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(`RevenueCat verification failed with status ${response.status}`);
  }

  return (await response.json()) as RevenueCatSubscriberResponse;
}

export async function refreshRevenueCatSubscription(
  appUserId: string,
  clientApp: ClientApp,
  now: Date = new Date(),
): Promise<SubscriptionAccess> {
  const config = getRevenueCatClientConfig(clientApp);
  if (!config.restApiKey) {
    return createFreeAccess(clientApp, false, now);
  }

  const payload = await fetchRevenueCatSubscriber(appUserId, config.restApiKey);
  const entitlement =
    payload.subscriber?.entitlements?.[config.entitlementId] ?? null;
  const productIdentifier = entitlement?.product_identifier ?? null;
  const subscription = productIdentifier
    ? payload.subscriber?.subscriptions?.[productIdentifier]
    : undefined;
  const expiresAtValue =
    entitlement?.expires_date ?? subscription?.expires_date ?? null;
  const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
  const isPro = isEntitlementActive(entitlement, now);

  const previousSnapshot = await prisma.subscriptionSnapshot.findUnique({
    where: {
      userId_clientApp: {
        clientApp: toPrismaClientApp(clientApp),
        userId: appUserId,
      },
    },
  });

  const snapshot = await prisma.subscriptionSnapshot.upsert({
    where: {
      userId_clientApp: {
        clientApp: toPrismaClientApp(clientApp),
        userId: appUserId,
      },
    },
    create: {
      clientApp: toPrismaClientApp(clientApp),
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
    await downgradeRewindRoutineToFreeTier(appUserId);
  }

  return snapshotToAccess(snapshot, clientApp, true, now);
}

export async function getRevenueCatSubscriptionStatus(
  appUserId: string,
  clientApp: ClientApp,
  options: { forceRefresh?: boolean; now?: Date } = {},
): Promise<SubscriptionAccess> {
  const now = options.now ?? new Date();
  const config = getRevenueCatClientConfig(clientApp);
  const snapshot = await prisma.subscriptionSnapshot.findUnique({
    where: {
      userId_clientApp: {
        clientApp: toPrismaClientApp(clientApp),
        userId: appUserId,
      },
    },
  });
  const isFresh =
    snapshot &&
    now.getTime() - snapshot.verifiedAt.getTime() <
      SUBSCRIPTION_SNAPSHOT_TTL_MS;

  if (!options.forceRefresh && isFresh) {
    return snapshotToAccess(snapshot, clientApp, Boolean(config.restApiKey), now);
  }

  try {
    return await refreshRevenueCatSubscription(appUserId, clientApp, now);
  } catch (error) {
    if (snapshot) {
      return snapshotToAccess(snapshot, clientApp, true, now);
    }
    throw error;
  }
}

export function getLimitsForAccess(
  access: Pick<SubscriptionAccess, "isPro">,
): typeof FREE_SUBSCRIPTION_LIMITS | typeof PRO_SUBSCRIPTION_LIMITS {
  return access.isPro ? PRO_SUBSCRIPTION_LIMITS : FREE_SUBSCRIPTION_LIMITS;
}
