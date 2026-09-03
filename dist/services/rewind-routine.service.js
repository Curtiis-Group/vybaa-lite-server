"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewindRoutineAvailabilityError = exports.REWIND_MINIMUM_GAP_MINUTES = exports.REWIND_WINDOW_MINUTES = exports.EVENING_REWIND_TIME = exports.MORNING_REWIND_TIME = exports.DEFAULT_REWIND_TIMEZONE = void 0;
exports.isValidRewindTimezone = isValidRewindTimezone;
exports.normalizeRewindTimezone = normalizeRewindTimezone;
exports.normalizeRewindTime = normalizeRewindTime;
exports.getRoutineTimes = getRoutineTimes;
exports.validateRewindRoutineInput = validateRewindRoutineInput;
exports.getRewindIntentLabel = getRewindIntentLabel;
exports.getRoutineOccurrenceStarts = getRoutineOccurrenceStarts;
exports.materializeRewindOccurrences = materializeRewindOccurrences;
exports.getRewindRoutineOverview = getRewindRoutineOverview;
exports.startOrResumeRewindOccurrence = startOrResumeRewindOccurrence;
exports.runRewindRoutineLifecycle = runRewindRoutineLifecycle;
exports.saveRewindRoutine = saveRewindRoutine;
exports.refreshFutureRewindOccurrences = refreshFutureRewindOccurrences;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const notification_service_1 = require("./notification.service");
const rewind_session_finalization_service_1 = require("./rewind-session-finalization.service");
const activity_signal_service_1 = require("./activity-signal.service");
exports.DEFAULT_REWIND_TIMEZONE = "UTC";
exports.MORNING_REWIND_TIME = "08:00";
exports.EVENING_REWIND_TIME = "20:00";
exports.REWIND_WINDOW_MINUTES = 60;
exports.REWIND_MINIMUM_GAP_MINUTES = 8 * 60;
class RewindRoutineAvailabilityError extends Error {
    constructor(reason) {
        super(reason);
        this.reason = reason;
        this.name = "RewindRoutineAvailabilityError";
    }
}
exports.RewindRoutineAvailabilityError = RewindRoutineAvailabilityError;
function isValidRewindTimezone(timezone) {
    return luxon_1.DateTime.now().setZone(timezone).isValid;
}
function normalizeRewindTimezone(value) {
    if (typeof value !== "string")
        return exports.DEFAULT_REWIND_TIMEZONE;
    const timezone = value.trim();
    if (!timezone || timezone.length > 64 || !isValidRewindTimezone(timezone)) {
        return exports.DEFAULT_REWIND_TIMEZONE;
    }
    return timezone;
}
function normalizeRewindTime(value) {
    if (typeof value !== "string")
        return null;
    const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match)
        return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59)
        return null;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
function getTimeMinutes(time) {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
}
function getRoutineTimes(input) {
    switch (input.frequency) {
        case client_1.RewindFrequency.MORNINGS_AND_EVENINGS:
            return [exports.MORNING_REWIND_TIME, exports.EVENING_REWIND_TIME];
        case client_1.RewindFrequency.JUST_MORNINGS:
            return [exports.MORNING_REWIND_TIME];
        case client_1.RewindFrequency.JUST_EVENINGS:
            return [exports.EVENING_REWIND_TIME];
        case client_1.RewindFrequency.CUSTOM:
            return (input.times ?? [])
                .map(normalizeRewindTime)
                .filter((time) => Boolean(time))
                .sort();
    }
}
function validateRewindRoutineInput(input) {
    if (!isValidRewindTimezone(input.timezone)) {
        throw new Error("A valid IANA timezone is required");
    }
    const times = getRoutineTimes(input);
    if (input.frequency === client_1.RewindFrequency.CUSTOM) {
        if (times.length !== 2 || new Set(times).size !== 2) {
            throw new Error("Custom Rewind needs two different times");
        }
        const first = getTimeMinutes(times[0]);
        const second = getTimeMinutes(times[1]);
        const forwardGap = second - first;
        const overnightGap = 24 * 60 - forwardGap;
        if (forwardGap < exports.REWIND_MINIMUM_GAP_MINUTES ||
            overnightGap < exports.REWIND_MINIMUM_GAP_MINUTES) {
            throw new Error("Custom Rewinds must be at least eight hours apart in both directions");
        }
    }
    const customIntent = input.customIntent?.trim() ?? "";
    if (input.intent === client_1.RewindIntent.CUSTOM) {
        if (!customIntent || customIntent.length > 240) {
            throw new Error("Custom Rewind intention must be between 1 and 240 characters");
        }
    }
    return {
        customIntent: input.intent === client_1.RewindIntent.CUSTOM ? customIntent : null,
        times,
    };
}
function toLocalDayKey(value) {
    return value.toFormat("yyyy-LL-dd");
}
function getRewindIntentLabel(params) {
    switch (params.intent) {
        case client_1.RewindIntent.UNDERSTAND_EMOTIONS:
            return "Understand my emotions";
        case client_1.RewindIntent.SPOT_PATTERNS:
            return "Spot patterns in my days";
        case client_1.RewindIntent.BUILD_SMALL_CHANGES:
            return "Turn reflection into small changes";
        case client_1.RewindIntent.CUSTOM:
            return params.customIntent?.trim() || "Reflect with intention";
    }
}
function buildOccurrenceStart(params) {
    const [hour, minute] = params.time.split(":").map(Number);
    return luxon_1.DateTime.fromObject({
        day: params.localDay.day,
        hour,
        minute,
        month: params.localDay.month,
        year: params.localDay.year,
    }, { zone: params.timezone });
}
function getRoutineOccurrenceStarts(params) {
    const localNow = luxon_1.DateTime.fromJSDate(params.now, { zone: params.timezone });
    const starts = [];
    for (const dayOffset of [0, 1]) {
        const localDay = localNow.startOf("day").plus({ days: dayOffset });
        for (const time of params.times) {
            const start = buildOccurrenceStart({
                localDay,
                time,
                timezone: params.timezone,
            });
            if (start.isValid)
                starts.push(start);
        }
    }
    return starts.filter((start) => start > localNow.minus({ hours: 2 }));
}
function getPersonaId(user) {
    return user.rewindPersona ?? "ella";
}
async function materializeRewindOccurrences(params) {
    const routine = await db_config_1.prisma.rewindRoutine.findUnique({
        where: { userId: params.user.id },
    });
    if (!routine?.enabled)
        return;
    const now = params.now ?? new Date();
    const timezone = normalizeRewindTimezone(params.user.timezone);
    const starts = getRoutineOccurrenceStarts({
        now,
        times: routine.times,
        timezone,
    });
    await Promise.all(starts.map(async (start) => {
        const scheduledFor = start.toUTC().toJSDate();
        const windowEndsAt = start
            .plus({ minutes: exports.REWIND_WINDOW_MINUTES })
            .toUTC()
            .toJSDate();
        await db_config_1.prisma.rewindSession.upsert({
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
                status: client_1.RewindSessionStatus.SCHEDULED,
                summary: "This scheduled Rewind has not started yet.",
            },
        });
    }));
}
async function getRewindRoutineOverview(params) {
    const user = await db_config_1.prisma.user.findUnique({
        where: { id: params.userId },
        select: { id: true, rewindPersona: true, timezone: true },
    });
    if (!user)
        return null;
    await materializeRewindOccurrences({ now: params.now, user });
    const now = params.now ?? new Date();
    const [routine, currentSession, nextSession, latestSession] = await Promise.all([
        db_config_1.prisma.rewindRoutine.findUnique({ where: { userId: params.userId } }),
        db_config_1.prisma.rewindSession.findFirst({
            where: {
                userId: params.userId,
                scheduledFor: { lte: now },
                windowEndsAt: { gt: now },
                status: {
                    in: [
                        client_1.RewindSessionStatus.SCHEDULED,
                        client_1.RewindSessionStatus.IN_PROGRESS,
                    ],
                },
            },
            orderBy: { scheduledFor: "asc" },
        }),
        db_config_1.prisma.rewindSession.findFirst({
            where: {
                userId: params.userId,
                scheduledFor: { gt: now },
                status: client_1.RewindSessionStatus.SCHEDULED,
            },
            orderBy: { scheduledFor: "asc" },
        }),
        db_config_1.prisma.rewindSession.findFirst({
            where: {
                userId: params.userId,
                scheduledFor: { lte: now },
                status: {
                    in: [client_1.RewindSessionStatus.COMPLETED, client_1.RewindSessionStatus.MISSED],
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
async function startOrResumeRewindOccurrence(params) {
    const now = params.now ?? new Date();
    const overview = await getRewindRoutineOverview({
        now,
        userId: params.userId,
    });
    if (!overview?.routine) {
        throw new RewindRoutineAvailabilityError("not_configured");
    }
    const occurrence = params.requestedSessionId
        ? await db_config_1.prisma.rewindSession.findFirst({
            where: { id: params.requestedSessionId, userId: params.userId },
        })
        : overview.currentSession;
    if (!occurrence) {
        throw new RewindRoutineAvailabilityError("no_active_occurrence");
    }
    if (!occurrence.scheduledFor ||
        !occurrence.windowEndsAt ||
        occurrence.scheduledFor > now ||
        occurrence.windowEndsAt <= now) {
        if (occurrence.status === client_1.RewindSessionStatus.SCHEDULED ||
            occurrence.status === client_1.RewindSessionStatus.IN_PROGRESS) {
            await db_config_1.prisma.rewindSession.updateMany({
                where: {
                    id: occurrence.id,
                    status: {
                        in: [
                            client_1.RewindSessionStatus.SCHEDULED,
                            client_1.RewindSessionStatus.IN_PROGRESS,
                        ],
                    },
                },
                data: { status: client_1.RewindSessionStatus.MISSED },
            });
        }
        throw new RewindRoutineAvailabilityError("expired");
    }
    if (occurrence.status === client_1.RewindSessionStatus.SCHEDULED) {
        const started = await db_config_1.prisma.rewindSession.updateMany({
            where: { id: occurrence.id, status: client_1.RewindSessionStatus.SCHEDULED },
            data: { startedAt: now, status: client_1.RewindSessionStatus.IN_PROGRESS },
        });
        if (!started.count) {
            return startOrResumeRewindOccurrence({
                ...params,
                requestedSessionId: occurrence.id,
            });
        }
    }
    else if (occurrence.status !== client_1.RewindSessionStatus.IN_PROGRESS) {
        throw new RewindRoutineAvailabilityError("not_resumable");
    }
    const activeOccurrence = await db_config_1.prisma.rewindSession.findUnique({
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
async function scheduleRewindStartNotifications(now) {
    const minuteStart = new Date(now);
    minuteStart.setSeconds(0, 0);
    const fiveMinutesFromNow = new Date(minuteStart.getTime() + 5 * 60 * 1000);
    const upperBound = new Date(fiveMinutesFromNow.getTime() + 60 * 1000);
    const occurrences = await db_config_1.prisma.rewindSession.findMany({
        where: {
            scheduledFor: { gte: fiveMinutesFromNow, lt: upperBound },
            status: client_1.RewindSessionStatus.SCHEDULED,
        },
        select: { id: true, userId: true },
        take: 500,
    });
    const scheduled = await Promise.all(occurrences.map((occurrence) => notification_service_1.notificationService.createNotification({
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
    })));
    return scheduled.filter(Boolean).length;
}
async function scheduleLateRewindReminders(now) {
    const lateBy = new Date(now.getTime() - 30 * 60 * 1000);
    const occurrences = await db_config_1.prisma.rewindSession.findMany({
        where: {
            scheduledFor: { lte: lateBy },
            status: client_1.RewindSessionStatus.SCHEDULED,
            windowEndsAt: { gt: now },
        },
        select: { id: true, userId: true },
        take: 500,
    });
    const scheduled = await Promise.all(occurrences.map((occurrence) => notification_service_1.notificationService.createNotification({
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
    })));
    return scheduled.filter(Boolean).length;
}
/** Runs in bounded batches each minute; all occurrence times are UTC instants
 * derived from each user's persisted local timezone. */
async function runRewindRoutineLifecycle(params) {
    const now = params?.now ?? new Date();
    let cursor;
    let materializedUsers = 0;
    do {
        const users = await db_config_1.prisma.user.findMany({
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            orderBy: { id: "asc" },
            select: { id: true, rewindPersona: true, timezone: true },
            take: 100,
            where: { rewindRoutine: { is: { enabled: true } } },
        });
        if (!users.length)
            break;
        await Promise.all(users.map((user) => materializeRewindOccurrences({ now, user })));
        materializedUsers += users.length;
        cursor = users[users.length - 1]?.id;
        if (users.length < 100)
            break;
    } while (cursor);
    const [startNotificationCount, reminderNotificationCount, expired] = await Promise.all([
        scheduleRewindStartNotifications(now),
        scheduleLateRewindReminders(now),
        db_config_1.prisma.rewindSession.findMany({
            where: {
                status: {
                    in: [
                        client_1.RewindSessionStatus.SCHEDULED,
                        client_1.RewindSessionStatus.IN_PROGRESS,
                    ],
                },
                windowEndsAt: { lte: now },
            },
            select: {
                id: true,
                personaId: true,
                scheduledFor: true,
                sessionDateKey: true,
                status: true,
                timezone: true,
                userId: true,
            },
            take: 500,
        }),
    ]);
    let missedCount = 0;
    let finalizedCount = 0;
    for (const occurrence of expired) {
        if (occurrence.status === client_1.RewindSessionStatus.SCHEDULED) {
            const result = await db_config_1.prisma.rewindSession.updateMany({
                where: { id: occurrence.id, status: client_1.RewindSessionStatus.SCHEDULED },
                data: { status: client_1.RewindSessionStatus.MISSED },
            });
            missedCount += result.count;
            if (result.count) {
                await (0, activity_signal_service_1.recordActivitySignal)({
                    dedupeKey: `rewind-routine:${occurrence.id}:missed`,
                    description: `Skipped the scheduled Rewind with ${occurrence.personaId}.`,
                    eventType: "REWIND_ROUTINE_SKIPPED",
                    happenedAt: occurrence.scheduledFor ?? now,
                    localDateKey: occurrence.sessionDateKey ?? undefined,
                    personaId: occurrence.personaId,
                    sourceId: occurrence.id,
                    sourceType: client_1.ActivitySignalSourceType.REWIND_ROUTINE,
                    timezone: occurrence.timezone ?? "UTC",
                    userId: occurrence.userId,
                });
            }
            continue;
        }
        const result = await (0, rewind_session_finalization_service_1.finalizeRewindSession)({
            sessionId: occurrence.id,
            source: client_1.RewindCompletionSource.AUTO_TIMEOUT,
        });
        if (result.status === "completed")
            finalizedCount += 1;
        if (result.status === "missed")
            missedCount += 1;
    }
    return {
        finalizedCount,
        materializedUsers,
        missedCount,
        reminderNotificationCount,
        startNotificationCount,
    };
}
async function saveRewindRoutine(params) {
    const normalizedTimezone = normalizeRewindTimezone(params.input.timezone);
    if (normalizedTimezone !== params.input.timezone.trim()) {
        throw new Error("A valid IANA timezone is required");
    }
    const validated = validateRewindRoutineInput({
        ...params.input,
        timezone: normalizedTimezone,
    });
    const now = new Date();
    const [user, routine] = await db_config_1.prisma.$transaction(async (transaction) => {
        const updatedUser = await transaction.user.update({
            where: { id: params.userId },
            data: { timezone: normalizedTimezone },
            select: { id: true, rewindPersona: true, timezone: true },
        });
        await transaction.rewindSession.deleteMany({
            where: {
                userId: params.userId,
                scheduledFor: { gt: now },
                status: client_1.RewindSessionStatus.SCHEDULED,
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
        return [updatedUser, savedRoutine];
    });
    await materializeRewindOccurrences({ now, user });
    return routine;
}
/** Refreshes only upcoming, unstarted slots after the user changes partner or timezone. */
async function refreshFutureRewindOccurrences(params) {
    const now = params.now ?? new Date();
    const user = await db_config_1.prisma.user.findUnique({
        where: { id: params.userId },
        select: { id: true, rewindPersona: true, timezone: true },
    });
    if (!user)
        return;
    await db_config_1.prisma.rewindSession.deleteMany({
        where: {
            userId: params.userId,
            scheduledFor: { gt: now },
            status: client_1.RewindSessionStatus.SCHEDULED,
        },
    });
    await materializeRewindOccurrences({ now, user });
}
