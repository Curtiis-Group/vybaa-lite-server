import { DateTime } from "luxon";

import { normalizeRewindTimezone } from "./rewind-routine.service";

export type RewindPartnerSwitchAvailability = {
  canChange: boolean;
  currentDayStartedAt: Date;
  nextAvailableAt: Date | null;
};

export function getRewindPartnerSwitchAvailability(
  lastChangedAt: Date | null,
  timezone: string,
  now: Date = new Date(),
): RewindPartnerSwitchAvailability {
  const zone = normalizeRewindTimezone(timezone);
  const localNow = DateTime.fromJSDate(now, { zone });
  const currentDayStartedAt = localNow.startOf("day").toUTC().toJSDate();

  if (!lastChangedAt) {
    return {
      canChange: true,
      currentDayStartedAt,
      nextAvailableAt: null,
    };
  }

  const changedOnCurrentDay = DateTime.fromJSDate(lastChangedAt, {
    zone,
  }).hasSame(localNow, "day");

  return {
    canChange: !changedOnCurrentDay,
    currentDayStartedAt,
    nextAvailableAt: changedOnCurrentDay
      ? localNow.startOf("day").plus({ days: 1 }).toUTC().toJSDate()
      : null,
  };
}
