"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getScheduleStartDate = getScheduleStartDate;
exports.resolveGoalHardStopDate = resolveGoalHardStopDate;
exports.generateGoalOccurrenceWindows = generateGoalOccurrenceWindows;
exports.getLocalDateKey = getLocalDateKey;
exports.getOccurrenceCloseTime = getOccurrenceCloseTime;
exports.shiftDateByDays = shiftDateByDays;
const luxon_1 = require("luxon");
function parseLocalDate(date, timezone) {
    const parsed = luxon_1.DateTime.fromISO(date, { zone: timezone }).startOf("day");
    if (!parsed.isValid) {
        throw new Error("Invalid goal schedule date or timezone");
    }
    return parsed;
}
function isScheduledDay(date, schedule) {
    if (schedule.type === "DAILY" || schedule.type === "ONE_TIME")
        return true;
    if (schedule.type === "WEEKLY")
        return date.weekday === schedule.weekday;
    return schedule.weekdays.includes(date.weekday);
}
function getScheduleStartDate(schedule) {
    return schedule.type === "ONE_TIME" ? schedule.date : schedule.startDate;
}
function resolveGoalHardStopDate(params) {
    const startKey = getScheduleStartDate(params.schedule);
    const start = parseLocalDate(startKey, params.timezone);
    const requestedEnd = params.targetEndDate ??
        params.hardStopDate ??
        (params.schedule.type === "ONE_TIME" ? params.schedule.date : params.schedule.endDate);
    const hardStop = requestedEnd
        ? parseLocalDate(requestedEnd, params.timezone)
        : start.plus({ days: 364 });
    if (hardStop < start)
        throw new Error("Goal end date cannot precede its start date");
    if (hardStop.diff(start, "days").days > 364) {
        throw new Error("Goal duration cannot exceed 365 days");
    }
    return hardStop.toISODate() ?? startKey;
}
function generateGoalOccurrenceWindows(params) {
    const start = parseLocalDate(getScheduleStartDate(params.schedule), params.timezone);
    const hardStop = parseLocalDate(params.hardStopDate, params.timezone);
    const windows = [];
    for (let dayOffset = 0; dayOffset <= 364; dayOffset += 1) {
        const localDate = start.plus({ days: dayOffset });
        if (localDate > hardStop)
            break;
        if (!isScheduledDay(localDate, params.schedule))
            continue;
        const dueDateKey = localDate.toISODate();
        if (!dueDateKey)
            continue;
        windows.push({
            closesAt: localDate.endOf("day").toUTC().toJSDate(),
            dueDate: luxon_1.DateTime.fromISO(dueDateKey, { zone: "UTC" }).toJSDate(),
            dueDateKey,
        });
    }
    if (!windows.length)
        throw new Error("Schedule produces no occurrences");
    return windows;
}
function getLocalDateKey(date, timezone) {
    const localDate = luxon_1.DateTime.fromJSDate(date, { zone: timezone });
    if (!localDate.isValid)
        throw new Error("Invalid timezone");
    return localDate.toISODate() ?? date.toISOString().slice(0, 10);
}
function getOccurrenceCloseTime(dueDateKey, timezone) {
    return parseLocalDate(dueDateKey, timezone).endOf("day").toUTC().toJSDate();
}
function shiftDateByDays(date, days) {
    return luxon_1.DateTime.fromJSDate(date, { zone: "UTC" })
        .plus({ days })
        .startOf("day")
        .toJSDate();
}
