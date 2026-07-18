import {
  RewindCompletionSource,
  RewindFrequency,
  RewindIntent,
  RewindSessionStatus,
} from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../config/db.config";
import { notificationService } from "./notification.service";
import { finalizeRewindSession } from "./rewind-session-finalization.service";

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

export class RewindRoutineAvailabilityError extends Error {
  constructor(
    public readonly reason:
      | "expired"
      | "no_active_occurrence"
      | "not_configured"
      | "not_resumable",
  ) {
    super(reason);
    this.name = "RewindRoutineAvailabilityError";
  }
}

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

export function getRewindIntentLabel(params: {
  customIntent: string | null;
  intent: RewindIntent;
}): string {
  switch (params.intent) {
    case RewindIntent.UNDERSTAND_EMOTIONS:
      return "Understand my emotions";
    case RewindIntent.SPOT_PATTERNS:
      return "Spot patterns in my days";
    case RewindIntent.BUILD_SMALL_CHANGES:
      return "Turn reflection into small changes";
    case RewindIntent.CUSTOM:
      return params.customIntent?.trim() || "Reflect with intention";
  }
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

export function getRoutineOccurrenceStarts(params: {
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
  const [routine, currentSession, nextSession, latestSession] = await Promise.all([
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
    prisma.rewindSession.findFirst({
      where: {
        userId: params.userId,
        scheduledFor: { lte: now },
        status: {
          in: [
            RewindSessionStatus.COMPLETED,
            RewindSessionStatus.MISSED,
          ],
        },
      },
      orderBy: { scheduledFor: "desc" },
    }),
  ]);

  return {
    currentSession,
    latestSession,
    nextSession,
    routine,
    timezone: normalizeRewindTimezone(user.timezone),
  };
}

export async function startOrResumeRewindOccurrence(params: {
  now?: Date;
  requestedSessionId?: string;
  userId: string;
}) {
  const now = params.now ?? new Date();
  const overview = await getRewindRoutineOverview({
    now,
    userId: params.userId,
  });
  if (!overview?.routine) {
    throw new RewindRoutineAvailabilityError("not_configured");
  }

  const occurrence = params.requestedSessionId
    ? await prisma.rewindSession.findFirst({
        where: { id: params.requestedSessionId, userId: params.userId },
      })
    : overview.currentSession;

  if (!occurrence) {
    throw new RewindRoutineAvailabilityError("no_active_occurrence");
  }
  if (
    !occurrence.scheduledFor ||
    !occurrence.windowEndsAt ||
    occurrence.scheduledFor > now ||
    occurrence.windowEndsAt <= now
  ) {
    if (
      occurrence.status === RewindSessionStatus.SCHEDULED ||
      occurrence.status === RewindSessionStatus.IN_PROGRESS
    ) {
      await prisma.rewindSession.updateMany({
        where: {
          id: occurrence.id,
          status: {
            in: [
              RewindSessionStatus.SCHEDULED,
              RewindSessionStatus.IN_PROGRESS,
            ],
          },
        },
        data: { status: RewindSessionStatus.MISSED },
      });
    }
    throw new RewindRoutineAvailabilityError("expired");
  }

  if (occurrence.status === RewindSessionStatus.SCHEDULED) {
    const started = await prisma.rewindSession.updateMany({
      where: { id: occurrence.id, status: RewindSessionStatus.SCHEDULED },
      data: { startedAt: now, status: RewindSessionStatus.IN_PROGRESS },
    });
    if (!started.count) {
      return startOrResumeRewindOccurrence({
        ...params,
        requestedSessionId: occurrence.id,
      });
    }
  } else if (occurrence.status !== RewindSessionStatus.IN_PROGRESS) {
    throw new RewindRoutineAvailabilityError("not_resumable");
  }

  const activeOccurrence = await prisma.rewindSession.findUnique({
    where: { id: occurrence.id },
  });
  if (!activeOccurrence) {
    throw new RewindRoutineAvailabilityError("no_active_occurrence");
  }

  return {
    occurrence: activeOccurrence,
    routine: overview.routine,
    timezone: overview.timezone,
  };
}

async function scheduleRewindStartNotifications(now: Date): Promise<number> {
  const minuteStart = new Date(now);
  minuteStart.setSeconds(0, 0);
  const fiveMinutesFromNow = new Date(
    minuteStart.getTime() + 5 * 60 * 1000,
  );
  const upperBound = new Date(fiveMinutesFromNow.getTime() + 60 * 1000);
  const occurrences = await prisma.rewindSession.findMany({
    where: {
      scheduledFor: { gte: fiveMinutesFromNow, lt: upperBound },
      status: RewindSessionStatus.SCHEDULED,
    },
    select: { id: true, userId: true },
    take: 500,
  });

  const scheduled = await Promise.all(
    occurrences.map((occurrence) =>
      notificationService.createNotification({
        userId: occurrence.userId,
        type: "system",
        title: "Your Rewind starts soon",
        message: "Your next reflection starts in five minutes.",
        data: {
          rewindSessionId: occurrence.id,
          route: "/app/rewind",
          type: "rewind_starts_soon",
        },
        dedupeKey: `rewind_starts_soon:${occurrence.id}`,
      }),
    ),
  );
  return scheduled.filter(Boolean).length;
}

async function scheduleLateRewindReminders(now: Date): Promise<number> {
  const lateBy = new Date(now.getTime() - 30 * 60 * 1000);
  const occurrences = await prisma.rewindSession.findMany({
    where: {
      scheduledFor: { lte: lateBy },
      status: RewindSessionStatus.SCHEDULED,
      windowEndsAt: { gt: now },
    },
    select: { id: true, userId: true },
    take: 500,
  });

  const scheduled = await Promise.all(
    occurrences.map((occurrence) =>
      notificationService.createNotification({
        userId: occurrence.userId,
        type: "system",
        title: "Your Rewind is waiting",
        message: "There is still time to reflect before this session closes.",
        data: {
          rewindSessionId: occurrence.id,
          route: "/app/rewind",
          type: "rewind_late_reminder",
        },
        dedupeKey: `rewind_late_reminder:${occurrence.id}`,
      }),
    ),
  );
  return scheduled.filter(Boolean).length;
}

/** Runs in bounded batches each minute; all occurrence times are UTC instants
 * derived from each user's persisted local timezone. */
export async function runRewindRoutineLifecycle(params?: { now?: Date }) {
  const now = params?.now ?? new Date();
  let cursor: string | undefined;
  let materializedUsers = 0;

  do {
    const users = await prisma.user.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      select: { id: true, rewindPersona: true, timezone: true },
      take: 100,
      where: { rewindRoutine: { is: { enabled: true } } },
    });
    if (!users.length) break;

    await Promise.all(
      users.map((user) => materializeRewindOccurrences({ now, user })),
    );
    materializedUsers += users.length;
    cursor = users[users.length - 1]?.id;
    if (users.length < 100) break;
  } while (cursor);

  const [startNotificationCount, reminderNotificationCount, expired] =
    await Promise.all([
      scheduleRewindStartNotifications(now),
      scheduleLateRewindReminders(now),
      prisma.rewindSession.findMany({
        where: {
          status: {
            in: [
              RewindSessionStatus.SCHEDULED,
              RewindSessionStatus.IN_PROGRESS,
            ],
          },
          windowEndsAt: { lte: now },
        },
        select: { id: true, status: true },
        take: 500,
      }),
    ]);

  let missedCount = 0;
  let finalizedCount = 0;
  for (const occurrence of expired) {
    if (occurrence.status === RewindSessionStatus.SCHEDULED) {
      const result = await prisma.rewindSession.updateMany({
        where: { id: occurrence.id, status: RewindSessionStatus.SCHEDULED },
        data: { status: RewindSessionStatus.MISSED },
      });
      missedCount += result.count;
      continue;
    }

    const result = await finalizeRewindSession({
      sessionId: occurrence.id,
      source: RewindCompletionSource.AUTO_TIMEOUT,
    });
    if (result.status === "completed") finalizedCount += 1;
    if (result.status === "missed") missedCount += 1;
  }

  return {
    finalizedCount,
    materializedUsers,
    missedCount,
    reminderNotificationCount,
    startNotificationCount,
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

/** Refreshes only upcoming, unstarted slots after the user changes partner or timezone. */
export async function refreshFutureRewindOccurrences(params: {
  now?: Date;
  userId: string;
}): Promise<void> {
  const now = params.now ?? new Date();
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { id: true, rewindPersona: true, timezone: true },
  });
  if (!user) return;

  await prisma.rewindSession.deleteMany({
    where: {
      userId: params.userId,
      scheduledFor: { gt: now },
      status: RewindSessionStatus.SCHEDULED,
    },
  });
  await materializeRewindOccurrences({ now, user });
}
