import { RewindFrequency } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";

import { Env } from "../utils/env.util";
import {
  FREE_SUBSCRIPTION_LIMITS,
  PRODUCTION_SUBSCRIPTION_GRACE_MS,
  PRO_SUBSCRIPTION_LIMITS,
  SANDBOX_SUBSCRIPTION_GRACE_MS,
  VYBAA_ENTITLEMENT_ID,
  VYBAA_PRODUCT_IDS,
  getLimitsForAccess,
  getRevenueCatConfig,
  isEntitlementActive,
  isSubscriptionRecordActive,
  matchesRevenueCatEntitlementIdentifier,
  parseRevenueCatV2Access,
  type SubscriptionAccess,
} from "./revenuecat.service";
import {
  areVybaaProChecksEnabled,
  assertCanCreateCommunity,
  assertCanCreateGoal,
  assertCanSelectRewindPersona,
  assertCanUseQuickGoalSetup,
  assertCanUseRewindChats,
  assertCanUseRewindFrequency,
  assertCanUseRewindInsightsRange,
  getConfirmedVybaaAccess,
  getSubscriptionStatusWithProBypass,
  requiresProForInsightsRange,
  requiresProForRewindPersona,
  requiresProForRewindFrequency,
} from "./subscription-access.service";
import { getFreeTierRoutineFrequency } from "./subscription-downgrade.service";

test("Vybaa uses its own entitlement and store products", () => {
  const config = getRevenueCatConfig("vybaa");

  assert.equal(config.entitlementId, VYBAA_ENTITLEMENT_ID);
  assert.deepEqual(config.products, VYBAA_PRODUCT_IDS);
  assert.deepEqual(config.products, {
    annual: "com.vybaa.pro.annual",
    monthly: "com.vybaa.pro.monthly",
  });
  assert.equal(config.offeringId, "default");
});

test("My Cove subscription configuration remains isolated", () => {
  const previousEntitlement = Env.MYCOVE_REVENUECAT_ENTITLEMENT_ID;
  Env.MYCOVE_REVENUECAT_ENTITLEMENT_ID = "mycove_pro";
  const config = getRevenueCatConfig("mycove");

  assert.equal(config.entitlementId, "mycove_pro");
  assert.deepEqual(config.products, { annual: "yearly", monthly: "monthly" });
  Env.MYCOVE_REVENUECAT_ENTITLEMENT_ID = previousEntitlement;
});

test("subscription limits reflect the selected tier", () => {
  assert.deepEqual(
    getLimitsForAccess({ isPro: false }),
    FREE_SUBSCRIPTION_LIMITS,
  );
  assert.deepEqual(
    getLimitsForAccess({ isPro: true }),
    PRO_SUBSCRIPTION_LIMITS,
  );
});

test("expired RevenueCat entitlements are inactive", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");

  assert.equal(
    isEntitlementActive({ expires_date: "2026-08-06T11:59:59.000Z" }, now),
    false,
  );
  assert.equal(
    isEntitlementActive({ expires_date: "2026-08-06T12:00:01.000Z" }, now),
    true,
  );
  assert.equal(isEntitlementActive({ expires_date: null }, now), true);
  assert.equal(isEntitlementActive(null, now), false);
});

test("recently expired subscriptions retain a bounded verification grace", () => {
  const expiredAt = new Date("2026-10-03T10:11:00.000Z");

  assert.equal(
    isSubscriptionRecordActive(
      true,
      expiredAt,
      "PRODUCTION",
      new Date(expiredAt.getTime() + PRODUCTION_SUBSCRIPTION_GRACE_MS - 1),
    ),
    true,
  );
  assert.equal(
    isSubscriptionRecordActive(
      true,
      expiredAt,
      "PRODUCTION",
      new Date(expiredAt.getTime() + PRODUCTION_SUBSCRIPTION_GRACE_MS),
    ),
    false,
  );
  assert.equal(
    isSubscriptionRecordActive(
      true,
      expiredAt,
      "SANDBOX",
      new Date(expiredAt.getTime() + SANDBOX_SUBSCRIPTION_GRACE_MS - 1),
    ),
    true,
  );
  assert.equal(
    isSubscriptionRecordActive(
      true,
      expiredAt,
      "SANDBOX",
      new Date(expiredAt.getTime() + SANDBOX_SUBSCRIPTION_GRACE_MS),
    ),
    false,
  );
  assert.equal(
    isSubscriptionRecordActive(
      false,
      null,
      "SANDBOX",
      new Date("2026-10-03T10:11:00.000Z"),
    ),
    false,
  );
});

test("cached free access is refreshed before a Pro feature is denied", async () => {
  const checks: boolean[] = [];
  const freeAccess: SubscriptionAccess = {
    clientApp: "vybaa",
    entitlementId: VYBAA_ENTITLEMENT_ID,
    environment: null,
    expiresAt: null,
    isConfigured: true,
    isPro: false,
    isTrial: false,
    managementURL: null,
    productIdentifier: null,
    tier: "free",
    verifiedAt: "2026-10-03T09:59:23.063Z",
  };
  const proAccess: SubscriptionAccess = {
    ...freeAccess,
    environment: "SANDBOX",
    expiresAt: "2026-10-03T10:06:00.134Z",
    isPro: true,
    productIdentifier: VYBAA_PRODUCT_IDS.monthly,
    tier: "pro",
  };

  const access = await getConfirmedVybaaAccess(
    "user-who-just-purchased",
    "vybaa",
    async (_userId, _clientApp, options) => {
      checks.push(Boolean(options?.forceRefresh));
      return options?.forceRefresh ? proAccess : freeAccess;
    },
  );

  assert.equal(access?.isPro, true);
  assert.deepEqual(checks, [false, true]);
});

test("disabled Vybaa Pro checks bypass every backend subscription gate", async () => {
  const previousValue = Env.VYBAA_PRO_CHECKS_ENABLED;
  Env.VYBAA_PRO_CHECKS_ENABLED = "false";
  let dependencyCalls = 0;
  const failIfCalled = async (): Promise<never> => {
    dependencyCalls += 1;
    throw new Error("Subscription dependency should not be called");
  };

  try {
    assert.equal(areVybaaProChecksEnabled("vybaa"), false);
    assert.equal(areVybaaProChecksEnabled("mycove"), true);

    const access = await getConfirmedVybaaAccess(
      "temporary-pro-user",
      "vybaa",
      failIfCalled,
    );
    assert.equal(access?.isPro, true);
    assert.equal(access?.environment, "BYPASS");

    const synchronizedAccess = await getSubscriptionStatusWithProBypass(
      "temporary-pro-user",
      "vybaa",
      { forceRefresh: true },
      failIfCalled,
    );
    assert.equal(synchronizedAccess.isPro, true);
    assert.equal(synchronizedAccess.environment, "BYPASS");

    await assert.doesNotReject(() =>
      assertCanCreateGoal("temporary-pro-user", "vybaa", {
        countActiveGoals: failIfCalled,
        loadAccess: failIfCalled,
      }),
    );
    await assert.doesNotReject(() =>
      assertCanCreateCommunity("temporary-pro-user", "vybaa", {
        countOwnedCommunities: failIfCalled,
        loadAccess: failIfCalled,
      }),
    );
    await assert.doesNotReject(() =>
      assertCanUseRewindFrequency(
        "temporary-pro-user",
        "vybaa",
        RewindFrequency.CUSTOM,
        failIfCalled,
      ),
    );
    await assert.doesNotReject(() =>
      assertCanUseRewindInsightsRange(
        "temporary-pro-user",
        "vybaa",
        "90d",
        failIfCalled,
      ),
    );
    await assert.doesNotReject(() =>
      assertCanUseRewindChats("temporary-pro-user", "vybaa", failIfCalled),
    );
    await assert.doesNotReject(() =>
      assertCanUseQuickGoalSetup(
        "temporary-pro-user",
        "vybaa",
        failIfCalled,
      ),
    );
    await assert.doesNotReject(() =>
      assertCanSelectRewindPersona(
        "temporary-pro-user",
        "vybaa",
        "neeja",
        failIfCalled,
      ),
    );
    assert.equal(dependencyCalls, 0);
  } finally {
    Env.VYBAA_PRO_CHECKS_ENABLED = previousValue;
  }
});

test("RevenueCat v2 active entitlements map Vybaa Pro access", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const expiresAt = new Date("2026-09-06T12:00:00.000Z");
  const verification = parseRevenueCatV2Access(
    {
      activeEntitlements: {
        items: [
          {
            entitlement_id: "entitlement-resource-id",
            expires_at: expiresAt.getTime(),
          },
        ],
      },
      entitlement: {
        id: "entitlement-resource-id",
        lookup_key: "Vybaa Pro",
      },
      products: {
        items: [
          {
            id: "product-resource-id",
            store_identifier: "com.vybaa.pro.monthly",
          },
        ],
      },
      subscriptions: {
        items: [
          {
            current_period_ends_at: expiresAt.getTime(),
            environment: "sandbox",
            gives_access: true,
            product_id: "product-resource-id",
            status: "trialing",
          },
        ],
      },
    },
    now,
  );

  assert.equal(verification.isPro, true);
  assert.equal(verification.expiresAt?.toISOString(), expiresAt.toISOString());
  assert.equal(verification.environment, "SANDBOX");
  assert.equal(verification.periodType, "trialing");
  assert.equal(verification.productIdentifier, "com.vybaa.pro.monthly");
  assert.equal(
    matchesRevenueCatEntitlementIdentifier(
      { lookup_key: "Vybaa Pro" },
      "vybaa_pro",
    ),
    true,
  );
});

test("RevenueCat v2 active entitlement grants access before metadata arrives", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const verification = parseRevenueCatV2Access(
    {
      activeEntitlements: {
        items: [{ entitlement_id: "entitlement-resource-id" }],
      },
      entitlement: { id: "entitlement-resource-id", lookup_key: "vybaa_pro" },
      products: { items: [] },
      subscriptions: { items: [] },
    },
    now,
  );

  assert.equal(verification.isPro, true);
  assert.equal(verification.productIdentifier, null);
  assert.equal(verification.expiresAt, null);
});

test("RevenueCat v2 ignores active entitlements for another product", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const verification = parseRevenueCatV2Access(
    {
      activeEntitlements: {
        items: [{ entitlement_id: "another-entitlement" }],
      },
      entitlement: { id: "entitlement-resource-id", lookup_key: "vybaa_pro" },
      products: {
        items: [{ id: "product-resource-id", store_identifier: "monthly" }],
      },
      subscriptions: {
        items: [
          {
            environment: "sandbox",
            gives_access: true,
            product_id: "product-resource-id",
            status: "active",
          },
        ],
      },
    },
    now,
  );

  assert.equal(verification.isPro, false);
});

test("RevenueCat v2 rejects expired active entitlement snapshots", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  const verification = parseRevenueCatV2Access(
    {
      activeEntitlements: {
        items: [
          {
            entitlement_id: "entitlement-resource-id",
            expires_at: now.getTime() - 1,
          },
        ],
      },
      entitlement: { id: "entitlement-resource-id", lookup_key: "vybaa_pro" },
      products: { items: [] },
      subscriptions: { items: [] },
    },
    now,
  );

  assert.equal(verification.isPro, false);
});

test("only advanced Rewind controls require Pro", () => {
  assert.equal(
    requiresProForRewindFrequency(RewindFrequency.JUST_MORNINGS),
    false,
  );
  assert.equal(
    requiresProForRewindFrequency(RewindFrequency.JUST_EVENINGS),
    false,
  );
  assert.equal(
    requiresProForRewindFrequency(RewindFrequency.MORNINGS_AND_EVENINGS),
    true,
  );
  assert.equal(requiresProForRewindFrequency(RewindFrequency.CUSTOM), true);
  assert.equal(requiresProForInsightsRange("7d"), false);
  assert.equal(requiresProForInsightsRange("30d"), true);
  assert.equal(requiresProForInsightsRange("90d"), true);
});

test("free accounts can choose Ella or Lyra only", () => {
  assert.equal(requiresProForRewindPersona("ella"), false);
  assert.equal(requiresProForRewindPersona("lyra"), false);
  assert.equal(requiresProForRewindPersona("jake"), true);
  assert.equal(requiresProForRewindPersona("ariel"), true);
  assert.equal(requiresProForRewindPersona("tobi"), true);
  assert.equal(requiresProForRewindPersona("neeja"), true);
  assert.equal(requiresProForRewindPersona(null), false);
});

test("paid Rewind and goal-assistant features require Pro", async () => {
  const freeAccess: SubscriptionAccess = {
    clientApp: "vybaa",
    entitlementId: VYBAA_ENTITLEMENT_ID,
    environment: "production",
    expiresAt: null,
    isConfigured: true,
    isPro: false,
    isTrial: false,
    managementURL: null,
    productIdentifier: null,
    tier: "free",
    verifiedAt: "2026-09-21T00:00:00.000Z",
  };
  const loadFreeAccess = async (): Promise<SubscriptionAccess> => freeAccess;

  await assert.doesNotReject(() =>
    assertCanSelectRewindPersona("user-free", "vybaa", "ella", loadFreeAccess),
  );
  await assert.rejects(
    () => assertCanUseRewindChats("user-free", "vybaa", loadFreeAccess),
    /Anytime Rewind chats require Vybaa Pro/,
  );
  await assert.rejects(
    () => assertCanUseQuickGoalSetup("user-free", "vybaa", loadFreeAccess),
    /Quick Goal Setup requires Vybaa Pro/,
  );
  await assert.rejects(
    () =>
      assertCanSelectRewindPersona(
        "user-free",
        "vybaa",
        "jake",
        loadFreeAccess,
      ),
    /require Vybaa Pro/,
  );
});

test("free Rewind capabilities do not depend on RevenueCat availability", async () => {
  const unavailableSubscription = async (): Promise<never> => {
    throw new Error("RevenueCat unavailable");
  };

  await assert.doesNotReject(() =>
    assertCanUseRewindInsightsRange(
      "user-free",
      "vybaa",
      "7d",
      unavailableSubscription,
    ),
  );
  await assert.doesNotReject(() =>
    assertCanUseRewindFrequency(
      "user-free",
      "vybaa",
      RewindFrequency.JUST_EVENINGS,
      unavailableSubscription,
    ),
  );
});

test("Pro accounts can use 30-day and 90-day Rewind insights", async () => {
  const proAccess: SubscriptionAccess = {
    clientApp: "vybaa",
    entitlementId: VYBAA_ENTITLEMENT_ID,
    environment: "production",
    expiresAt: null,
    isConfigured: true,
    isPro: true,
    isTrial: false,
    managementURL: null,
    productIdentifier: VYBAA_PRODUCT_IDS.monthly,
    tier: "pro",
    verifiedAt: "2026-08-28T00:00:00.000Z",
  };
  const loadProAccess = async (): Promise<SubscriptionAccess> => proAccess;

  await assert.doesNotReject(() =>
    assertCanUseRewindInsightsRange("user-pro", "vybaa", "30d", loadProAccess),
  );
  await assert.doesNotReject(() =>
    assertCanUseRewindInsightsRange("user-pro", "vybaa", "90d", loadProAccess),
  );
  await assert.doesNotReject(() =>
    assertCanUseRewindChats("user-pro", "vybaa", loadProAccess),
  );
  await assert.doesNotReject(() =>
    assertCanUseQuickGoalSetup("user-pro", "vybaa", loadProAccess),
  );
  await assert.doesNotReject(() =>
    assertCanSelectRewindPersona("user-pro", "vybaa", "neeja", loadProAccess),
  );
});

test("free goal and community slots do not depend on RevenueCat", async () => {
  let verificationAttempts = 0;
  const unavailableSubscription = async (): Promise<never> => {
    verificationAttempts += 1;
    throw new Error("RevenueCat unavailable");
  };

  await assert.doesNotReject(() =>
    assertCanCreateGoal("user-free", "vybaa", {
      countActiveGoals: async () => FREE_SUBSCRIPTION_LIMITS.activeGoals - 1,
      loadAccess: unavailableSubscription,
    }),
  );
  await assert.doesNotReject(() =>
    assertCanCreateCommunity("user-free", "vybaa", {
      countOwnedCommunities: async () =>
        FREE_SUBSCRIPTION_LIMITS.ownedCommunities - 1,
      loadAccess: unavailableSubscription,
    }),
  );

  assert.equal(verificationAttempts, 0);
});

test("actions beyond free limits still require subscription verification", async () => {
  const unavailableSubscription = async (): Promise<never> => {
    throw new Error("RevenueCat unavailable");
  };

  await assert.rejects(
    () =>
      assertCanCreateGoal("user-at-limit", "vybaa", {
        countActiveGoals: async () => FREE_SUBSCRIPTION_LIMITS.activeGoals,
        loadAccess: unavailableSubscription,
      }),
    /RevenueCat unavailable/,
  );
  await assert.rejects(
    () =>
      assertCanCreateCommunity("user-at-limit", "vybaa", {
        countOwnedCommunities: async () =>
          FREE_SUBSCRIPTION_LIMITS.ownedCommunities,
        loadAccess: unavailableSubscription,
      }),
    /RevenueCat unavailable/,
  );
});

test("downgrades dual Rewind routines to a single suitable preset", () => {
  assert.equal(
    getFreeTierRoutineFrequency(["08:00", "20:00"]),
    RewindFrequency.JUST_EVENINGS,
  );
  assert.equal(
    getFreeTierRoutineFrequency(["07:30", "09:30"]),
    RewindFrequency.JUST_MORNINGS,
  );
});
