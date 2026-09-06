import assert from "node:assert/strict";
import test from "node:test";

import { getRewindPartnerSwitchAvailability } from "./rewind-partner-switch.service";

test("Rewind partner changes are limited by the user's local calendar day", () => {
  const now = new Date("2026-09-05T22:00:00.000Z");
  const changedEarlierInLagos = new Date("2026-09-05T00:00:00.000Z");
  const lagos = getRewindPartnerSwitchAvailability(
    changedEarlierInLagos,
    "Africa/Lagos",
    now,
  );

  assert.equal(lagos.canChange, false);
  assert.equal(
    lagos.nextAvailableAt?.toISOString(),
    "2026-09-05T23:00:00.000Z",
  );

  const newYork = getRewindPartnerSwitchAvailability(
    changedEarlierInLagos,
    "America/New_York",
    now,
  );
  assert.equal(newYork.canChange, true);
  assert.equal(newYork.nextAvailableAt, null);
});

test("a first Rewind partner selection has no daily cooldown", () => {
  const availability = getRewindPartnerSwitchAvailability(
    null,
    "Africa/Lagos",
    new Date("2026-09-05T12:00:00.000Z"),
  );

  assert.equal(availability.canChange, true);
  assert.equal(availability.nextAvailableAt, null);
});
