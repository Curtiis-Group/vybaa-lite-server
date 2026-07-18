import {
  RewindFrequency,
  RewindIntent,
  RewindSessionStatus,
} from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../config/db.config";

export const DEFAULT_REWIND_TIMEZONE = "UTC";
export const MORNING_REWIND_TIME = "08:00";
export const EVENING_REWIND_TIME = "20:00";
export const REWIND_WINDOW_MINUTES = 60;
export const REWIND_MINIMUM_GAP_MINUTES = 8 * 60;

export type RewindRoutineInput = {
  customIntent?: string | null;
  frequency: RewindFrequency;
  intent: RewindIntent;
  times?: string[];
  timezone: string;
};

type RewindRoutineUser = {
  id: string;
  rewindPersona: string | null;
  timezone: string;
};

export function isValidRewindTimezone(timezone: string): boolean {
  return DateTime.now().setZone(timezone).isValid;
}

export function normalizeRewindTimezone(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_REWIND_TIMEZONE;

  const timezone = value.trim();
  if (!timezone || timezone.length > 64 || !isValidRewindTimezone(timezone)) {
    return DEFAULT_REWIND_TIMEZONE;
  }

  return timezone;
}

export function normalizeRewindTime(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getTimeMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function getRoutineTimes(input: {
  frequency: RewindFrequency;
  times?: string[];
}): string[] {
  switch (input.frequency) {
    case RewindFrequency.MORNINGS_AND_EVENINGS:
      return [MORNING_REWIND_TIME, EVENING_REWIND_TIME];
    case RewindFrequency.JUST_MORNINGS:
      return [MORNING_REWIND_TIME];
    case RewindFrequency.JUST_EVENINGS:
      return [EVENING_REWIND_TIME];
    case RewindFrequency.CUSTOM:
      return (input.times ?? [])
        .map(normalizeRewindTime)
        .filter((time): time is string => Boolean(time))
        .sort();
  }
}

export function validateRewindRoutineInput(
  input: RewindRoutineInput,
): { customIntent: string | null; times: string[] } {
  if (!isValidRewindTimezone(input.timezone)) {
    throw new Error("A valid IANA timezone is required");
  }

  const times = getRoutineTimes(input);
  if (input.frequency === RewindFrequency.CUSTOM) {
    if (times.length !== 2 || new Set(times).size !== 2) {
      throw new Error("Custom Rewind needs two different times");
    }

    const first = getTimeMinutes(times[0]);
    const second = getTimeMinutes(times[1]);
    const forwardGap = second - first;
    const overnightGap = 24 * 60 - forwardGap;
    if (
      forwardGap < REWIND_MINIMUM_GAP_MINUTES ||
      overnightGap < REWIND_MINIMUM_GAP_MINUTES
    ) {
      throw new Error(
        "Custom Rewinds must be at least eight hours apart in both directions",
      );
    }
  }

  const customIntent = input.customIntent?.trim() ?? "";
  if (input.intent === RewindIntent.CUSTOM) {
    if (!customIntent || customIntent.length > 240) {
      throw new Error("Custom Rewind intention must be between 1 and 240 characters");
    }
  }

  return {
    customIntent: input.intent === RewindIntent.CUSTOM ? customIntent : null,
    times,
  };
}

function toLocalDayKey(value: DateTime): string {
  return value.toFormat("yyyy-LL-dd");
}

function buildOccurrenceStart(params: {
  localDay: DateTime;
  time: string;
  timezone: string;
}): DateTime {
  const [hour, minute] = params.time.split(":").map(Number);
  return DateTime.fromObject(
    {
      day: params.localDay.day,
      hour,
      minute,
      month: params.localDay.month,
      year: params.localDay.year,
    },
    { zone: params.timezone },
  );
}

function getRoutineOccurrenceStarts(params: {
  now: Date;
  times: string[];
  timezone: string;
}): DateTime[] {
  const localNow = DateTime.fromJSDate(params.now, { zone: params.timezone });
  const starts: DateTime[] = [];

  for (const dayOffset of [0, 1]) {
    const localDay = localNow.startOf("day").plus({ days: dayOffset });
    for (const time of params.times) {
      const start = buildOccurrenceStart({
        localDay,
        time,
        timezone: params.timezone,
      });
      if (start.isValid) starts.push(start);
    }
  }

  return starts.filter((start) => start > localNow.minus({ hours: 2 }));
}

function getPersonaId(user: RewindRoutineUser): string {
  return user.rewindPersona ?? "ella";
}

export async function materializeRewindOccurrences(params: {
  now?: Date;
  user: RewindRoutineUser;
}): Promise<void> {
  const routine = await prisma.rewindRoutine.findUnique({
    where: { userId: params.user.id },
  });
  if (!routine?.enabled) return;

  const now = params.now ?? new Date();
  const timezone = normalizeRewindTimezone(params.user.timezone);
  const starts = getRoutineOccurrenceStarts({
    now,
    times: routine.times,
    timezone,
  });

  await Promise.all(
    starts.map(async (start) => {
      const scheduledFor = start.toUTC().toJSDate();
      const windowEndsAt = start
        .plus({ minutes: REWIND_WINDOW_MINUTES })
        .toUTC()
        .toJSDate();
      await prisma.rewindSession.upsert({
        where: {
          userId_scheduledFor: {
            scheduledFor,
            userId: params.user.id,
          },
        },
        update: {},
        create: {
          id: `rewind_${scheduledFor.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
          userId: params.user.id,
          personaId: getPersonaId(params.user),
          sessionDateKey: toLocalDayKey(start),
          timezone,
          scheduledFor,
          windowEndsAt,
          status: RewindSessionStatus.SCHEDULED,
          summary: "This scheduled Rewind has not started yet.",
        },
      });
    }),
  );
}

export async function getRewindRoutineOverview(params: {
  now?: Date;
  userId: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, rewindPersona: true, timezone: true },
  });
  if (!user) return null;

  await materializeRewindOccurrences({ now: params.now, user });
  const now = params.now ?? new Date();
  const [routine, currentSession, nextSession] = await Promise.all([
    prisma.rewindRoutine.findUnique({ where: { userId: params.userId } }),
    prisma.rewindSession.findFirst({
      where: {
        userId: params.userId,
        scheduledFor: { lte: now },
        windowEndsAt: { gt: now },
        status: { in: [RewindSessionStatus.SCHEDULED, RewindSessionStatus.IN_PROGRESS] },
      },
      orderBy: { scheduledFor: "asc" },
    }),
    prisma.rewindSession.findFirst({
      where: {
        userId: params.userId,
        scheduledFor: { gt: now },
        status: RewindSessionStatus.SCHEDULED,
      },
      orderBy: { scheduledFor: "asc" },
    }),
  ]);

  return {
    currentSession,
    nextSession,
    routine,
    timezone: normalizeRewindTimezone(user.timezone),
  };
}

export async function saveRewindRoutine(params: {
  input: RewindRoutineInput;
  userId: string;
}) {
  const normalizedTimezone = normalizeRewindTimezone(params.input.timezone);
  if (normalizedTimezone !== params.input.timezone.trim()) {
    throw new Error("A valid IANA timezone is required");
  }

  const validated = validateRewindRoutineInput({
    ...params.input,
    timezone: normalizedTimezone,
  });
  const now = new Date();
  const [user, routine] = await prisma.$transaction(async (transaction) => {
    const updatedUser = await transaction.user.update({
      where: { id: params.userId },
      data: { timezone: normalizedTimezone },
      select: { id: true, rewindPersona: true, timezone: true },
    });
    await transaction.rewindSession.deleteMany({
      where: {
        userId: params.userId,
        scheduledFor: { gt: now },
        status: RewindSessionStatus.SCHEDULED,
      },
    });
    const savedRoutine = await transaction.rewindRoutine.upsert({
      where: { userId: params.userId },
      update: {
        customIntent: validated.customIntent,
        frequency: params.input.frequency,
        intent: params.input.intent,
        times: validated.times,
      },
      create: {
        userId: params.userId,
        customIntent: validated.customIntent,
        frequency: params.input.frequency,
        intent: params.input.intent,
        times: validated.times,
      },
    });
    return [updatedUser, savedRoutine] as const;
  });

  await materializeRewindOccurrences({ now, user });
  return routine;
}
