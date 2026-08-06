import { RewindFrequency } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_SUBSCRIPTION_LIMITS,
  PRO_SUBSCRIPTION_LIMITS,
  VYBAA_ENTITLEMENT_ID,
  VYBAA_PRODUCT_IDS,
  getLimitsForAccess,
  getRevenueCatConfig,
  isEntitlementActive,
} from "./revenuecat.service";
import {
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
  const config = getRevenueCatConfig("mycove");

  assert.equal(config.entitlementId, "My Cove Pro");
  assert.deepEqual(config.products, { annual: "yearly", monthly: "monthly" });
});

test("subscription limits reflect the selected tier", () => {
  assert.deepEqual(getLimitsForAccess({ isPro: false }), FREE_SUBSCRIPTION_LIMITS);
  assert.deepEqual(getLimitsForAccess({ isPro: true }), PRO_SUBSCRIPTION_LIMITS);
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
