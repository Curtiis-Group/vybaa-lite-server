"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalV2ServiceError = void 0;
exports.createGoalV2 = createGoalV2;
exports.listGoalsV2 = listGoalsV2;
exports.getGoalV2 = getGoalV2;
exports.listGoalOccurrences = listGoalOccurrences;
exports.recordGoalProgress = recordGoalProgress;
exports.updateGoalProgress = updateGoalProgress;
exports.deleteGoalProgress = deleteGoalProgress;
exports.updateGoalV2 = updateGoalV2;
exports.rescheduleGoalOccurrence = rescheduleGoalOccurrence;
exports.pauseGoalV2 = pauseGoalV2;
exports.resumeGoalV2 = resumeGoalV2;
exports.abandonGoalV2 = abandonGoalV2;
exports.archiveGoalV2 = archiveGoalV2;
exports.permanentlyDeleteGoalV2 = permanentlyDeleteGoalV2;
exports.reopenGoalV2 = reopenGoalV2;
exports.updateGoalConclusionReview = updateGoalConclusionReview;
exports.processGoalV2Lifecycle = processGoalV2Lifecycle;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const goal_v2_config_1 = require("../config/goal-v2.config");
const db_config_1 = require("../config/db.config");
const goal_v2_schedule_util_1 = require("../utils/goal-v2-schedule.util");
const activity_signal_service_1 = require("./activity-signal.service");
const goalDetailsInclude = client_1.Prisma.validator()({
    conclusion: true,
    occurrences: {
        include: { progress: true },
        orderBy: { dueDate: "asc" },
    },
    rewardPlan: {
        include: {
            awards: true,
            milestones: { orderBy: { order: "asc" } },
        },
    },
});
class GoalV2ServiceError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = "GoalV2ServiceError";
        this.code = code;
        this.status = status;
    }
}
exports.GoalV2ServiceError = GoalV2ServiceError;
function parseDateKey(date) {
    return date.toISOString().slice(0, 10);
}
function resolveMissPolicy(input) {
    const defaults = {
        FLEXIBLE: {
            breakStreakOnMiss: true,
            forfeitPendingOnMiss: false,
            graceHours: 24,
            maxConsecutiveMisses: null,
            mode: client_1.GoalMissMode.FLEXIBLE,
        },
        NO_STREAK: {
            breakStreakOnMiss: false,
            forfeitPendingOnMiss: false,
            graceHours: 0,
            maxConsecutiveMisses: null,
            mode: client_1.GoalMissMode.NO_STREAK,
        },
        STRICT: {
            breakStreakOnMiss: true,
            forfeitPendingOnMiss: true,
            graceHours: 0,
            maxConsecutiveMisses: null,
            mode: client_1.GoalMissMode.STRICT,
        },
    };
    const selected = defaults[input.mode];
    return {
        breakStreakOnMiss: input.breakStreakOnMiss ?? selected.breakStreakOnMiss,
        forfeitPendingOnMiss: input.forfeitPendingOnMiss ?? selected.forfeitPendingOnMiss,
        graceHours: input.graceHours ?? selected.graceHours,
        maxConsecutiveMisses: input.maxConsecutiveMisses ?? selected.maxConsecutiveMisses,
        mode: selected.mode,
    };
}
function toPrismaScheduleType(type) {
    return type === "SELECTED_WEEKDAYS"
        ? client_1.GoalScheduleType.SELECTED_WEEKDAYS
        : client_1.GoalScheduleType[type];
}
function getScheduleWeekdays(schedule) {
    if (schedule.type === "WEEKLY")
        return [schedule.weekday];
    if (schedule.type === "SELECTED_WEEKDAYS") {
        return [...new Set(schedule.weekdays)].sort((left, right) => left - right);
    }
    return [];
}
function getTargetValue(input, occurrenceCount) {
    if (input.target.type === "CHECK_IN_COUNT")
        return input.target.count;
    if (input.target.type === "QUANTITY")
        return input.target.amount;
    return occurrenceCount;
}
function normalizeRewardMilestones(milestones) {
    const byPercentage = new Map();
    for (const milestone of milestones) {
        const percentage = Math.min(100, Math.max(1, Math.round(milestone.triggerPercentage)));
        const current = byPercentage.get(percentage);
        byPercentage.set(percentage, {
            name: current ? `${current.name} + ${milestone.name}` : milestone.name,
            points: (current?.points ?? 0) + Math.max(0, milestone.points),
            triggerPercentage: percentage,
        });
    }
    const normalized = [...byPercentage.values()].sort((left, right) => left.triggerPercentage - right.triggerPercentage);
    let total = 0;
    for (const milestone of normalized)
        total += milestone.points;
    if (total <= goal_v2_config_1.GOAL_REWARD_CAP || total === 0)
        return normalized;
    const scale = goal_v2_config_1.GOAL_REWARD_CAP / total;
    return normalized.map((milestone) => ({
        ...milestone,
        points: Math.round(milestone.points * scale * 100) / 100,
    }));
}
function getProgressPercentage(goal) {
    const targetValue = goal.targetValue ?? 0;
    if (targetValue <= 0)
        return 0;
    const progress = goal.targetType === client_1.GoalTargetType.QUANTITY
        ? goal.progressValue
        : goal.completedOccurrences;
    return Math.min((progress / targetValue) * 100, 100);
}
function getRewardTotals(goal) {
    const totals = {
        earned: 0,
        forfeited: 0,
        pending: 0,
        released: 0,
    };
    for (const award of goal.rewardPlan?.awards ?? []) {
        totals.earned += award.points;
        if (award.status === client_1.GoalRewardAwardStatus.FORFEITED) {
            totals.forfeited += award.points;
        }
        else if (award.status === client_1.GoalRewardAwardStatus.PENDING) {
            totals.pending += award.points;
        }
        else {
            totals.released += award.points;
        }
    }
    return totals;
}
function serializeGoal(goal, timezone) {
    const now = new Date();
    const localToday = (0, goal_v2_schedule_util_1.getLocalDateKey)(now, timezone);
    const nextOccurrence = goal.occurrences.find((occurrence) => (occurrence.status === client_1.GoalOccurrenceStatus.GRACE ||
        occurrence.status === client_1.GoalOccurrenceStatus.PENDING) &&
        parseDateKey(occurrence.dueDate) >= localToday);
    const dueOccurrence = goal.occurrences.find((occurrence) => (occurrence.status === client_1.GoalOccurrenceStatus.GRACE ||
        occurrence.status === client_1.GoalOccurrenceStatus.PENDING) &&
        parseDateKey(occurrence.dueDate) <= localToday);
    const rewardTotals = getRewardTotals(goal);
    return {
        abandonedAt: goal.abandonedAt?.toISOString() ?? null,
        archivedAt: goal.archivedAt?.toISOString() ?? null,
        communityId: goal.communityId,
        completedAt: goal.completedAt?.toISOString() ?? null,
        conclusion: goal.conclusion
            ? {
                ...goal.conclusion,
                attachments: goal.conclusion.attachments ?? [],
                createdAt: goal.conclusion.createdAt.toISOString(),
                endedAt: goal.conclusion.endedAt.toISOString(),
                reviewUpdatedAt: goal.conclusion.reviewUpdatedAt?.toISOString() ?? null,
            }
            : null,
        createdAt: goal.createdAt.toISOString(),
        description: goal.description,
        hardStopDate: parseDateKey(goal.hardStopDate),
        id: goal.id,
        isDue: Boolean(dueOccurrence),
        isOverdue: Boolean(dueOccurrence && dueOccurrence.closesAt < now),
        missPolicy: {
            breakStreakOnMiss: goal.breakStreakOnMiss,
            forfeitPendingOnMiss: goal.forfeitPendingOnMiss,
            graceHours: goal.graceHours,
            maxConsecutiveMisses: goal.maxConsecutiveMisses,
            mode: goal.missMode,
        },
        nextOccurrence: nextOccurrence
            ? {
                closesAt: nextOccurrence.closesAt.toISOString(),
                dueDate: parseDateKey(nextOccurrence.dueDate),
                id: nextOccurrence.id,
                status: nextOccurrence.status,
            }
            : null,
        pausedAt: goal.pausedAt?.toISOString() ?? null,
        progress: {
            adherenceRate: goal.completedOccurrences + goal.missedOccurrences > 0
                ? (goal.completedOccurrences /
                    (goal.completedOccurrences + goal.missedOccurrences)) *
                    100
                : 100,
            completedOccurrences: goal.completedOccurrences,
            currentStreak: goal.currentStreak,
            longestStreak: goal.longestStreak,
            missedOccurrences: goal.missedOccurrences,
            percentage: getProgressPercentage(goal),
            value: goal.progressValue,
        },
        reminders: goal.reminderTimes,
        reward: {
            eligible: goal.rewardPlan?.eligible ?? false,
            eligibleAt: goal.rewardPlan?.eligibleAt?.toISOString() ?? null,
            earnedPoints: rewardTotals.earned,
            forfeitedPoints: rewardTotals.forfeited,
            milestones: goal.rewardPlan?.milestones.map((milestone) => ({
                id: milestone.id,
                name: milestone.name,
                points: milestone.points,
                status: goal.rewardPlan?.awards.find((award) => award.milestoneId === milestone.id)?.status ?? "LOCKED",
                triggerPercentage: milestone.triggerPercentage,
            })) ?? [],
            pendingPoints: rewardTotals.pending,
            releasePolicy: goal.rewardReleasePolicy,
            releasedPoints: rewardTotals.released,
            totalPotential: goal.rewardPlan?.totalPotential ?? 0,
        },
        schedule: {
            endDate: goal.endDate ? parseDateKey(goal.endDate) : null,
            startDate: parseDateKey(goal.startDate),
            type: goal.scheduleType,
            weekdays: goal.weekdays,
        },
        startedAt: goal.startedAt.toISOString(),
        status: goal.status,
        target: goal.targetType === client_1.GoalTargetType.QUANTITY
            ? {
                amount: goal.targetValue ?? 0,
                type: goal.targetType,
                unit: goal.unit,
            }
            : goal.targetType === client_1.GoalTargetType.UNTIL_DATE
                ? {
                    endDate: goal.endDate ? parseDateKey(goal.endDate) : null,
                    type: goal.targetType,
                }
                : { count: goal.targetValue ?? 0, type: goal.targetType },
        templateId: goal.templateId,
        title: goal.title,
        updatedAt: goal.updatedAt.toISOString(),
    };
}
function encodeCursor(goal) {
    return Buffer.from(JSON.stringify({ createdAt: goal.createdAt.toISOString(), id: goal.id })).toString("base64url");
}
function decodeCursor(cursor) {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!parsed || typeof parsed !== "object")
            throw new Error("Invalid cursor");
        if (!("createdAt" in parsed) || !("id" in parsed)) {
            throw new Error("Invalid cursor");
        }
        const createdAt = new Date(String(parsed.createdAt));
        const id = String(parsed.id);
        if (!id || Number.isNaN(createdAt.getTime()))
            throw new Error("Invalid cursor");
        return { createdAt, id };
    }
    catch {
        throw new GoalV2ServiceError("INVALID_CURSOR", "Invalid goal cursor");
    }
}
function encodeOccurrenceCursor(occurrence) {
    return Buffer.from(JSON.stringify({
        dueDate: occurrence.dueDate.toISOString(),
        id: occurrence.id,
    })).toString("base64url");
}
function decodeOccurrenceCursor(cursor) {
    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!parsed ||
            typeof parsed !== "object" ||
            !("dueDate" in parsed) ||
            !("id" in parsed)) {
            throw new Error("Invalid cursor");
        }
        const dueDate = new Date(String(parsed.dueDate));
        const id = String(parsed.id);
        if (!id || Number.isNaN(dueDate.getTime()))
            throw new Error("Invalid cursor");
        return { dueDate, id };
    }
    catch {
        throw new GoalV2ServiceError("INVALID_CURSOR", "Invalid occurrence cursor");
    }
}
function getListWhere(options) {
    const base = {
        archivedAt: options.filter === "ARCHIVED" ? { not: null } : null,
        userId: options.userId,
    };
    if (options.filter === "PAUSED")
        return { ...base, status: client_1.GoalV2Status.PAUSED };
    if (options.filter === "ENDED" || options.filter === "ARCHIVED") {
        return {
            ...base,
            status: {
                in: [
                    client_1.GoalV2Status.ABANDONED,
                    client_1.GoalV2Status.AUTO_ABANDONED,
                    client_1.GoalV2Status.COMPLETED,
                ],
            },
        };
    }
    if (options.filter === "DUE" || options.filter === "OVERDUE") {
        const now = new Date();
        return {
            ...base,
            occurrences: {
                some: {
                    closesAt: options.filter === "OVERDUE" ? { lt: now } : { gte: now },
                    dueDate: { lte: now },
                    status: {
                        in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
                    },
                },
            },
            status: client_1.GoalV2Status.ACTIVE,
        };
    }
    return { ...base, status: client_1.GoalV2Status.ACTIVE };
}
async function getOwnedGoal(client, goalId, userId) {
    const goal = await client.goalV2.findFirst({
        include: goalDetailsInclude,
        where: { id: goalId, userId },
    });
    if (!goal)
        throw new GoalV2ServiceError("GOAL_NOT_FOUND", "Goal not found", 404);
    return goal;
}
async function forfeitPendingRewards(client, goalId, now) {
    const pending = await client.goalRewardAward.findMany({
        where: { goalId, status: client_1.GoalRewardAwardStatus.PENDING },
    });
    if (!pending.length)
        return 0;
    const transactionIds = pending
        .map((award) => award.transactionId)
        .filter((id) => Boolean(id));
    await client.goalRewardAward.updateMany({
        data: { forfeitedAt: now, status: client_1.GoalRewardAwardStatus.FORFEITED },
        where: { id: { in: pending.map((award) => award.id) } },
    });
    if (transactionIds.length) {
        await client.transaction.updateMany({
            data: { status: "FAILED" },
            where: { id: { in: transactionIds }, status: "PENDING" },
        });
    }
    let total = 0;
    for (const award of pending)
        total += award.points;
    return total;
}
async function releasePendingRewards(client, goalId, userId, now) {
    const pending = await client.goalRewardAward.findMany({
        where: { goalId, status: client_1.GoalRewardAwardStatus.PENDING },
    });
    if (!pending.length)
        return 0;
    let total = 0;
    for (const award of pending)
        total += award.points;
    await client.goalRewardAward.updateMany({
        data: { releasedAt: now, status: client_1.GoalRewardAwardStatus.RELEASED },
        where: { id: { in: pending.map((award) => award.id) } },
    });
    await client.transaction.updateMany({
        data: { status: "COMPLETED" },
        where: {
            id: {
                in: pending
                    .map((award) => award.transactionId)
                    .filter((id) => Boolean(id)),
            },
            status: "PENDING",
        },
    });
    await client.user.update({
        data: { points: { increment: total } },
        where: { id: userId },
    });
    return total;
}
async function awardCrossedMilestones(client, goal, progressPercentage, now) {
    const plan = goal.rewardPlan;
    if (!plan?.eligible || !plan.eligibleAt || now < plan.eligibleAt)
        return;
    if (goal.completedOccurrences < goal_v2_config_1.GOAL_REWARD_MINIMUM_OCCURRENCES)
        return;
    const awardedIds = new Set(plan.awards.map((award) => award.milestoneId));
    const crossed = plan.milestones.filter((milestone) => milestone.triggerPercentage <= progressPercentage &&
        !awardedIds.has(milestone.id));
    for (const milestone of crossed) {
        const dedupeKey = `goal-v2:${goal.id}:milestone:${milestone.id}`;
        const releaseImmediately = plan.releasePolicy === client_1.GoalRewardReleasePolicy.IMMEDIATE;
        const transaction = await client.transaction.upsert({
            create: {
                amount: milestone.points,
                dedupeKey,
                metadata: JSON.stringify({
                    goalId: goal.id,
                    milestoneName: milestone.name,
                    milestonePercentage: milestone.triggerPercentage,
                    source: "goal_v2",
                    state: releaseImmediately ? "released" : "pending",
                }),
                recipientId: goal.userId,
                referenceId: goal.id,
                status: releaseImmediately ? "COMPLETED" : "PENDING",
                type: client_1.TransactionType.REWARD_POINTS,
            },
            update: {},
            where: { dedupeKey },
        });
        await client.goalRewardAward.create({
            data: {
                dedupeKey,
                goalId: goal.id,
                milestoneId: milestone.id,
                planId: plan.id,
                points: milestone.points,
                referenceTitle: goal.title,
                releasedAt: releaseImmediately ? now : null,
                status: releaseImmediately
                    ? client_1.GoalRewardAwardStatus.RELEASED
                    : client_1.GoalRewardAwardStatus.PENDING,
                transactionId: transaction.id,
            },
        });
        if (releaseImmediately) {
            await client.user.update({
                data: { points: { increment: milestone.points } },
                where: { id: goal.userId },
            });
        }
    }
}
async function createConclusion(client, goal, outcome, now) {
    const allAwards = await client.goalRewardAward.findMany({
        where: { goalId: goal.id },
    });
    let earnedPoints = 0;
    let totalReleased = 0;
    let totalForfeited = 0;
    for (const award of allAwards) {
        earnedPoints += award.points;
        if (award.status === client_1.GoalRewardAwardStatus.RELEASED) {
            totalReleased += award.points;
        }
        if (award.status === client_1.GoalRewardAwardStatus.FORFEITED) {
            totalForfeited += award.points;
        }
    }
    const measuredProgress = goal.targetType === client_1.GoalTargetType.QUANTITY
        ? goal.progressValue
        : goal.completedOccurrences;
    const targetValue = goal.targetValue ?? 0;
    const attempted = goal.completedOccurrences + goal.missedOccurrences;
    const durationDays = Math.max(1, Math.ceil((now.getTime() - goal.startedAt.getTime()) / 86400000));
    await client.goalConclusion.create({
        data: {
            adherenceRate: attempted
                ? (goal.completedOccurrences / attempted) * 100
                : 100,
            completedOccurrences: goal.completedOccurrences,
            currentStreak: goal.currentStreak,
            durationDays,
            earnedPoints,
            endedAt: now,
            finalProgress: measuredProgress,
            forfeitedPoints: totalForfeited,
            goalId: goal.id,
            longestStreak: goal.longestStreak,
            missedOccurrences: goal.missedOccurrences,
            outcome,
            overTargetAmount: Math.max(0, measuredProgress - targetValue),
            releasedPoints: totalReleased,
            targetValue: goal.targetValue,
        },
    });
}
async function finishGoal(client, goal, outcome, now) {
    const completed = outcome === client_1.GoalV2Status.COMPLETED;
    if (completed) {
        await releasePendingRewards(client, goal.id, goal.userId, now);
    }
    else {
        await forfeitPendingRewards(client, goal.id, now);
    }
    await client.goalOccurrence.updateMany({
        data: { status: client_1.GoalOccurrenceStatus.CANCELLED },
        where: {
            goalId: goal.id,
            status: {
                in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
            },
        },
    });
    await client.notification.deleteMany({
        where: {
            goalId: goal.id,
            sentAt: null,
            type: "goal_v2_reminder",
        },
    });
    await client.goalV2.update({
        data: {
            abandonedAt: completed ? null : now,
            completedAt: completed ? now : null,
            pausedAt: null,
            status: outcome,
        },
        where: { id: goal.id },
    });
    await createConclusion(client, goal, outcome, now);
}
function hasReachedTarget(goal) {
    if (goal.targetType === client_1.GoalTargetType.QUANTITY) {
        return goal.progressValue >= (goal.targetValue ?? Number.POSITIVE_INFINITY);
    }
    if (goal.targetType === client_1.GoalTargetType.CHECK_IN_COUNT) {
        return (goal.completedOccurrences >=
            (goal.targetValue ?? Number.POSITIVE_INFINITY));
    }
    return (goal.missedOccurrences === 0 &&
        goal.completedOccurrences === goal.occurrences.length);
}
async function createGoalV2(userId, timezone, input, options = {}) {
    if (input.sourceRecommendationId) {
        const existingRecommendation = await db_config_1.prisma.rewindRecommendation.findFirst({
            include: { resultingGoal: { include: goalDetailsInclude } },
            where: {
                id: input.sourceRecommendationId,
                status: client_1.RewindRecommendationStatus.ACCEPTED,
                userId,
            },
        });
        if (existingRecommendation?.resultingGoal) {
            return serializeGoal(existingRecommendation.resultingGoal, timezone);
        }
    }
    const targetEndDate = input.target.type === "UNTIL_DATE" ? input.target.endDate : undefined;
    const startDateKey = (0, goal_v2_schedule_util_1.getScheduleStartDate)(input.schedule);
    if ((input.hardStopDate && input.hardStopDate < startDateKey) ||
        (targetEndDate && targetEndDate < startDateKey)) {
        throw new GoalV2ServiceError("INVALID_GOAL_DATE_RANGE", "The goal end date must be on or after its schedule start date");
    }
    let hardStopDate;
    try {
        hardStopDate = (0, goal_v2_schedule_util_1.resolveGoalHardStopDate)({
            hardStopDate: input.hardStopDate,
            schedule: input.schedule,
            targetEndDate,
            timezone,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Invalid goal dates";
        throw new GoalV2ServiceError(message.includes("365 days")
            ? "GOAL_HORIZON_EXCEEDED"
            : "INVALID_GOAL_DATE_RANGE", message);
    }
    let windows;
    try {
        windows = (0, goal_v2_schedule_util_1.generateGoalOccurrenceWindows)({
            hardStopDate,
            schedule: input.schedule,
            timezone,
        });
    }
    catch (error) {
        throw new GoalV2ServiceError("INVALID_GOAL_SCHEDULE", error instanceof Error
            ? error.message
            : "The schedule produces no occurrences");
    }
    if (input.target.type === "CHECK_IN_COUNT" &&
        input.target.count > windows.length) {
        throw new GoalV2ServiceError("TARGET_EXCEEDS_HORIZON", "The selected schedule cannot provide enough occurrences before the goal ends");
    }
    if (input.target.type === "UNTIL_DATE" &&
        input.schedule.type === "ONE_TIME") {
        throw new GoalV2ServiceError("INVALID_TARGET_SCHEDULE", "Date-based adherence goals require a recurring schedule");
    }
    const startDate = luxon_1.DateTime.fromISO(startDateKey, { zone: "UTC" }).toJSDate();
    const endDate = luxon_1.DateTime.fromISO(hardStopDate, { zone: "UTC" }).toJSDate();
    const elapsedDays = luxon_1.DateTime.fromISO(hardStopDate).diff(luxon_1.DateTime.fromISO(startDateKey), "days")
        .days + 1;
    const rewardEligible = windows.length >= goal_v2_config_1.GOAL_REWARD_MINIMUM_OCCURRENCES &&
        elapsedDays >= goal_v2_config_1.GOAL_REWARD_MINIMUM_DAYS &&
        input.schedule.type !== "ONE_TIME";
    const missPolicy = resolveMissPolicy(input.missPolicy);
    const targetValue = getTargetValue(input, windows.length);
    const rewardMilestones = normalizeRewardMilestones(options.rewardMilestones ?? [...goal_v2_config_1.STANDARD_GOAL_REWARD_MILESTONES]);
    let totalPotential = 0;
    for (const milestone of rewardMilestones)
        totalPotential += milestone.points;
    const created = await db_config_1.prisma.$transaction(async (transaction) => {
        if (input.sourceRecommendationId) {
            const claim = await transaction.rewindRecommendation.updateMany({
                data: {
                    acceptedAt: new Date(),
                    status: client_1.RewindRecommendationStatus.ACCEPTED,
                },
                where: {
                    id: input.sourceRecommendationId,
                    status: client_1.RewindRecommendationStatus.PENDING,
                    type: client_1.RewindRecommendationType.NEW_GOAL,
                    userId,
                },
            });
            if (!claim.count) {
                throw new GoalV2ServiceError("REWIND_RECOMMENDATION_UNAVAILABLE", "This Rewind goal suggestion is no longer available", 409);
            }
        }
        const goal = await transaction.goalV2.create({
            data: {
                breakStreakOnMiss: missPolicy.breakStreakOnMiss,
                communityId: input.communityId,
                description: input.description,
                endDate,
                forfeitPendingOnMiss: missPolicy.forfeitPendingOnMiss,
                graceHours: missPolicy.graceHours,
                hardStopDate: endDate,
                maxConsecutiveMisses: missPolicy.maxConsecutiveMisses,
                missMode: missPolicy.mode,
                occurrences: {
                    create: windows.map((window) => ({
                        closesAt: window.closesAt,
                        dueDate: window.dueDate,
                        originalDueDate: window.dueDate,
                    })),
                },
                reminderTimes: [...input.reminderTimes].sort(),
                reopenedFromId: options.reopenedFromId,
                rewardPlan: {
                    create: {
                        eligible: rewardEligible,
                        eligibleAt: rewardEligible
                            ? luxon_1.DateTime.fromISO(startDateKey, { zone: timezone })
                                .plus({ days: goal_v2_config_1.GOAL_REWARD_MINIMUM_DAYS - 1 })
                                .startOf("day")
                                .toUTC()
                                .toJSDate()
                            : null,
                        milestones: {
                            create: rewardMilestones.map((milestone, order) => ({
                                ...milestone,
                                order,
                            })),
                        },
                        releasePolicy: input.rewardReleasePolicy,
                        source: options.rewardSource ??
                            (input.templateId
                                ? client_1.GoalRewardPlanSource.COMMUNITY_TEMPLATE
                                : client_1.GoalRewardPlanSource.STANDARD),
                        totalPotential: rewardEligible ? totalPotential : 0,
                    },
                },
                rewardReleasePolicy: input.rewardReleasePolicy,
                scheduleType: toPrismaScheduleType(input.schedule.type),
                startDate,
                targetType: client_1.GoalTargetType[input.target.type],
                targetValue,
                templateId: input.templateId,
                title: input.title,
                unit: input.target.type === "QUANTITY" ? input.target.unit : null,
                userId,
                weekdays: getScheduleWeekdays(input.schedule),
            },
            include: goalDetailsInclude,
        });
        if (input.sourceRecommendationId) {
            await transaction.rewindRecommendation.update({
                data: { resultingGoalId: goal.id },
                where: { id: input.sourceRecommendationId },
            });
        }
        return goal;
    });
    await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
        eventType: "GOAL_CREATED",
        goalId: created.id,
        status: created.status,
        timezone,
        title: created.title,
        userId,
    });
    return serializeGoal(created, timezone);
}
async function listGoalsV2(options) {
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const where = getListWhere(options);
    const goals = await db_config_1.prisma.goalV2.findMany({
        include: goalDetailsInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: options.limit + 1,
        where: {
            ...where,
            ...(cursor
                ? {
                    OR: [
                        { createdAt: { lt: cursor.createdAt } },
                        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                    ],
                }
                : {}),
        },
    });
    const hasMore = goals.length > options.limit;
    const page = hasMore ? goals.slice(0, options.limit) : goals;
    const last = page[page.length - 1];
    return {
        goals: page.map((goal) => serializeGoal(goal, options.timezone)),
        pagination: {
            hasMore,
            nextCursor: hasMore && last ? encodeCursor(last) : null,
        },
    };
}
async function getGoalV2(goalId, userId, timezone) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    return serializeGoal(goal, timezone);
}
async function listGoalOccurrences(goalId, userId, cursor, limit = 20) {
    await getOwnedGoal(db_config_1.prisma, goalId, userId);
    const decoded = cursor ? decodeOccurrenceCursor(cursor) : null;
    const data = await db_config_1.prisma.goalOccurrence.findMany({
        include: { progress: true },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: limit + 1,
        where: {
            goalId,
            ...(decoded
                ? {
                    OR: [
                        { dueDate: { gt: decoded.dueDate } },
                        { dueDate: decoded.dueDate, id: { gt: decoded.id } },
                    ],
                }
                : {}),
        },
    });
    const hasMore = data.length > limit;
    const page = hasMore ? data.slice(0, limit) : data;
    const last = page[page.length - 1];
    return {
        data: page,
        pagination: {
            hasMore,
            nextCursor: hasMore && last ? encodeOccurrenceCursor(last) : null,
        },
    };
}
async function recordGoalProgress(goalId, occurrenceId, userId, timezone, input, sourceRecommendationId) {
    const now = new Date();
    await db_config_1.prisma.$transaction(async (transaction) => {
        if (sourceRecommendationId) {
            const claim = await transaction.rewindRecommendation.updateMany({
                data: {
                    acceptedAt: now,
                    status: client_1.RewindRecommendationStatus.ACCEPTED,
                },
                where: {
                    id: sourceRecommendationId,
                    status: client_1.RewindRecommendationStatus.PENDING,
                    type: client_1.RewindRecommendationType.GOAL_PROGRESS,
                    userId,
                },
            });
            if (!claim.count) {
                throw new GoalV2ServiceError("REWIND_RECOMMENDATION_UNAVAILABLE", "This Rewind progress suggestion is no longer available", 409);
            }
        }
        const goal = await getOwnedGoal(transaction, goalId, userId);
        if (goal.status !== client_1.GoalV2Status.ACTIVE) {
            throw new GoalV2ServiceError("GOAL_NOT_ACTIVE", "Goal is not active", 409);
        }
        const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
        if (!occurrence) {
            throw new GoalV2ServiceError("OCCURRENCE_NOT_FOUND", "Goal occurrence not found", 404);
        }
        if (occurrence.status !== client_1.GoalOccurrenceStatus.PENDING &&
            occurrence.status !== client_1.GoalOccurrenceStatus.GRACE) {
            throw new GoalV2ServiceError("OCCURRENCE_CLOSED", "This occurrence no longer accepts progress", 409);
        }
        const today = (0, goal_v2_schedule_util_1.getLocalDateKey)(now, timezone);
        if (parseDateKey(occurrence.dueDate) > today) {
            throw new GoalV2ServiceError("OCCURRENCE_NOT_DUE", "Progress can only be recorded on or after the due date", 409);
        }
        if (occurrence.status === client_1.GoalOccurrenceStatus.PENDING &&
            now > occurrence.closesAt) {
            throw new GoalV2ServiceError("OCCURRENCE_OVERDUE", "This occurrence has passed its due window", 409);
        }
        if (occurrence.status === client_1.GoalOccurrenceStatus.GRACE &&
            occurrence.graceEndsAt &&
            now > occurrence.graceEndsAt) {
            throw new GoalV2ServiceError("OCCURRENCE_OVERDUE", "This occurrence's make-up window has ended", 409);
        }
        const amount = goal.targetType === client_1.GoalTargetType.QUANTITY ? input.amount : 1;
        if (!amount || amount <= 0) {
            throw new GoalV2ServiceError("AMOUNT_REQUIRED", "A positive amount is required for quantity goals");
        }
        const progressEntry = await transaction.goalProgressEntry.create({
            data: {
                amount,
                attachments: input.attachments ?? client_1.Prisma.JsonNull,
                notes: input.notes,
                occurrenceId,
            },
        });
        if (sourceRecommendationId) {
            await transaction.rewindRecommendation.update({
                data: { resultingProgressEntryId: progressEntry.id },
                where: { id: sourceRecommendationId },
            });
        }
        await transaction.goalOccurrence.update({
            data: { completedAt: now, status: client_1.GoalOccurrenceStatus.COMPLETED },
            where: { id: occurrenceId },
        });
        const currentStreak = goal.missMode === client_1.GoalMissMode.NO_STREAK ? 0 : goal.currentStreak + 1;
        await transaction.goalV2.update({
            data: {
                completedOccurrences: { increment: 1 },
                consecutiveMisses: 0,
                currentStreak,
                longestStreak: Math.max(goal.longestStreak, currentStreak),
                progressValue: { increment: amount },
            },
            where: { id: goal.id },
        });
        const updatedGoal = await getOwnedGoal(transaction, goal.id, userId);
        const percentage = getProgressPercentage(updatedGoal);
        await awardCrossedMilestones(transaction, updatedGoal, percentage, now);
        const refreshedGoal = await getOwnedGoal(transaction, goal.id, userId);
        if (hasReachedTarget(refreshedGoal)) {
            await finishGoal(transaction, refreshedGoal, client_1.GoalV2Status.COMPLETED, now);
        }
    });
    const result = await getGoalV2(goalId, userId, timezone);
    if (result) {
        await (0, activity_signal_service_1.recordActivitySignal)({
            dedupeKey: `goal-progress:${occurrenceId}:completed`,
            description: `Completed scheduled progress for “${result.title}”.`,
            eventType: "GOAL_PROGRESS_COMPLETED",
            metadata: {
                currentStreak: result.progress.currentStreak,
                goalId,
                occurrenceId,
                status: result.status,
            },
            sourceId: occurrenceId,
            sourceType: client_1.ActivitySignalSourceType.GOAL,
            timezone,
            userId,
        });
        if (result.status === client_1.GoalV2Status.COMPLETED) {
            await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
                eventType: "GOAL_COMPLETED",
                goalId,
                status: client_1.GoalV2Status.COMPLETED,
                timezone,
                title: result.title,
                userId,
            });
        }
    }
    return result;
}
async function updateGoalProgress(goalId, occurrenceId, userId, timezone, input) {
    const now = new Date();
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ACTIVE) {
        throw new GoalV2ServiceError("CONCLUDED_PROGRESS_IMMUTABLE", "Progress on a concluded goal cannot be changed", 409);
    }
    const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
    if (!occurrence?.progress) {
        throw new GoalV2ServiceError("PROGRESS_NOT_FOUND", "Progress not found", 404);
    }
    if ((0, goal_v2_schedule_util_1.getLocalDateKey)(now, timezone) !== parseDateKey(occurrence.dueDate)) {
        throw new GoalV2ServiceError("PROGRESS_LOCKED", "Progress can only be corrected before its due day ends", 409);
    }
    const amount = goal.targetType === client_1.GoalTargetType.QUANTITY
        ? (input.amount ?? occurrence.progress.amount)
        : 1;
    if (amount <= 0) {
        throw new GoalV2ServiceError("INVALID_AMOUNT", "Amount must be positive");
    }
    const difference = amount - occurrence.progress.amount;
    await db_config_1.prisma.$transaction([
        db_config_1.prisma.goalProgressEntry.update({
            data: {
                amount,
                ...(input.attachments ? { attachments: input.attachments } : {}),
                ...(input.notes !== undefined ? { notes: input.notes } : {}),
            },
            where: { occurrenceId },
        }),
        db_config_1.prisma.goalV2.update({
            data: { progressValue: { increment: difference } },
            where: { id: goal.id },
        }),
    ]);
    await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
        eventType: "GOAL_PAUSED",
        goalId,
        status: client_1.GoalV2Status.PAUSED,
        timezone,
        title: goal.title,
        userId,
    });
    return getGoalV2(goalId, userId, timezone);
}
async function deleteGoalProgress(goalId, occurrenceId, userId, timezone) {
    const now = new Date();
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ACTIVE) {
        throw new GoalV2ServiceError("CONCLUDED_PROGRESS_IMMUTABLE", "Progress on a concluded goal cannot be changed", 409);
    }
    const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
    if (!occurrence?.progress) {
        throw new GoalV2ServiceError("PROGRESS_NOT_FOUND", "Progress not found", 404);
    }
    if ((0, goal_v2_schedule_util_1.getLocalDateKey)(now, timezone) !== parseDateKey(occurrence.dueDate)) {
        throw new GoalV2ServiceError("PROGRESS_LOCKED", "Progress can only be undone before its due day ends", 409);
    }
    await db_config_1.prisma.$transaction([
        db_config_1.prisma.goalProgressEntry.delete({ where: { occurrenceId } }),
        db_config_1.prisma.goalOccurrence.update({
            data: { completedAt: null, status: client_1.GoalOccurrenceStatus.PENDING },
            where: { id: occurrenceId },
        }),
        db_config_1.prisma.goalV2.update({
            data: {
                completedOccurrences: { decrement: 1 },
                currentStreak: Math.max(0, goal.currentStreak - 1),
                progressValue: { decrement: occurrence.progress.amount },
            },
            where: { id: goal.id },
        }),
    ]);
    return getGoalV2(goalId, userId, timezone);
}
async function updateGoalV2(goalId, userId, timezone, input) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ACTIVE &&
        goal.status !== client_1.GoalV2Status.PAUSED) {
        throw new GoalV2ServiceError("GOAL_ENDED", "Only active or paused goals can be edited", 409);
    }
    const missPolicy = input.missPolicy
        ? resolveMissPolicy(input.missPolicy)
        : null;
    await db_config_1.prisma.goalV2.update({
        data: {
            ...(input.description !== undefined
                ? { description: input.description }
                : {}),
            ...(input.reminderTimes
                ? { reminderTimes: [...input.reminderTimes].sort() }
                : {}),
            ...(input.title ? { title: input.title } : {}),
            ...(missPolicy
                ? {
                    breakStreakOnMiss: missPolicy.breakStreakOnMiss,
                    forfeitPendingOnMiss: missPolicy.forfeitPendingOnMiss,
                    graceHours: missPolicy.graceHours,
                    maxConsecutiveMisses: missPolicy.maxConsecutiveMisses,
                    missMode: missPolicy.mode,
                }
                : {}),
        },
        where: { id: goalId },
    });
    return getGoalV2(goalId, userId, timezone);
}
async function rescheduleGoalOccurrence(goalId, occurrenceId, userId, timezone, dueDateKey) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ACTIVE) {
        throw new GoalV2ServiceError("GOAL_NOT_ACTIVE", "Goal is not active", 409);
    }
    const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
    if (!occurrence || occurrence.status !== client_1.GoalOccurrenceStatus.PENDING) {
        throw new GoalV2ServiceError("OCCURRENCE_NOT_RESCHEDULABLE", "Only an upcoming occurrence can be rescheduled", 409);
    }
    const today = (0, goal_v2_schedule_util_1.getLocalDateKey)(new Date(), timezone);
    if (parseDateKey(occurrence.dueDate) <= today || dueDateKey <= today) {
        throw new GoalV2ServiceError("OCCURRENCE_NOT_RESCHEDULABLE", "Occurrence dates must be in the future", 409);
    }
    if (dueDateKey < parseDateKey(goal.startDate) ||
        dueDateKey > parseDateKey(goal.hardStopDate)) {
        throw new GoalV2ServiceError("DATE_OUTSIDE_GOAL", "The new date must be inside the goal horizon");
    }
    const duplicate = goal.occurrences.some((item) => item.id !== occurrenceId && parseDateKey(item.dueDate) === dueDateKey);
    if (duplicate) {
        throw new GoalV2ServiceError("OCCURRENCE_DATE_CONFLICT", "Another occurrence already uses that date", 409);
    }
    const dueDate = luxon_1.DateTime.fromISO(dueDateKey, { zone: "UTC" }).toJSDate();
    await db_config_1.prisma.goalOccurrence.update({
        data: {
            closesAt: (0, goal_v2_schedule_util_1.getOccurrenceCloseTime)(dueDateKey, timezone),
            dueDate,
            rescheduledAt: new Date(),
        },
        where: { id: occurrenceId },
    });
    return getGoalV2(goalId, userId, timezone);
}
async function pauseGoalV2(goalId, userId, timezone) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ACTIVE) {
        throw new GoalV2ServiceError("GOAL_NOT_ACTIVE", "Goal is not active", 409);
    }
    const now = new Date();
    await db_config_1.prisma.$transaction([
        db_config_1.prisma.goalPause.create({ data: { goalId, pausedAt: now } }),
        db_config_1.prisma.goalV2.update({
            data: { pausedAt: now, status: client_1.GoalV2Status.PAUSED },
            where: { id: goalId },
        }),
        db_config_1.prisma.notification.deleteMany({
            where: {
                goalId,
                sentAt: null,
                type: "goal_v2_reminder",
            },
        }),
    ]);
    return getGoalV2(goalId, userId, timezone);
}
async function shiftPendingOccurrences(transaction, goal, pauseDays, timezone) {
    const pending = goal.occurrences
        .filter((occurrence) => occurrence.status === client_1.GoalOccurrenceStatus.PENDING ||
        occurrence.status === client_1.GoalOccurrenceStatus.GRACE)
        .sort((left, right) => right.dueDate.getTime() - left.dueDate.getTime());
    for (const occurrence of pending) {
        const dueDate = (0, goal_v2_schedule_util_1.shiftDateByDays)(occurrence.dueDate, pauseDays);
        const dueDateKey = parseDateKey(dueDate);
        await transaction.goalOccurrence.update({
            data: {
                closesAt: (0, goal_v2_schedule_util_1.getOccurrenceCloseTime)(dueDateKey, timezone),
                dueDate,
                graceEndsAt: null,
                rescheduledAt: new Date(),
                status: client_1.GoalOccurrenceStatus.PENDING,
            },
            where: { id: occurrence.id },
        });
    }
}
async function resumeGoalV2(goalId, userId, timezone, deadlinePolicy) {
    await db_config_1.prisma.$transaction(async (transaction) => {
        const goal = await getOwnedGoal(transaction, goalId, userId);
        if (goal.status !== client_1.GoalV2Status.PAUSED || !goal.pausedAt) {
            throw new GoalV2ServiceError("GOAL_NOT_PAUSED", "Goal is not paused", 409);
        }
        const now = new Date();
        const pauseDays = Math.max(1, Math.ceil((now.getTime() - goal.pausedAt.getTime()) / 86400000));
        const pause = await transaction.goalPause.findFirst({
            orderBy: { pausedAt: "desc" },
            where: { goalId, resumedAt: null },
        });
        if (deadlinePolicy === "SHIFT_DEADLINE") {
            await shiftPendingOccurrences(transaction, goal, pauseDays, timezone);
        }
        else {
            await transaction.goalOccurrence.updateMany({
                data: { status: client_1.GoalOccurrenceStatus.CANCELLED },
                where: {
                    dueDate: {
                        lt: luxon_1.DateTime.fromISO((0, goal_v2_schedule_util_1.getLocalDateKey)(now, timezone), {
                            zone: "UTC",
                        }).toJSDate(),
                    },
                    goalId,
                    status: {
                        in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
                    },
                },
            });
        }
        await transaction.goalV2.update({
            data: {
                ...(deadlinePolicy === "SHIFT_DEADLINE"
                    ? {
                        endDate: goal.endDate
                            ? (0, goal_v2_schedule_util_1.shiftDateByDays)(goal.endDate, pauseDays)
                            : null,
                        hardStopDate: (0, goal_v2_schedule_util_1.shiftDateByDays)(goal.hardStopDate, pauseDays),
                    }
                    : {}),
                pausedAt: null,
                status: client_1.GoalV2Status.ACTIVE,
            },
            where: { id: goalId },
        });
        if (pause) {
            await transaction.goalPause.update({
                data: { deadlinePolicy, resumedAt: now },
                where: { id: pause.id },
            });
        }
    });
    const resumed = await getGoalV2(goalId, userId, timezone);
    if (resumed) {
        await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
            eventType: "GOAL_RESUMED",
            goalId,
            status: client_1.GoalV2Status.ACTIVE,
            timezone,
            title: resumed.title,
            userId,
        });
    }
    return resumed;
}
async function abandonGoalV2(goalId, userId, timezone) {
    let goalTitle = "Goal";
    await db_config_1.prisma.$transaction(async (transaction) => {
        const goal = await getOwnedGoal(transaction, goalId, userId);
        goalTitle = goal.title;
        if (goal.status !== client_1.GoalV2Status.ACTIVE &&
            goal.status !== client_1.GoalV2Status.PAUSED) {
            throw new GoalV2ServiceError("GOAL_ENDED", "Goal has already ended", 409);
        }
        await finishGoal(transaction, goal, client_1.GoalV2Status.ABANDONED, new Date());
    });
    await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
        eventType: "GOAL_ABANDONED",
        goalId,
        status: client_1.GoalV2Status.ABANDONED,
        timezone,
        title: goalTitle,
        userId,
    });
    return getGoalV2(goalId, userId, timezone);
}
async function archiveGoalV2(goalId, userId, timezone) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ABANDONED &&
        goal.status !== client_1.GoalV2Status.AUTO_ABANDONED &&
        goal.status !== client_1.GoalV2Status.COMPLETED) {
        throw new GoalV2ServiceError("GOAL_MUST_END_FIRST", "Active goals must be abandoned before archiving", 409);
    }
    await db_config_1.prisma.goalV2.update({
        data: { archivedAt: new Date() },
        where: { id: goalId },
    });
    return getGoalV2(goalId, userId, timezone);
}
async function permanentlyDeleteGoalV2(goalId, userId) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (!goal.archivedAt) {
        throw new GoalV2ServiceError("GOAL_NOT_ARCHIVED", "Archive the goal before permanently deleting it", 409);
    }
    await db_config_1.prisma.goalV2.delete({ where: { id: goalId } });
}
function scheduleFromGoal(goal, startDate) {
    if (goal.scheduleType === client_1.GoalScheduleType.ONE_TIME) {
        return { date: startDate, type: "ONE_TIME" };
    }
    if (goal.scheduleType === client_1.GoalScheduleType.WEEKLY) {
        return {
            startDate,
            type: "WEEKLY",
            weekday: goal.weekdays[0] ?? luxon_1.DateTime.fromISO(startDate).weekday,
        };
    }
    if (goal.scheduleType === client_1.GoalScheduleType.SELECTED_WEEKDAYS) {
        return {
            startDate,
            type: "SELECTED_WEEKDAYS",
            weekdays: goal.weekdays,
        };
    }
    return { startDate, type: "DAILY" };
}
async function reopenGoalV2(goalId, userId, timezone) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (goal.status !== client_1.GoalV2Status.ABANDONED &&
        goal.status !== client_1.GoalV2Status.AUTO_ABANDONED &&
        goal.status !== client_1.GoalV2Status.COMPLETED) {
        throw new GoalV2ServiceError("GOAL_NOT_ENDED", "Only ended goals can be reopened", 409);
    }
    const startDate = (0, goal_v2_schedule_util_1.getLocalDateKey)(new Date(), timezone);
    const target = goal.targetType === client_1.GoalTargetType.QUANTITY
        ? {
            amount: goal.targetValue ?? 1,
            type: "QUANTITY",
            unit: goal.unit ?? "units",
        }
        : goal.targetType === client_1.GoalTargetType.UNTIL_DATE
            ? {
                endDate: luxon_1.DateTime.fromISO(startDate)
                    .plus({ days: Math.max(1, goal.occurrences.length - 1) })
                    .toISODate() ?? startDate,
                type: "UNTIL_DATE",
            }
            : {
                count: Math.max(1, Math.round(goal.targetValue ?? 1)),
                type: "CHECK_IN_COUNT",
            };
    return createGoalV2(userId, timezone, {
        description: goal.description ?? undefined,
        missPolicy: {
            breakStreakOnMiss: goal.breakStreakOnMiss,
            forfeitPendingOnMiss: goal.forfeitPendingOnMiss,
            graceHours: goal.graceHours,
            maxConsecutiveMisses: goal.maxConsecutiveMisses,
            mode: goal.missMode,
        },
        reminderTimes: goal.reminderTimes,
        rewardReleasePolicy: goal.rewardReleasePolicy,
        schedule: scheduleFromGoal(goal, startDate),
        target,
        title: goal.title,
    }, { reopenedFromId: goal.id });
}
async function updateGoalConclusionReview(goalId, userId, timezone, input) {
    const goal = await getOwnedGoal(db_config_1.prisma, goalId, userId);
    if (!goal.conclusion) {
        throw new GoalV2ServiceError("CONCLUSION_NOT_FOUND", "This goal has not concluded", 409);
    }
    await db_config_1.prisma.goalConclusion.update({
        data: {
            ...(input.attachments ? { attachments: input.attachments } : {}),
            ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
            ...(input.rating !== undefined ? { rating: input.rating } : {}),
            ...(input.reflection !== undefined
                ? { reflection: input.reflection }
                : {}),
            reviewUpdatedAt: new Date(),
        },
        where: { goalId },
    });
    return getGoalV2(goalId, userId, timezone);
}
async function finalizeMissedOccurrence(occurrenceId, now) {
    await db_config_1.prisma.$transaction(async (transaction) => {
        const occurrence = await transaction.goalOccurrence.findUnique({
            include: { goal: { include: goalDetailsInclude } },
            where: { id: occurrenceId },
        });
        if (!occurrence || occurrence.goal.status !== client_1.GoalV2Status.ACTIVE)
            return;
        if (occurrence.status !== client_1.GoalOccurrenceStatus.PENDING &&
            occurrence.status !== client_1.GoalOccurrenceStatus.GRACE) {
            return;
        }
        const goal = occurrence.goal;
        const consecutiveMisses = goal.consecutiveMisses + 1;
        await transaction.goalOccurrence.update({
            data: { status: client_1.GoalOccurrenceStatus.MISSED },
            where: { id: occurrence.id },
        });
        await transaction.goalV2.update({
            data: {
                consecutiveMisses,
                currentStreak: goal.breakStreakOnMiss ? 0 : goal.currentStreak,
                missedOccurrences: { increment: 1 },
            },
            where: { id: goal.id },
        });
        if (goal.forfeitPendingOnMiss) {
            await forfeitPendingRewards(transaction, goal.id, now);
        }
        if (goal.maxConsecutiveMisses &&
            consecutiveMisses >= goal.maxConsecutiveMisses) {
            const refreshed = await getOwnedGoal(transaction, goal.id, goal.userId);
            await finishGoal(transaction, refreshed, client_1.GoalV2Status.AUTO_ABANDONED, now);
        }
    });
}
async function recordMissedOccurrenceSignal(occurrence) {
    const [user, goal] = await Promise.all([
        db_config_1.prisma.user.findUnique({
            select: { timezone: true },
            where: { id: occurrence.goal.userId },
        }),
        db_config_1.prisma.goalV2.findUnique({
            select: { status: true },
            where: { id: occurrence.goalId },
        }),
    ]);
    const timezone = user?.timezone ?? "UTC";
    await (0, activity_signal_service_1.recordActivitySignal)({
        dedupeKey: `goal-progress:${occurrence.id}:missed`,
        description: `Missed scheduled progress for “${occurrence.goal.title}”.`,
        eventType: "GOAL_PROGRESS_MISSED",
        metadata: { goalId: occurrence.goalId, occurrenceId: occurrence.id },
        sourceId: occurrence.id,
        sourceType: client_1.ActivitySignalSourceType.GOAL,
        timezone,
        userId: occurrence.goal.userId,
    });
    if (goal?.status === client_1.GoalV2Status.AUTO_ABANDONED) {
        await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
            eventType: "GOAL_AUTO_ABANDONED",
            goalId: occurrence.goalId,
            status: goal.status,
            timezone,
            title: occurrence.goal.title,
            userId: occurrence.goal.userId,
        });
    }
}
async function processGoalV2Lifecycle(now = new Date()) {
    const overduePending = await db_config_1.prisma.goalOccurrence.findMany({
        include: { goal: true },
        where: {
            closesAt: { lt: now },
            goal: { status: client_1.GoalV2Status.ACTIVE },
            status: client_1.GoalOccurrenceStatus.PENDING,
        },
    });
    let graceStarted = 0;
    let missed = 0;
    for (const occurrence of overduePending) {
        if (occurrence.goal.graceHours > 0) {
            await db_config_1.prisma.goalOccurrence.update({
                data: {
                    graceEndsAt: luxon_1.DateTime.fromJSDate(occurrence.closesAt)
                        .plus({ hours: occurrence.goal.graceHours })
                        .toJSDate(),
                    status: client_1.GoalOccurrenceStatus.GRACE,
                },
                where: { id: occurrence.id },
            });
            graceStarted += 1;
        }
        else {
            await finalizeMissedOccurrence(occurrence.id, now);
            await recordMissedOccurrenceSignal(occurrence);
            missed += 1;
        }
    }
    const expiredGrace = await db_config_1.prisma.goalOccurrence.findMany({
        include: { goal: true },
        where: {
            graceEndsAt: { lt: now },
            goal: { status: client_1.GoalV2Status.ACTIVE },
            status: client_1.GoalOccurrenceStatus.GRACE,
        },
    });
    for (const occurrence of expiredGrace) {
        await finalizeMissedOccurrence(occurrence.id, now);
        await recordMissedOccurrenceSignal(occurrence);
        missed += 1;
    }
    const todayUtc = luxon_1.DateTime.fromJSDate(now, { zone: "UTC" })
        .startOf("day")
        .toJSDate();
    const expiredGoals = await db_config_1.prisma.goalV2.findMany({
        include: goalDetailsInclude,
        where: {
            hardStopDate: { lte: todayUtc },
            occurrences: {
                none: {
                    status: {
                        in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
                    },
                },
            },
            status: client_1.GoalV2Status.ACTIVE,
        },
    });
    let autoAbandoned = 0;
    for (const goal of expiredGoals) {
        let finalStatus = client_1.GoalV2Status.COMPLETED;
        await db_config_1.prisma.$transaction(async (transaction) => {
            const current = await getOwnedGoal(transaction, goal.id, goal.userId);
            if (hasReachedTarget(current)) {
                await finishGoal(transaction, current, client_1.GoalV2Status.COMPLETED, now);
            }
            else {
                finalStatus = client_1.GoalV2Status.AUTO_ABANDONED;
                await finishGoal(transaction, current, client_1.GoalV2Status.AUTO_ABANDONED, now);
                autoAbandoned += 1;
            }
        });
        const user = await db_config_1.prisma.user.findUnique({
            select: { timezone: true },
            where: { id: goal.userId },
        });
        await (0, activity_signal_service_1.recordGoalLifecycleSignal)({
            eventType: finalStatus === client_1.GoalV2Status.COMPLETED
                ? "GOAL_COMPLETED"
                : "GOAL_AUTO_ABANDONED",
            goalId: goal.id,
            status: finalStatus,
            timezone: user?.timezone ?? "UTC",
            title: goal.title,
            userId: goal.userId,
        });
    }
    return { autoAbandoned, graceStarted, missed };
}
