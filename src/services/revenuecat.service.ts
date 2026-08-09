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

interface RevenueCatV2Entitlement {
  id?: string;
  lookup_key?: string;
  products?: RevenueCatV2List<RevenueCatV2Product>;
}

interface RevenueCatV2List<T> {
  items?: T[];
  next_page?: string | null;
}

interface RevenueCatV2Product {
  id?: string;
  store_identifier?: string;
}

interface RevenueCatV2Subscription {
  current_period_ends_at?: number | null;
  ends_at?: number | null;
  entitlements?: RevenueCatV2List<RevenueCatV2Entitlement>;
  environment?: string | null;
  gives_access?: boolean;
  product_id?: string | null;
  status?: string | null;
}

interface RevenueCatClientConfig {
  entitlementId: string;
  offeringId: string;
  products: {
    annual: string;
    monthly: string;
  };
  projectId?: string;
  restApiKey?: string;
}

export interface RevenueCatVerification {
  environment: string | null;
  expiresAt: Date | null;
  isPro: boolean;
  managementURL: string | null;
  periodType: string | null;
  productIdentifier: string | null;
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
      projectId: Env.MYCOVE_REVENUECAT_PROJECT_ID,
      restApiKey: Env.MYCOVE_REVENUECAT_REST_API_KEY,
    };
  }

  return {
    entitlementId:
      Env.REVENUECAT_ENTITLEMENT_ID?.trim() || VYBAA_ENTITLEMENT_ID,
    offeringId: VYBAA_OFFERING_ID,
    products: VYBAA_PRODUCT_IDS,
    projectId: Env.REVENUECAT_PROJECT_ID,
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
    isTrial:
      isPro && Boolean(snapshot.periodType?.toLowerCase().includes("trial")),
    managementURL: snapshot.managementUrl,
    productIdentifier: snapshot.productIdentifier,
    tier: isPro ? "pro" : "free",
    verifiedAt: snapshot.verifiedAt.toISOString(),
  };
}

function normalizeEntitlementIdentifier(identifier: string): string {
  return identifier
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function matchesRevenueCatEntitlementIdentifier(
  entitlement: Pick<RevenueCatV2Entitlement, "id" | "lookup_key">,
  configuredIdentifier: string,
): boolean {
  if (
    entitlement.id === configuredIdentifier ||
    entitlement.lookup_key === configuredIdentifier
  ) {
    return true;
  }

  const normalizedIdentifier = normalizeEntitlementIdentifier(
    configuredIdentifier,
  );
  return (
    normalizeEntitlementIdentifier(entitlement.lookup_key ?? "") ===
    normalizedIdentifier
  );
}

function parseRevenueCatTimestamp(value: number | null | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getSubscriptionEndTime(
  subscription: RevenueCatV2Subscription,
): number {
  return (
    subscription.current_period_ends_at ?? subscription.ends_at ?? 0
  );
}

export function parseRevenueCatV2Subscription(
  payload: RevenueCatV2List<RevenueCatV2Subscription>,
  entitlementId: string,
  now: Date,
): RevenueCatVerification {
  const candidates = (payload.items ?? []).flatMap((subscription) => {
    const entitlement = subscription.entitlements?.items?.find((item) =>
      matchesRevenueCatEntitlementIdentifier(item, entitlementId),
    );
    return entitlement ? [{ entitlement, subscription }] : [];
  });

  candidates.sort((left, right) => {
    const accessDifference =
      Number(Boolean(right.subscription.gives_access)) -
      Number(Boolean(left.subscription.gives_access));
    if (accessDifference !== 0) return accessDifference;
    return (
      getSubscriptionEndTime(right.subscription) -
      getSubscriptionEndTime(left.subscription)
    );
  });

  const match = candidates[0];
  if (!match) {
    return {
      environment: null,
      expiresAt: null,
      isPro: false,
      managementURL: null,
      periodType: null,
      productIdentifier: null,
    };
  }

  const expiresAt = parseRevenueCatTimestamp(
    match.subscription.current_period_ends_at ?? match.subscription.ends_at,
  );
  const isPro =
    Boolean(match.subscription.gives_access) &&
    (!expiresAt || expiresAt.getTime() > now.getTime());
  const product = match.entitlement.products?.items?.find(
    (item) => item.id === match.subscription.product_id,
  );

  return {
    environment: match.subscription.environment?.toUpperCase() ?? null,
    expiresAt,
    isPro,
    managementURL: null,
    periodType: match.subscription.status ?? null,
    productIdentifier:
      product?.store_identifier ?? match.subscription.product_id ?? null,
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

async function fetchRevenueCatV2Subscriptions(
  appUserId: string,
  projectId: string,
  restApiKey: string,
): Promise<RevenueCatV2List<RevenueCatV2Subscription>> {
  const response = await fetch(
    `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/customers/${encodeURIComponent(appUserId)}/subscriptions?limit=100`,
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${restApiKey}`,
      },
    },
  );

  if (response.status === 404) return { items: [] };
  if (!response.ok) {
    throw new Error(
      `RevenueCat API v2 verification failed with status ${response.status}`,
    );
  }

  return (await response.json()) as RevenueCatV2List<RevenueCatV2Subscription>;
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

  let verification: RevenueCatVerification;
  if (config.projectId?.trim()) {
    const payload = await fetchRevenueCatV2Subscriptions(
      appUserId,
      config.projectId.trim(),
      config.restApiKey,
    );
    verification = parseRevenueCatV2Subscription(
      payload,
      config.entitlementId,
      now,
    );
  } else {
    const payload = await fetchRevenueCatSubscriber(
      appUserId,
      config.restApiKey,
    );
    const entitlement =
      payload.subscriber?.entitlements?.[config.entitlementId] ?? null;
    const productIdentifier = entitlement?.product_identifier ?? null;
    const subscription = productIdentifier
      ? payload.subscriber?.subscriptions?.[productIdentifier]
      : undefined;
    const expiresAtValue =
      entitlement?.expires_date ?? subscription?.expires_date ?? null;

    verification = {
      environment: subscription?.is_sandbox ? "SANDBOX" : "PRODUCTION",
      expiresAt: expiresAtValue ? new Date(expiresAtValue) : null,
      isPro: isEntitlementActive(entitlement, now),
      managementURL: payload.subscriber?.management_url ?? null,
      periodType: subscription?.period_type ?? null,
      productIdentifier,
    };
  }

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

  if (
    clientApp === "vybaa" &&
    previousSnapshot?.isPro &&
    !verification.isPro
  ) {
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
