import {
  GoalOccurrenceStatus,
  GoalTargetType,
  GoalV2Status,
  Prisma,
  RewindRecommendationStatus,
  RewindRecommendationType,
} from "@prisma/client";
import { z } from "zod";

import { prisma } from "../config/db.config";
import {
  goalScheduleSchema,
  goalTargetSchema,
} from "../validators/goal-v2.validators";
import { recordGoalProgress } from "./goal-v2.service";
import { metricsService } from "./metrics.service";

const evidenceSchema = z.array(z.string().trim().min(1).max(240)).max(3).default([]);
const baseRecommendationSchema = z.object({
  evidence: evidenceSchema,
  rationale: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(120),
});
const goalProgressProposalSchema = baseRecommendationSchema.extend({
  amount: z.number().positive().finite().optional(),
  goalId: z.string().min(1).max(128),
  notes: z.string().trim().max(500).optional(),
  occurrenceId: z.string().min(1).max(128),
  type: z.literal("GOAL_PROGRESS"),
});
const newGoalProposalSchema = baseRecommendationSchema.extend({
  description: z.string().trim().max(2_000).optional(),
  reminderTimes: z
    .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
    .max(3)
    .default([]),
  schedule: goalScheduleSchema,
  target: goalTargetSchema,
  type: z.literal("NEW_GOAL"),
});
const flexxProposalSchema = baseRecommendationSchema.extend({
  achievementId: z.string().min(1).max(128).optional(),
  cardType: z.enum(["achievement", "daily", "rewind", "streak", "weekly"]),
  type: z.literal("FLEXX"),
});
const recommendationProposalSchema = z.discriminatedUnion("type", [
  flexxProposalSchema,
  goalProgressProposalSchema,
  newGoalProposalSchema,
]);
const recommendationToolInputSchema = z.object({
  recommendations: z.array(recommendationProposalSchema).max(3).default([]),
});

export type RewindRecommendationProposal = z.infer<
  typeof recommendationProposalSchema
>;

export class RewindRecommendationError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getPayload(proposal: RewindRecommendationProposal): Prisma.InputJsonValue {
  if (proposal.type === "GOAL_PROGRESS") {
    return toInputJson({
      amount: proposal.amount,
      goalId: proposal.goalId,
      notes: proposal.notes,
      occurrenceId: proposal.occurrenceId,
    });
  }
  if (proposal.type === "NEW_GOAL") {
    return toInputJson({
      description: proposal.description,
      reminderTimes: proposal.reminderTimes,
      schedule: proposal.schedule,
      target: proposal.target,
      title: proposal.title,
    });
  }
  return toInputJson({
    achievementId: proposal.achievementId,
    cardType: proposal.cardType,
  });
}

async function validateGoalProgressProposal(
  userId: string,
  proposal: z.infer<typeof goalProgressProposalSchema>,
): Promise<boolean> {
  const occurrence = await prisma.goalOccurrence.findFirst({
    include: { goal: true },
    where: {
      goalId: proposal.goalId,
      id: proposal.occurrenceId,
      goal: { status: GoalV2Status.ACTIVE, userId },
      status: { in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING] },
    },
  });
  if (!occurrence) return false;
  const openUntil = occurrence.graceEndsAt ?? occurrence.closesAt;
  if (openUntil < new Date()) return false;
  if (
    occurrence.goal.targetType === GoalTargetType.QUANTITY &&
    !proposal.amount
  ) {
    return false;
  }
  return true;
}

async function validateProposal(
  userId: string,
  proposal: RewindRecommendationProposal,
): Promise<boolean> {
  if (proposal.type === "GOAL_PROGRESS") {
    return validateGoalProgressProposal(userId, proposal);
  }
  if (proposal.type === "FLEXX" && proposal.achievementId) {
    const achievement = await prisma.achievement.findFirst({
      select: { id: true },
      where: { id: proposal.achievementId, userId },
    });
    return Boolean(achievement);
  }
  return true;
}

export async function prepareRewindRecommendations(
  sessionId: string,
  userId: string,
  input: unknown,
) {
  const parsed = recommendationToolInputSchema.safeParse(input);
  if (!parsed.success) return [];

  const seen = new Set<RewindRecommendationProposal["type"]>();
  const valid: RewindRecommendationProposal[] = [];
  for (const proposal of parsed.data.recommendations) {
    if (seen.has(proposal.type)) continue;
    if (!(await validateProposal(userId, proposal))) continue;
    seen.add(proposal.type);
    valid.push(proposal);
  }

  if (valid.length) {
    await prisma.rewindRecommendation.createMany({
      data: valid.map((proposal) => ({
        dedupeKey: `rewind:${sessionId}:${proposal.type}`,
        evidence: toInputJson(proposal.evidence),
        payload: getPayload(proposal),
        rationale: proposal.rationale,
        sessionId,
        title: proposal.title,
        type: RewindRecommendationType[proposal.type],
        userId,
      })),
      skipDuplicates: true,
    });
  }
  void metricsService.record("rewind_recommendation_created", valid.length, {
    sessionId,
  });

  return prisma.rewindRecommendation.findMany({
    orderBy: { createdAt: "asc" },
    where: { sessionId, userId },
  });
}

export async function getRewindRecommendations(
  sessionId: string,
  userId: string,
) {
  return prisma.rewindRecommendation.findMany({
    orderBy: { createdAt: "asc" },
    where: { sessionId, userId },
  });
}

function parseProgressPayload(value: unknown) {
  return z
    .object({
      amount: z.number().positive().optional(),
      goalId: z.string().min(1),
      notes: z.string().optional(),
      occurrenceId: z.string().min(1),
    })
    .safeParse(value);
}

export async function acceptRewindRecommendation(
  recommendationId: string,
  sessionId: string,
  userId: string,
  timezone: string,
) {
  const recommendation = await prisma.rewindRecommendation.findFirst({
    where: { id: recommendationId, sessionId, userId },
  });
  if (!recommendation) {
    throw new RewindRecommendationError(
      "REWIND_RECOMMENDATION_NOT_FOUND",
      "Recommendation not found",
      404,
    );
  }
  if (recommendation.status === RewindRecommendationStatus.ACCEPTED) {
    void metricsService.record("rewind_recommendation_duplicate_action", 1, {
      type: recommendation.type,
    });
    return recommendation;
  }
  if (recommendation.status !== RewindRecommendationStatus.PENDING) {
    throw new RewindRecommendationError(
      "REWIND_RECOMMENDATION_UNAVAILABLE",
      "This recommendation is no longer available",
      409,
    );
  }
  if (recommendation.type === RewindRecommendationType.NEW_GOAL) {
    throw new RewindRecommendationError(
      "GOAL_CREATOR_REQUIRED",
      "Open the goal creator to review this suggestion",
      409,
    );
  }
  if (recommendation.type === RewindRecommendationType.FLEXX) {
    const accepted = await prisma.rewindRecommendation.update({
      data: {
        acceptedAt: new Date(),
        status: RewindRecommendationStatus.ACCEPTED,
      },
      where: { id: recommendation.id },
    });
    void metricsService.record("rewind_recommendation_accepted", 1, {
      type: recommendation.type,
    });
    return accepted;
  }

  const parsedPayload = parseProgressPayload(recommendation.payload);
  if (!parsedPayload.success) {
    await expireRewindRecommendation(recommendation.id);
    throw new RewindRecommendationError(
      "REWIND_RECOMMENDATION_INVALID",
      "This progress suggestion is invalid",
      409,
    );
  }
  try {
    await recordGoalProgress(
      parsedPayload.data.goalId,
      parsedPayload.data.occurrenceId,
      userId,
      timezone,
      {
        amount: parsedPayload.data.amount,
        notes: parsedPayload.data.notes,
      },
      recommendation.id,
    );
  } catch (error) {
    await expireRewindRecommendation(recommendation.id);
    throw error;
  }
  void metricsService.record("rewind_recommendation_accepted", 1, {
    type: recommendation.type,
  });
  return prisma.rewindRecommendation.findUniqueOrThrow({
    where: { id: recommendation.id },
  });
}

export async function dismissRewindRecommendation(
  recommendationId: string,
  sessionId: string,
  userId: string,
) {
  const updated = await prisma.rewindRecommendation.updateMany({
    data: {
      dismissedAt: new Date(),
      status: RewindRecommendationStatus.DISMISSED,
    },
    where: {
      id: recommendationId,
      sessionId,
      status: RewindRecommendationStatus.PENDING,
      userId,
    },
  });
  if (!updated.count) {
    throw new RewindRecommendationError(
      "REWIND_RECOMMENDATION_UNAVAILABLE",
      "This recommendation is no longer available",
      409,
    );
  }
  void metricsService.record("rewind_recommendation_dismissed", 1);
  return prisma.rewindRecommendation.findUniqueOrThrow({
    where: { id: recommendationId },
  });
}

async function expireRewindRecommendation(recommendationId: string): Promise<void> {
  await prisma.rewindRecommendation.updateMany({
    data: { expiredAt: new Date(), status: RewindRecommendationStatus.EXPIRED },
    where: {
      id: recommendationId,
      status: RewindRecommendationStatus.PENDING,
    },
  });
  void metricsService.record("rewind_recommendation_expired", 1);
}
