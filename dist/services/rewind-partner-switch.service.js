"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRewindPartnerSwitchAvailability = getRewindPartnerSwitchAvailability;
const luxon_1 = require("luxon");
const rewind_routine_service_1 = require("./rewind-routine.service");
function getRewindPartnerSwitchAvailability(lastChangedAt, timezone, now = new Date()) {
    const zone = (0, rewind_routine_service_1.normalizeRewindTimezone)(timezone);
    const localNow = luxon_1.DateTime.fromJSDate(now, { zone });
    const currentDayStartedAt = localNow.startOf("day").toUTC().toJSDate();
    if (!lastChangedAt) {
        return {
            canChange: true,
            currentDayStartedAt,
            nextAvailableAt: null,
        };
    }
    const changedOnCurrentDay = luxon_1.DateTime.fromJSDate(lastChangedAt, {
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
