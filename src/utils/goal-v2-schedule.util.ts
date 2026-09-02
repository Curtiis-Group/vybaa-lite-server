import { DateTime } from "luxon";

import type { GoalScheduleInput } from "../validators/goal-v2.validators";

export interface GoalOccurrenceWindow {
  closesAt: Date;
  dueDate: Date;
  dueDateKey: string;
}

function parseLocalDate(date: string, timezone: string): DateTime {
  const parsed = DateTime.fromISO(date, { zone: timezone }).startOf("day");
  if (!parsed.isValid) {
    throw new Error("Invalid goal schedule date or timezone");
  }
  return parsed;
}

function isScheduledDay(
  date: DateTime,
  schedule: GoalScheduleInput,
): boolean {
  if (schedule.type === "DAILY" || schedule.type === "ONE_TIME") return true;
  if (schedule.type === "WEEKLY") return date.weekday === schedule.weekday;
  return schedule.weekdays.includes(date.weekday);
}

export function getScheduleStartDate(schedule: GoalScheduleInput): string {
  return schedule.type === "ONE_TIME" ? schedule.date : schedule.startDate;
}

export function resolveGoalHardStopDate(params: {
  hardStopDate?: string;
  schedule: GoalScheduleInput;
  targetEndDate?: string;
  timezone: string;
}): string {
  const startKey = getScheduleStartDate(params.schedule);
  const start = parseLocalDate(startKey, params.timezone);
  const requestedEnd =
    params.targetEndDate ??
    params.hardStopDate ??
    (params.schedule.type === "ONE_TIME" ? params.schedule.date : params.schedule.endDate);
  const hardStop = requestedEnd
    ? parseLocalDate(requestedEnd, params.timezone)
    : start.plus({ days: 364 });

  if (hardStop < start) throw new Error("Goal end date cannot precede its start date");
  if (hardStop.diff(start, "days").days > 364) {
    throw new Error("Goal duration cannot exceed 365 days");
  }
  return hardStop.toISODate() ?? startKey;
}

export function generateGoalOccurrenceWindows(params: {
  hardStopDate: string;
  schedule: GoalScheduleInput;
  timezone: string;
}): GoalOccurrenceWindow[] {
  const start = parseLocalDate(
    getScheduleStartDate(params.schedule),
    params.timezone,
  );
  const hardStop = parseLocalDate(params.hardStopDate, params.timezone);
  const windows: GoalOccurrenceWindow[] = [];

  for (let dayOffset = 0; dayOffset <= 364; dayOffset += 1) {
    const localDate = start.plus({ days: dayOffset });
    if (localDate > hardStop) break;
    if (!isScheduledDay(localDate, params.schedule)) continue;

    const dueDateKey = localDate.toISODate();
    if (!dueDateKey) continue;
    windows.push({
      closesAt: localDate.endOf("day").toUTC().toJSDate(),
      dueDate: DateTime.fromISO(dueDateKey, { zone: "UTC" }).toJSDate(),
      dueDateKey,
    });
  }

  if (!windows.length) throw new Error("Schedule produces no occurrences");
  return windows;
}

export function getLocalDateKey(date: Date, timezone: string): string {
  const localDate = DateTime.fromJSDate(date, { zone: timezone });
  if (!localDate.isValid) throw new Error("Invalid timezone");
  return localDate.toISODate() ?? date.toISOString().slice(0, 10);
}

export function getOccurrenceCloseTime(
  dueDateKey: string,
  timezone: string,
): Date {
  return parseLocalDate(dueDateKey, timezone).endOf("day").toUTC().toJSDate();
}

export function shiftDateByDays(date: Date, days: number): Date {
  return DateTime.fromJSDate(date, { zone: "UTC" })
    .plus({ days })
    .startOf("day")
    .toJSDate();
}
