import {
  ActivitySignalSourceType,
  GoalMissMode,
  GoalOccurrenceStatus,
  GoalRewardAwardStatus,
  GoalRewardPlanSource,
  GoalRewardReleasePolicy,
  RewindRecommendationStatus,
  RewindRecommendationType,
  GoalScheduleType,
  GoalTargetType,
  GoalV2Status,
  Prisma,
  TransactionType,
} from "@prisma/client";
import { DateTime } from "luxon";

import {
  GOAL_REWARD_CAP,
  GOAL_REWARD_MINIMUM_DAYS,
  GOAL_REWARD_MINIMUM_OCCURRENCES,
  STANDARD_GOAL_REWARD_MILESTONES,
} from "../config/goal-v2.config";
import { prisma } from "../config/db.config";
import {
  generateGoalOccurrenceWindows,
  getLocalDateKey,
  getOccurrenceCloseTime,
  getScheduleStartDate,
  resolveGoalHardStopDate,
  shiftDateByDays,
} from "../utils/goal-v2-schedule.util";
import type {
  CreateGoalV2Input,
  GoalMissPolicyInput,
  GoalScheduleInput,
} from "../validators/goal-v2.validators";
import {
  recordActivitySignal,
  recordGoalLifecycleSignal,
} from "./activity-signal.service";

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

const goalDetailsInclude = Prisma.validator<Prisma.GoalV2Include>()({
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

type GoalDetailsRecord = Prisma.GoalV2GetPayload<{
  include: typeof goalDetailsInclude;
}>;

interface GoalCursor {
  createdAt: Date;
  id: string;
}

interface OccurrenceCursor {
  dueDate: Date;
  id: string;
}

interface GoalListOptions {
  cursor?: string;
  filter: "ACTIVE" | "ARCHIVED" | "DUE" | "ENDED" | "OVERDUE" | "PAUSED";
  limit: number;
  timezone: string;
  userId: string;
}

interface MissPolicyValues {
  breakStreakOnMiss: boolean;
  forfeitPendingOnMiss: boolean;
  graceHours: number;
  maxConsecutiveMisses: number | null;
  mode: GoalMissMode;
}

interface ProgressInput {
  amount?: number;
  attachments?: Array<{
    name?: string;
    publicId?: string;
    type: "audio" | "image";
    url: string;
  }>;
  notes?: string;
}

interface ReviewInput {
  attachments?: Array<{
    name?: string;
    publicId?: string;
    type: "audio" | "image";
    url: string;
  }>;
  nextStep?: null | string;
  rating?: null | number;
  reflection?: null | string;
}

interface RewardTotals {
  earned: number;
  forfeited: number;
  pending: number;
  released: number;
}

export interface GoalRewardMilestoneInput {
  name: string;
  points: number;
  triggerPercentage: number;
}

interface CreateGoalV2Options {
  reopenedFromId?: string;
  rewardMilestones?: GoalRewardMilestoneInput[];
  rewardSource?: GoalRewardPlanSource;
}

export class GoalV2ServiceError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "GoalV2ServiceError";
    this.code = code;
    this.status = status;
  }
}

function parseDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function resolveMissPolicy(input: GoalMissPolicyInput): MissPolicyValues {
  const defaults: Record<GoalMissPolicyInput["mode"], MissPolicyValues> = {
    FLEXIBLE: {
      breakStreakOnMiss: true,
      forfeitPendingOnMiss: false,
      graceHours: 24,
      maxConsecutiveMisses: null,
      mode: GoalMissMode.FLEXIBLE,
    },
    NO_STREAK: {
      breakStreakOnMiss: false,
      forfeitPendingOnMiss: false,
      graceHours: 0,
      maxConsecutiveMisses: null,
      mode: GoalMissMode.NO_STREAK,
    },
    STRICT: {
      breakStreakOnMiss: true,
      forfeitPendingOnMiss: true,
      graceHours: 0,
      maxConsecutiveMisses: null,
      mode: GoalMissMode.STRICT,
    },
  };
  const selected = defaults[input.mode];
  return {
    breakStreakOnMiss: input.breakStreakOnMiss ?? selected.breakStreakOnMiss,
    forfeitPendingOnMiss:
      input.forfeitPendingOnMiss ?? selected.forfeitPendingOnMiss,
    graceHours: input.graceHours ?? selected.graceHours,
    maxConsecutiveMisses:
      input.maxConsecutiveMisses ?? selected.maxConsecutiveMisses,
    mode: selected.mode,
  };
}

function toPrismaScheduleType(
  type: GoalScheduleInput["type"],
): GoalScheduleType {
  return type === "SELECTED_WEEKDAYS"
    ? GoalScheduleType.SELECTED_WEEKDAYS
    : GoalScheduleType[type];
}

function getScheduleWeekdays(schedule: GoalScheduleInput): number[] {
  if (schedule.type === "WEEKLY") return [schedule.weekday];
  if (schedule.type === "SELECTED_WEEKDAYS") {
    return [...new Set(schedule.weekdays)].sort((left, right) => left - right);
  }
  return [];
}

function getTargetValue(
  input: CreateGoalV2Input,
  occurrenceCount: number,
): number {
  if (input.target.type === "CHECK_IN_COUNT") return input.target.count;
  if (input.target.type === "QUANTITY") return input.target.amount;
  return occurrenceCount;
}

function normalizeRewardMilestones(
  milestones: GoalRewardMilestoneInput[],
): GoalRewardMilestoneInput[] {
  const byPercentage = new Map<number, GoalRewardMilestoneInput>();
  for (const milestone of milestones) {
    const percentage = Math.min(
      100,
      Math.max(1, Math.round(milestone.triggerPercentage)),
    );
    const current = byPercentage.get(percentage);
    byPercentage.set(percentage, {
      name: current ? `${current.name} + ${milestone.name}` : milestone.name,
      points: (current?.points ?? 0) + Math.max(0, milestone.points),
      triggerPercentage: percentage,
    });
  }
  const normalized = [...byPercentage.values()].sort(
    (left, right) => left.triggerPercentage - right.triggerPercentage,
  );
  let total = 0;
  for (const milestone of normalized) total += milestone.points;
  if (total <= GOAL_REWARD_CAP || total === 0) return normalized;
  const scale = GOAL_REWARD_CAP / total;
  return normalized.map((milestone) => ({
    ...milestone,
    points: Math.round(milestone.points * scale * 100) / 100,
  }));
}

function getProgressPercentage(goal: {
  completedOccurrences: number;
  progressValue: number;
  targetType: GoalTargetType;
  targetValue: null | number;
}): number {
  const targetValue = goal.targetValue ?? 0;
  if (targetValue <= 0) return 0;
  const progress =
    goal.targetType === GoalTargetType.QUANTITY
      ? goal.progressValue
      : goal.completedOccurrences;
  return Math.min((progress / targetValue) * 100, 100);
}

function getRewardTotals(goal: GoalDetailsRecord): RewardTotals {
  const totals: RewardTotals = {
    earned: 0,
    forfeited: 0,
    pending: 0,
    released: 0,
  };
  for (const award of goal.rewardPlan?.awards ?? []) {
    totals.earned += award.points;
    if (award.status === GoalRewardAwardStatus.FORFEITED) {
      totals.forfeited += award.points;
    } else if (award.status === GoalRewardAwardStatus.PENDING) {
      totals.pending += award.points;
    } else {
      totals.released += award.points;
    }
  }
  return totals;
}

function serializeGoal(goal: GoalDetailsRecord, timezone: string) {
  const now = new Date();
  const localToday = getLocalDateKey(now, timezone);
  const nextOccurrence = goal.occurrences.find(
    (occurrence) =>
      (occurrence.status === GoalOccurrenceStatus.GRACE ||
        occurrence.status === GoalOccurrenceStatus.PENDING) &&
      parseDateKey(occurrence.dueDate) >= localToday,
  );
  const dueOccurrence = goal.occurrences.find(
    (occurrence) =>
      (occurrence.status === GoalOccurrenceStatus.GRACE ||
        occurrence.status === GoalOccurrenceStatus.PENDING) &&
      parseDateKey(occurrence.dueDate) <= localToday,
  );
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
          reviewUpdatedAt:
            goal.conclusion.reviewUpdatedAt?.toISOString() ?? null,
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
      adherenceRate:
        goal.completedOccurrences + goal.missedOccurrences > 0
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
      milestones:
        goal.rewardPlan?.milestones.map((milestone) => ({
          id: milestone.id,
          name: milestone.name,
          points: milestone.points,
          status:
            goal.rewardPlan?.awards.find(
              (award) => award.milestoneId === milestone.id,
            )?.status ?? "LOCKED",
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
    target:
      goal.targetType === GoalTargetType.QUANTITY
        ? {
            amount: goal.targetValue ?? 0,
            type: goal.targetType,
            unit: goal.unit,
          }
        : goal.targetType === GoalTargetType.UNTIL_DATE
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

function encodeCursor(goal: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: goal.createdAt.toISOString(), id: goal.id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): GoalCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
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
  } catch {
    throw new GoalV2ServiceError("INVALID_CURSOR", "Invalid goal cursor");
  }
}

function encodeOccurrenceCursor(occurrence: {
  dueDate: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      dueDate: occurrence.dueDate.toISOString(),
      id: occurrence.id,
    }),
  ).toString("base64url");
}

function decodeOccurrenceCursor(cursor: string): OccurrenceCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("dueDate" in parsed) ||
      !("id" in parsed)
    ) {
      throw new Error("Invalid cursor");
    }
    const dueDate = new Date(String(parsed.dueDate));
    const id = String(parsed.id);
    if (!id || Number.isNaN(dueDate.getTime()))
      throw new Error("Invalid cursor");
    return { dueDate, id };
  } catch {
    throw new GoalV2ServiceError("INVALID_CURSOR", "Invalid occurrence cursor");
  }
}

function getListWhere(options: GoalListOptions): Prisma.GoalV2WhereInput {
  const base: Prisma.GoalV2WhereInput = {
    archivedAt: options.filter === "ARCHIVED" ? { not: null } : null,
    userId: options.userId,
  };
  if (options.filter === "PAUSED")
    return { ...base, status: GoalV2Status.PAUSED };
  if (options.filter === "ENDED" || options.filter === "ARCHIVED") {
    return {
      ...base,
      status: {
        in: [
          GoalV2Status.ABANDONED,
          GoalV2Status.AUTO_ABANDONED,
          GoalV2Status.COMPLETED,
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
            in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
          },
        },
      },
      status: GoalV2Status.ACTIVE,
    };
  }
  return { ...base, status: GoalV2Status.ACTIVE };
}

async function getOwnedGoal(
  client: DatabaseClient,
  goalId: string,
  userId: string,
): Promise<GoalDetailsRecord> {
  const goal = await client.goalV2.findFirst({
    include: goalDetailsInclude,
    where: { id: goalId, userId },
  });
  if (!goal)
    throw new GoalV2ServiceError("GOAL_NOT_FOUND", "Goal not found", 404);
  return goal;
}

async function forfeitPendingRewards(
  client: Prisma.TransactionClient,
  goalId: string,
  now: Date,
): Promise<number> {
  const pending = await client.goalRewardAward.findMany({
    where: { goalId, status: GoalRewardAwardStatus.PENDING },
  });
  if (!pending.length) return 0;
  const transactionIds = pending
    .map((award) => award.transactionId)
    .filter((id): id is string => Boolean(id));
  await client.goalRewardAward.updateMany({
    data: { forfeitedAt: now, status: GoalRewardAwardStatus.FORFEITED },
    where: { id: { in: pending.map((award) => award.id) } },
  });
  if (transactionIds.length) {
    await client.transaction.updateMany({
      data: { status: "FAILED" },
      where: { id: { in: transactionIds }, status: "PENDING" },
    });
  }
  let total = 0;
  for (const award of pending) total += award.points;
  return total;
}

async function releasePendingRewards(
  client: Prisma.TransactionClient,
  goalId: string,
  userId: string,
  now: Date,
): Promise<number> {
  const pending = await client.goalRewardAward.findMany({
    where: { goalId, status: GoalRewardAwardStatus.PENDING },
  });
  if (!pending.length) return 0;
  let total = 0;
  for (const award of pending) total += award.points;
  await client.goalRewardAward.updateMany({
    data: { releasedAt: now, status: GoalRewardAwardStatus.RELEASED },
    where: { id: { in: pending.map((award) => award.id) } },
  });
  await client.transaction.updateMany({
    data: { status: "COMPLETED" },
    where: {
      id: {
        in: pending
          .map((award) => award.transactionId)
          .filter((id): id is string => Boolean(id)),
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

async function awardCrossedMilestones(
  client: Prisma.TransactionClient,
  goal: GoalDetailsRecord,
  progressPercentage: number,
  now: Date,
): Promise<void> {
  const plan = goal.rewardPlan;
  if (!plan?.eligible || !plan.eligibleAt || now < plan.eligibleAt) return;
  if (goal.completedOccurrences < GOAL_REWARD_MINIMUM_OCCURRENCES) return;
  const awardedIds = new Set(plan.awards.map((award) => award.milestoneId));
  const crossed = plan.milestones.filter(
    (milestone) =>
      milestone.triggerPercentage <= progressPercentage &&
      !awardedIds.has(milestone.id),
  );

  for (const milestone of crossed) {
    const dedupeKey = `goal-v2:${goal.id}:milestone:${milestone.id}`;
    const releaseImmediately =
      plan.releasePolicy === GoalRewardReleasePolicy.IMMEDIATE;
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
        type: TransactionType.REWARD_POINTS,
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
          ? GoalRewardAwardStatus.RELEASED
          : GoalRewardAwardStatus.PENDING,
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

async function createConclusion(
  client: Prisma.TransactionClient,
  goal: GoalDetailsRecord,
  outcome: GoalV2Status,
  now: Date,
): Promise<void> {
  const allAwards = await client.goalRewardAward.findMany({
    where: { goalId: goal.id },
  });
  let earnedPoints = 0;
  let totalReleased = 0;
  let totalForfeited = 0;
  for (const award of allAwards) {
    earnedPoints += award.points;
    if (award.status === GoalRewardAwardStatus.RELEASED) {
      totalReleased += award.points;
    }
    if (award.status === GoalRewardAwardStatus.FORFEITED) {
      totalForfeited += award.points;
    }
  }
  const measuredProgress =
    goal.targetType === GoalTargetType.QUANTITY
      ? goal.progressValue
      : goal.completedOccurrences;
  const targetValue = goal.targetValue ?? 0;
  const attempted = goal.completedOccurrences + goal.missedOccurrences;
  const durationDays = Math.max(
    1,
    Math.ceil((now.getTime() - goal.startedAt.getTime()) / 86_400_000),
  );

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

async function finishGoal(
  client: Prisma.TransactionClient,
  goal: GoalDetailsRecord,
  outcome: GoalV2Status,
  now: Date,
): Promise<void> {
  const completed = outcome === GoalV2Status.COMPLETED;
  if (completed) {
    await releasePendingRewards(client, goal.id, goal.userId, now);
  } else {
    await forfeitPendingRewards(client, goal.id, now);
  }
  await client.goalOccurrence.updateMany({
    data: { status: GoalOccurrenceStatus.CANCELLED },
    where: {
      goalId: goal.id,
      status: {
        in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
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

function hasReachedTarget(goal: GoalDetailsRecord): boolean {
  if (goal.targetType === GoalTargetType.QUANTITY) {
    return goal.progressValue >= (goal.targetValue ?? Number.POSITIVE_INFINITY);
  }
  if (goal.targetType === GoalTargetType.CHECK_IN_COUNT) {
    return (
      goal.completedOccurrences >=
      (goal.targetValue ?? Number.POSITIVE_INFINITY)
    );
  }
  return (
    goal.missedOccurrences === 0 &&
    goal.completedOccurrences === goal.occurrences.length
  );
}

export async function createGoalV2(
  userId: string,
  timezone: string,
  input: CreateGoalV2Input,
  options: CreateGoalV2Options = {},
) {
  if (input.sourceRecommendationId) {
    const existingRecommendation = await prisma.rewindRecommendation.findFirst({
      include: { resultingGoal: { include: goalDetailsInclude } },
      where: {
        id: input.sourceRecommendationId,
        status: RewindRecommendationStatus.ACCEPTED,
        userId,
      },
    });
    if (existingRecommendation?.resultingGoal) {
      return serializeGoal(existingRecommendation.resultingGoal, timezone);
    }
  }
  const targetEndDate =
    input.target.type === "UNTIL_DATE" ? input.target.endDate : undefined;
  const startDateKey = getScheduleStartDate(input.schedule);
  if (
    (input.hardStopDate && input.hardStopDate < startDateKey) ||
    (targetEndDate && targetEndDate < startDateKey)
  ) {
    throw new GoalV2ServiceError(
      "INVALID_GOAL_DATE_RANGE",
      "The goal end date must be on or after its schedule start date",
    );
  }

  let hardStopDate: string;
  try {
    hardStopDate = resolveGoalHardStopDate({
      hardStopDate: input.hardStopDate,
      schedule: input.schedule,
      targetEndDate,
      timezone,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Invalid goal dates";
    throw new GoalV2ServiceError(
      message.includes("365 days")
        ? "GOAL_HORIZON_EXCEEDED"
        : "INVALID_GOAL_DATE_RANGE",
      message,
    );
  }

  let windows: ReturnType<typeof generateGoalOccurrenceWindows>;
  try {
    windows = generateGoalOccurrenceWindows({
      hardStopDate,
      schedule: input.schedule,
      timezone,
    });
  } catch (error: unknown) {
    throw new GoalV2ServiceError(
      "INVALID_GOAL_SCHEDULE",
      error instanceof Error
        ? error.message
        : "The schedule produces no occurrences",
    );
  }
  if (
    input.target.type === "CHECK_IN_COUNT" &&
    input.target.count > windows.length
  ) {
    throw new GoalV2ServiceError(
      "TARGET_EXCEEDS_HORIZON",
      "The selected schedule cannot provide enough occurrences before the goal ends",
    );
  }
  if (
    input.target.type === "UNTIL_DATE" &&
    input.schedule.type === "ONE_TIME"
  ) {
    throw new GoalV2ServiceError(
      "INVALID_TARGET_SCHEDULE",
      "Date-based adherence goals require a recurring schedule",
    );
  }

  const startDate = DateTime.fromISO(startDateKey, { zone: "UTC" }).toJSDate();
  const endDate = DateTime.fromISO(hardStopDate, { zone: "UTC" }).toJSDate();
  const elapsedDays =
    DateTime.fromISO(hardStopDate).diff(DateTime.fromISO(startDateKey), "days")
      .days + 1;
  const rewardEligible =
    windows.length >= GOAL_REWARD_MINIMUM_OCCURRENCES &&
    elapsedDays >= GOAL_REWARD_MINIMUM_DAYS &&
    input.schedule.type !== "ONE_TIME";
  const missPolicy = resolveMissPolicy(input.missPolicy);
  const targetValue = getTargetValue(input, windows.length);
  const rewardMilestones = normalizeRewardMilestones(
    options.rewardMilestones ?? [...STANDARD_GOAL_REWARD_MILESTONES],
  );
  let totalPotential = 0;
  for (const milestone of rewardMilestones) totalPotential += milestone.points;

  const created = await prisma.$transaction(async (transaction) => {
    if (input.sourceRecommendationId) {
      const claim = await transaction.rewindRecommendation.updateMany({
        data: {
          acceptedAt: new Date(),
          status: RewindRecommendationStatus.ACCEPTED,
        },
        where: {
          id: input.sourceRecommendationId,
          status: RewindRecommendationStatus.PENDING,
          type: RewindRecommendationType.NEW_GOAL,
          userId,
        },
      });
      if (!claim.count) {
        throw new GoalV2ServiceError(
          "REWIND_RECOMMENDATION_UNAVAILABLE",
          "This Rewind goal suggestion is no longer available",
          409,
        );
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
              ? DateTime.fromISO(startDateKey, { zone: timezone })
                  .plus({ days: GOAL_REWARD_MINIMUM_DAYS - 1 })
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
            source:
              options.rewardSource ??
              (input.templateId
                ? GoalRewardPlanSource.COMMUNITY_TEMPLATE
                : GoalRewardPlanSource.STANDARD),
            totalPotential: rewardEligible ? totalPotential : 0,
          },
        },
        rewardReleasePolicy: input.rewardReleasePolicy,
        scheduleType: toPrismaScheduleType(input.schedule.type),
        startDate,
        targetType: GoalTargetType[input.target.type],
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
  await recordGoalLifecycleSignal({
    eventType: "GOAL_CREATED",
    goalId: created.id,
    status: created.status,
    timezone,
    title: created.title,
    userId,
  });
  return serializeGoal(created, timezone);
}

export async function listGoalsV2(options: GoalListOptions) {
  const cursor = options.cursor ? decodeCursor(options.cursor) : null;
  const where = getListWhere(options);
  const goals = await prisma.goalV2.findMany({
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

export async function getGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  return serializeGoal(goal, timezone);
}

export async function listGoalOccurrences(
  goalId: string,
  userId: string,
  cursor?: string,
  limit = 20,
) {
  await getOwnedGoal(prisma, goalId, userId);
  const decoded = cursor ? decodeOccurrenceCursor(cursor) : null;
  const data = await prisma.goalOccurrence.findMany({
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

export async function recordGoalProgress(
  goalId: string,
  occurrenceId: string,
  userId: string,
  timezone: string,
  input: ProgressInput,
  sourceRecommendationId?: string,
) {
  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    if (sourceRecommendationId) {
      const claim = await transaction.rewindRecommendation.updateMany({
        data: {
          acceptedAt: now,
          status: RewindRecommendationStatus.ACCEPTED,
        },
        where: {
          id: sourceRecommendationId,
          status: RewindRecommendationStatus.PENDING,
          type: RewindRecommendationType.GOAL_PROGRESS,
          userId,
        },
      });
      if (!claim.count) {
        throw new GoalV2ServiceError(
          "REWIND_RECOMMENDATION_UNAVAILABLE",
          "This Rewind progress suggestion is no longer available",
          409,
        );
      }
    }
    const goal = await getOwnedGoal(transaction, goalId, userId);
    if (goal.status !== GoalV2Status.ACTIVE) {
      throw new GoalV2ServiceError(
        "GOAL_NOT_ACTIVE",
        "Goal is not active",
        409,
      );
    }
    const occurrence = goal.occurrences.find(
      (item) => item.id === occurrenceId,
    );
    if (!occurrence) {
      throw new GoalV2ServiceError(
        "OCCURRENCE_NOT_FOUND",
        "Goal occurrence not found",
        404,
      );
    }
    if (
      occurrence.status !== GoalOccurrenceStatus.PENDING &&
      occurrence.status !== GoalOccurrenceStatus.GRACE
    ) {
      throw new GoalV2ServiceError(
        "OCCURRENCE_CLOSED",
        "This occurrence no longer accepts progress",
        409,
      );
    }
    const today = getLocalDateKey(now, timezone);
    if (parseDateKey(occurrence.dueDate) > today) {
      throw new GoalV2ServiceError(
        "OCCURRENCE_NOT_DUE",
        "Progress can only be recorded on or after the due date",
        409,
      );
    }
    if (
      occurrence.status === GoalOccurrenceStatus.PENDING &&
      now > occurrence.closesAt
    ) {
      throw new GoalV2ServiceError(
        "OCCURRENCE_OVERDUE",
        "This occurrence has passed its due window",
        409,
      );
    }
    if (
      occurrence.status === GoalOccurrenceStatus.GRACE &&
      occurrence.graceEndsAt &&
      now > occurrence.graceEndsAt
    ) {
      throw new GoalV2ServiceError(
        "OCCURRENCE_OVERDUE",
        "This occurrence's make-up window has ended",
        409,
      );
    }
    const amount =
      goal.targetType === GoalTargetType.QUANTITY ? input.amount : 1;
    if (!amount || amount <= 0) {
      throw new GoalV2ServiceError(
        "AMOUNT_REQUIRED",
        "A positive amount is required for quantity goals",
      );
    }
    const progressEntry = await transaction.goalProgressEntry.create({
      data: {
        amount,
        attachments: input.attachments ?? Prisma.JsonNull,
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
      data: { completedAt: now, status: GoalOccurrenceStatus.COMPLETED },
      where: { id: occurrenceId },
    });
    const currentStreak =
      goal.missMode === GoalMissMode.NO_STREAK ? 0 : goal.currentStreak + 1;
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
      await finishGoal(transaction, refreshedGoal, GoalV2Status.COMPLETED, now);
    }
  });
  const result = await getGoalV2(goalId, userId, timezone);
  if (result) {
    await recordActivitySignal({
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
      sourceType: ActivitySignalSourceType.GOAL,
      timezone,
      userId,
    });
    if (result.status === GoalV2Status.COMPLETED) {
      await recordGoalLifecycleSignal({
        eventType: "GOAL_COMPLETED",
        goalId,
        status: GoalV2Status.COMPLETED,
        timezone,
        title: result.title,
        userId,
      });
    }
  }
  return result;
}

export async function updateGoalProgress(
  goalId: string,
  occurrenceId: string,
  userId: string,
  timezone: string,
  input: ProgressInput,
) {
  const now = new Date();
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (goal.status !== GoalV2Status.ACTIVE) {
    throw new GoalV2ServiceError(
      "CONCLUDED_PROGRESS_IMMUTABLE",
      "Progress on a concluded goal cannot be changed",
      409,
    );
  }
  const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
  if (!occurrence?.progress) {
    throw new GoalV2ServiceError(
      "PROGRESS_NOT_FOUND",
      "Progress not found",
      404,
    );
  }
  if (getLocalDateKey(now, timezone) !== parseDateKey(occurrence.dueDate)) {
    throw new GoalV2ServiceError(
      "PROGRESS_LOCKED",
      "Progress can only be corrected before its due day ends",
      409,
    );
  }
  const amount =
    goal.targetType === GoalTargetType.QUANTITY
      ? (input.amount ?? occurrence.progress.amount)
      : 1;
  if (amount <= 0) {
    throw new GoalV2ServiceError("INVALID_AMOUNT", "Amount must be positive");
  }
  const difference = amount - occurrence.progress.amount;
  await prisma.$transaction([
    prisma.goalProgressEntry.update({
      data: {
        amount,
        ...(input.attachments ? { attachments: input.attachments } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
      where: { occurrenceId },
    }),
    prisma.goalV2.update({
      data: { progressValue: { increment: difference } },
      where: { id: goal.id },
    }),
  ]);
  await recordGoalLifecycleSignal({
    eventType: "GOAL_PAUSED",
    goalId,
    status: GoalV2Status.PAUSED,
    timezone,
    title: goal.title,
    userId,
  });
  return getGoalV2(goalId, userId, timezone);
}

export async function deleteGoalProgress(
  goalId: string,
  occurrenceId: string,
  userId: string,
  timezone: string,
) {
  const now = new Date();
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (goal.status !== GoalV2Status.ACTIVE) {
    throw new GoalV2ServiceError(
      "CONCLUDED_PROGRESS_IMMUTABLE",
      "Progress on a concluded goal cannot be changed",
      409,
    );
  }
  const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
  if (!occurrence?.progress) {
    throw new GoalV2ServiceError(
      "PROGRESS_NOT_FOUND",
      "Progress not found",
      404,
    );
  }
  if (getLocalDateKey(now, timezone) !== parseDateKey(occurrence.dueDate)) {
    throw new GoalV2ServiceError(
      "PROGRESS_LOCKED",
      "Progress can only be undone before its due day ends",
      409,
    );
  }
  await prisma.$transaction([
    prisma.goalProgressEntry.delete({ where: { occurrenceId } }),
    prisma.goalOccurrence.update({
      data: { completedAt: null, status: GoalOccurrenceStatus.PENDING },
      where: { id: occurrenceId },
    }),
    prisma.goalV2.update({
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

export async function updateGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
  input: {
    description?: null | string;
    missPolicy?: GoalMissPolicyInput;
    reminderTimes?: string[];
    title?: string;
  },
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (
    goal.status !== GoalV2Status.ACTIVE &&
    goal.status !== GoalV2Status.PAUSED
  ) {
    throw new GoalV2ServiceError(
      "GOAL_ENDED",
      "Only active or paused goals can be edited",
      409,
    );
  }
  const missPolicy = input.missPolicy
    ? resolveMissPolicy(input.missPolicy)
    : null;
  await prisma.goalV2.update({
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

export async function rescheduleGoalOccurrence(
  goalId: string,
  occurrenceId: string,
  userId: string,
  timezone: string,
  dueDateKey: string,
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (goal.status !== GoalV2Status.ACTIVE) {
    throw new GoalV2ServiceError("GOAL_NOT_ACTIVE", "Goal is not active", 409);
  }
  const occurrence = goal.occurrences.find((item) => item.id === occurrenceId);
  if (!occurrence || occurrence.status !== GoalOccurrenceStatus.PENDING) {
    throw new GoalV2ServiceError(
      "OCCURRENCE_NOT_RESCHEDULABLE",
      "Only an upcoming occurrence can be rescheduled",
      409,
    );
  }
  const today = getLocalDateKey(new Date(), timezone);
  if (parseDateKey(occurrence.dueDate) <= today || dueDateKey <= today) {
    throw new GoalV2ServiceError(
      "OCCURRENCE_NOT_RESCHEDULABLE",
      "Occurrence dates must be in the future",
      409,
    );
  }
  if (
    dueDateKey < parseDateKey(goal.startDate) ||
    dueDateKey > parseDateKey(goal.hardStopDate)
  ) {
    throw new GoalV2ServiceError(
      "DATE_OUTSIDE_GOAL",
      "The new date must be inside the goal horizon",
    );
  }
  const duplicate = goal.occurrences.some(
    (item) =>
      item.id !== occurrenceId && parseDateKey(item.dueDate) === dueDateKey,
  );
  if (duplicate) {
    throw new GoalV2ServiceError(
      "OCCURRENCE_DATE_CONFLICT",
      "Another occurrence already uses that date",
      409,
    );
  }
  const dueDate = DateTime.fromISO(dueDateKey, { zone: "UTC" }).toJSDate();
  await prisma.goalOccurrence.update({
    data: {
      closesAt: getOccurrenceCloseTime(dueDateKey, timezone),
      dueDate,
      rescheduledAt: new Date(),
    },
    where: { id: occurrenceId },
  });
  return getGoalV2(goalId, userId, timezone);
}

export async function pauseGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (goal.status !== GoalV2Status.ACTIVE) {
    throw new GoalV2ServiceError("GOAL_NOT_ACTIVE", "Goal is not active", 409);
  }
  const now = new Date();
  await prisma.$transaction([
    prisma.goalPause.create({ data: { goalId, pausedAt: now } }),
    prisma.goalV2.update({
      data: { pausedAt: now, status: GoalV2Status.PAUSED },
      where: { id: goalId },
    }),
    prisma.notification.deleteMany({
      where: {
        goalId,
        sentAt: null,
        type: "goal_v2_reminder",
      },
    }),
  ]);
  return getGoalV2(goalId, userId, timezone);
}

async function shiftPendingOccurrences(
  transaction: Prisma.TransactionClient,
  goal: GoalDetailsRecord,
  pauseDays: number,
  timezone: string,
): Promise<void> {
  const pending = goal.occurrences
    .filter(
      (occurrence) =>
        occurrence.status === GoalOccurrenceStatus.PENDING ||
        occurrence.status === GoalOccurrenceStatus.GRACE,
    )
    .sort((left, right) => right.dueDate.getTime() - left.dueDate.getTime());
  for (const occurrence of pending) {
    const dueDate = shiftDateByDays(occurrence.dueDate, pauseDays);
    const dueDateKey = parseDateKey(dueDate);
    await transaction.goalOccurrence.update({
      data: {
        closesAt: getOccurrenceCloseTime(dueDateKey, timezone),
        dueDate,
        graceEndsAt: null,
        rescheduledAt: new Date(),
        status: GoalOccurrenceStatus.PENDING,
      },
      where: { id: occurrence.id },
    });
  }
}

export async function resumeGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
  deadlinePolicy: "KEEP_DEADLINE" | "SHIFT_DEADLINE",
) {
  await prisma.$transaction(async (transaction) => {
    const goal = await getOwnedGoal(transaction, goalId, userId);
    if (goal.status !== GoalV2Status.PAUSED || !goal.pausedAt) {
      throw new GoalV2ServiceError(
        "GOAL_NOT_PAUSED",
        "Goal is not paused",
        409,
      );
    }
    const now = new Date();
    const pauseDays = Math.max(
      1,
      Math.ceil((now.getTime() - goal.pausedAt.getTime()) / 86_400_000),
    );
    const pause = await transaction.goalPause.findFirst({
      orderBy: { pausedAt: "desc" },
      where: { goalId, resumedAt: null },
    });
    if (deadlinePolicy === "SHIFT_DEADLINE") {
      await shiftPendingOccurrences(transaction, goal, pauseDays, timezone);
    } else {
      await transaction.goalOccurrence.updateMany({
        data: { status: GoalOccurrenceStatus.CANCELLED },
        where: {
          dueDate: {
            lt: DateTime.fromISO(getLocalDateKey(now, timezone), {
              zone: "UTC",
            }).toJSDate(),
          },
          goalId,
          status: {
            in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
          },
        },
      });
    }
    await transaction.goalV2.update({
      data: {
        ...(deadlinePolicy === "SHIFT_DEADLINE"
          ? {
              endDate: goal.endDate
                ? shiftDateByDays(goal.endDate, pauseDays)
                : null,
              hardStopDate: shiftDateByDays(goal.hardStopDate, pauseDays),
            }
          : {}),
        pausedAt: null,
        status: GoalV2Status.ACTIVE,
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
    await recordGoalLifecycleSignal({
      eventType: "GOAL_RESUMED",
      goalId,
      status: GoalV2Status.ACTIVE,
      timezone,
      title: resumed.title,
      userId,
    });
  }
  return resumed;
}

export async function abandonGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
) {
  let goalTitle = "Goal";
  await prisma.$transaction(async (transaction) => {
    const goal = await getOwnedGoal(transaction, goalId, userId);
    goalTitle = goal.title;
    if (
      goal.status !== GoalV2Status.ACTIVE &&
      goal.status !== GoalV2Status.PAUSED
    ) {
      throw new GoalV2ServiceError("GOAL_ENDED", "Goal has already ended", 409);
    }
    await finishGoal(transaction, goal, GoalV2Status.ABANDONED, new Date());
  });
  await recordGoalLifecycleSignal({
    eventType: "GOAL_ABANDONED",
    goalId,
    status: GoalV2Status.ABANDONED,
    timezone,
    title: goalTitle,
    userId,
  });
  return getGoalV2(goalId, userId, timezone);
}

export async function archiveGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (
    goal.status !== GoalV2Status.ABANDONED &&
    goal.status !== GoalV2Status.AUTO_ABANDONED &&
    goal.status !== GoalV2Status.COMPLETED
  ) {
    throw new GoalV2ServiceError(
      "GOAL_MUST_END_FIRST",
      "Active goals must be abandoned before archiving",
      409,
    );
  }
  await prisma.goalV2.update({
    data: { archivedAt: new Date() },
    where: { id: goalId },
  });
  return getGoalV2(goalId, userId, timezone);
}

export async function permanentlyDeleteGoalV2(
  goalId: string,
  userId: string,
): Promise<void> {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (!goal.archivedAt) {
    throw new GoalV2ServiceError(
      "GOAL_NOT_ARCHIVED",
      "Archive the goal before permanently deleting it",
      409,
    );
  }
  await prisma.goalV2.delete({ where: { id: goalId } });
}

function scheduleFromGoal(
  goal: GoalDetailsRecord,
  startDate: string,
): GoalScheduleInput {
  if (goal.scheduleType === GoalScheduleType.ONE_TIME) {
    return { date: startDate, type: "ONE_TIME" };
  }
  if (goal.scheduleType === GoalScheduleType.WEEKLY) {
    return {
      startDate,
      type: "WEEKLY",
      weekday: goal.weekdays[0] ?? DateTime.fromISO(startDate).weekday,
    };
  }
  if (goal.scheduleType === GoalScheduleType.SELECTED_WEEKDAYS) {
    return {
      startDate,
      type: "SELECTED_WEEKDAYS",
      weekdays: goal.weekdays,
    };
  }
  return { startDate, type: "DAILY" };
}

export async function reopenGoalV2(
  goalId: string,
  userId: string,
  timezone: string,
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (
    goal.status !== GoalV2Status.ABANDONED &&
    goal.status !== GoalV2Status.AUTO_ABANDONED &&
    goal.status !== GoalV2Status.COMPLETED
  ) {
    throw new GoalV2ServiceError(
      "GOAL_NOT_ENDED",
      "Only ended goals can be reopened",
      409,
    );
  }
  const startDate = getLocalDateKey(new Date(), timezone);
  const target =
    goal.targetType === GoalTargetType.QUANTITY
      ? {
          amount: goal.targetValue ?? 1,
          type: "QUANTITY" as const,
          unit: goal.unit ?? "units",
        }
      : goal.targetType === GoalTargetType.UNTIL_DATE
        ? {
            endDate:
              DateTime.fromISO(startDate)
                .plus({ days: Math.max(1, goal.occurrences.length - 1) })
                .toISODate() ?? startDate,
            type: "UNTIL_DATE" as const,
          }
        : {
            count: Math.max(1, Math.round(goal.targetValue ?? 1)),
            type: "CHECK_IN_COUNT" as const,
          };
  return createGoalV2(
    userId,
    timezone,
    {
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
    },
    { reopenedFromId: goal.id },
  );
}

export async function updateGoalConclusionReview(
  goalId: string,
  userId: string,
  timezone: string,
  input: ReviewInput,
) {
  const goal = await getOwnedGoal(prisma, goalId, userId);
  if (!goal.conclusion) {
    throw new GoalV2ServiceError(
      "CONCLUSION_NOT_FOUND",
      "This goal has not concluded",
      409,
    );
  }
  await prisma.goalConclusion.update({
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

async function finalizeMissedOccurrence(
  occurrenceId: string,
  now: Date,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const occurrence = await transaction.goalOccurrence.findUnique({
      include: { goal: { include: goalDetailsInclude } },
      where: { id: occurrenceId },
    });
    if (!occurrence || occurrence.goal.status !== GoalV2Status.ACTIVE) return;
    if (
      occurrence.status !== GoalOccurrenceStatus.PENDING &&
      occurrence.status !== GoalOccurrenceStatus.GRACE
    ) {
      return;
    }
    const goal = occurrence.goal;
    const consecutiveMisses = goal.consecutiveMisses + 1;
    await transaction.goalOccurrence.update({
      data: { status: GoalOccurrenceStatus.MISSED },
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
    if (
      goal.maxConsecutiveMisses &&
      consecutiveMisses >= goal.maxConsecutiveMisses
    ) {
      const refreshed = await getOwnedGoal(transaction, goal.id, goal.userId);
      await finishGoal(
        transaction,
        refreshed,
        GoalV2Status.AUTO_ABANDONED,
        now,
      );
    }
  });
}

async function recordMissedOccurrenceSignal(occurrence: {
  goal: { title: string; userId: string };
  goalId: string;
  id: string;
}): Promise<void> {
  const [user, goal] = await Promise.all([
    prisma.user.findUnique({
      select: { timezone: true },
      where: { id: occurrence.goal.userId },
    }),
    prisma.goalV2.findUnique({
      select: { status: true },
      where: { id: occurrence.goalId },
    }),
  ]);
  const timezone = user?.timezone ?? "UTC";
  await recordActivitySignal({
    dedupeKey: `goal-progress:${occurrence.id}:missed`,
    description: `Missed scheduled progress for “${occurrence.goal.title}”.`,
    eventType: "GOAL_PROGRESS_MISSED",
    metadata: { goalId: occurrence.goalId, occurrenceId: occurrence.id },
    sourceId: occurrence.id,
    sourceType: ActivitySignalSourceType.GOAL,
    timezone,
    userId: occurrence.goal.userId,
  });
  if (goal?.status === GoalV2Status.AUTO_ABANDONED) {
    await recordGoalLifecycleSignal({
      eventType: "GOAL_AUTO_ABANDONED",
      goalId: occurrence.goalId,
      status: goal.status,
      timezone,
      title: occurrence.goal.title,
      userId: occurrence.goal.userId,
    });
  }
}

export async function processGoalV2Lifecycle(now = new Date()): Promise<{
  autoAbandoned: number;
  graceStarted: number;
  missed: number;
}> {
  const overduePending = await prisma.goalOccurrence.findMany({
    include: { goal: true },
    where: {
      closesAt: { lt: now },
      goal: { status: GoalV2Status.ACTIVE },
      status: GoalOccurrenceStatus.PENDING,
    },
  });
  let graceStarted = 0;
  let missed = 0;
  for (const occurrence of overduePending) {
    if (occurrence.goal.graceHours > 0) {
      await prisma.goalOccurrence.update({
        data: {
          graceEndsAt: DateTime.fromJSDate(occurrence.closesAt)
            .plus({ hours: occurrence.goal.graceHours })
            .toJSDate(),
          status: GoalOccurrenceStatus.GRACE,
        },
        where: { id: occurrence.id },
      });
      graceStarted += 1;
    } else {
      await finalizeMissedOccurrence(occurrence.id, now);
      await recordMissedOccurrenceSignal(occurrence);
      missed += 1;
    }
  }
  const expiredGrace = await prisma.goalOccurrence.findMany({
    include: { goal: true },
    where: {
      graceEndsAt: { lt: now },
      goal: { status: GoalV2Status.ACTIVE },
      status: GoalOccurrenceStatus.GRACE,
    },
  });
  for (const occurrence of expiredGrace) {
    await finalizeMissedOccurrence(occurrence.id, now);
    await recordMissedOccurrenceSignal(occurrence);
    missed += 1;
  }

  const todayUtc = DateTime.fromJSDate(now, { zone: "UTC" })
    .startOf("day")
    .toJSDate();
  const expiredGoals = await prisma.goalV2.findMany({
    include: goalDetailsInclude,
    where: {
      hardStopDate: { lte: todayUtc },
      occurrences: {
        none: {
          status: {
            in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
          },
        },
      },
      status: GoalV2Status.ACTIVE,
    },
  });
  let autoAbandoned = 0;
  for (const goal of expiredGoals) {
    let finalStatus: GoalV2Status = GoalV2Status.COMPLETED;
    await prisma.$transaction(async (transaction) => {
      const current = await getOwnedGoal(transaction, goal.id, goal.userId);
      if (hasReachedTarget(current)) {
        await finishGoal(transaction, current, GoalV2Status.COMPLETED, now);
      } else {
        finalStatus = GoalV2Status.AUTO_ABANDONED;
        await finishGoal(
          transaction,
          current,
          GoalV2Status.AUTO_ABANDONED,
          now,
        );
        autoAbandoned += 1;
      }
    });
    const user = await prisma.user.findUnique({
      select: { timezone: true },
      where: { id: goal.userId },
    });
    await recordGoalLifecycleSignal({
      eventType:
        finalStatus === GoalV2Status.COMPLETED
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
