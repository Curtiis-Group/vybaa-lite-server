import { RewindFrequency } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";

import { Env } from "../utils/env.util";
import {
  FREE_SUBSCRIPTION_LIMITS,
  PRO_SUBSCRIPTION_LIMITS,
  VYBAA_ENTITLEMENT_ID,
  VYBAA_PRODUCT_IDS,
  getLimitsForAccess,
  getRevenueCatConfig,
  isEntitlementActive,
  matchesRevenueCatEntitlementIdentifier,
  parseRevenueCatV2Access,
} from "./revenuecat.service";
import {
  assertCanCreateCommunity,
  assertCanCreateGoal,
  assertCanUseRewindFrequency,
  assertCanUseRewindInsightsRange,
  requiresProForInsightsRange,
  requiresProForRewindFrequency,
} from "./subscription-access.service";
import { getFreeTierRoutineFrequency } from "./subscription-downgrade.service";

test("Vybaa uses its own entitlement and store products", () => {
  const config = getRevenueCatConfig("vybaa");

  assert.equal(config.entitlementId, VYBAA_ENTITLEMENT_ID);
  assert.deepEqual(config.products, VYBAA_PRODUCT_IDS);
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
            store_identifier: "com.vybaa.app.pro.monthly",
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
  assert.equal(verification.productIdentifier, "com.vybaa.app.pro.monthly");
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
