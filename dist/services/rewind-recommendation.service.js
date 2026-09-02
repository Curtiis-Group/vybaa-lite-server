"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RewindRecommendationError = void 0;
exports.prepareRewindRecommendations = prepareRewindRecommendations;
exports.getRewindRecommendations = getRewindRecommendations;
exports.acceptRewindRecommendation = acceptRewindRecommendation;
exports.dismissRewindRecommendation = dismissRewindRecommendation;
const client_1 = require("@prisma/client");
const zod_1 = require("zod");
const db_config_1 = require("../config/db.config");
const goal_v2_validators_1 = require("../validators/goal-v2.validators");
const goal_v2_service_1 = require("./goal-v2.service");
const metrics_service_1 = require("./metrics.service");
const evidenceSchema = zod_1.z.array(zod_1.z.string().trim().min(1).max(240)).max(3).default([]);
const baseRecommendationSchema = zod_1.z.object({
    evidence: evidenceSchema,
    rationale: zod_1.z.string().trim().min(1).max(500),
    title: zod_1.z.string().trim().min(1).max(120),
});
const goalProgressProposalSchema = baseRecommendationSchema.extend({
    amount: zod_1.z.number().positive().finite().optional(),
    goalId: zod_1.z.string().min(1).max(128),
    notes: zod_1.z.string().trim().max(500).optional(),
    occurrenceId: zod_1.z.string().min(1).max(128),
    type: zod_1.z.literal("GOAL_PROGRESS"),
});
const newGoalProposalSchema = baseRecommendationSchema.extend({
    description: zod_1.z.string().trim().max(2000).optional(),
    reminderTimes: zod_1.z
        .array(zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
        .max(3)
        .default([]),
    schedule: goal_v2_validators_1.goalScheduleSchema,
    target: goal_v2_validators_1.goalTargetSchema,
    type: zod_1.z.literal("NEW_GOAL"),
});
const flexxProposalSchema = baseRecommendationSchema.extend({
    achievementId: zod_1.z.string().min(1).max(128).optional(),
    cardType: zod_1.z.enum(["achievement", "daily", "rewind", "streak", "weekly"]),
    type: zod_1.z.literal("FLEXX"),
});
const recommendationProposalSchema = zod_1.z.discriminatedUnion("type", [
    flexxProposalSchema,
    goalProgressProposalSchema,
    newGoalProposalSchema,
]);
const recommendationToolInputSchema = zod_1.z.object({
    recommendations: zod_1.z.array(recommendationProposalSchema).max(3).default([]),
});
class RewindRecommendationError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
exports.RewindRecommendationError = RewindRecommendationError;
function toInputJson(value) {
    return JSON.parse(JSON.stringify(value));
}
function getPayload(proposal) {
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
async function validateGoalProgressProposal(userId, proposal) {
    const occurrence = await db_config_1.prisma.goalOccurrence.findFirst({
        include: { goal: true },
        where: {
            goalId: proposal.goalId,
            id: proposal.occurrenceId,
            goal: { status: client_1.GoalV2Status.ACTIVE, userId },
            status: { in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING] },
        },
    });
    if (!occurrence)
        return false;
    const openUntil = occurrence.graceEndsAt ?? occurrence.closesAt;
    if (openUntil < new Date())
        return false;
    if (occurrence.goal.targetType === client_1.GoalTargetType.QUANTITY &&
        !proposal.amount) {
        return false;
    }
    return true;
}
async function validateProposal(userId, proposal) {
    if (proposal.type === "GOAL_PROGRESS") {
        return validateGoalProgressProposal(userId, proposal);
    }
    if (proposal.type === "FLEXX" && proposal.achievementId) {
        const achievement = await db_config_1.prisma.achievement.findFirst({
            select: { id: true },
            where: { id: proposal.achievementId, userId },
        });
        return Boolean(achievement);
    }
    return true;
}
async function prepareRewindRecommendations(sessionId, userId, input) {
    const parsed = recommendationToolInputSchema.safeParse(input);
    if (!parsed.success)
        return [];
    const seen = new Set();
    const valid = [];
    for (const proposal of parsed.data.recommendations) {
        if (seen.has(proposal.type))
            continue;
        if (!(await validateProposal(userId, proposal)))
            continue;
        seen.add(proposal.type);
        valid.push(proposal);
    }
    if (valid.length) {
        await db_config_1.prisma.rewindRecommendation.createMany({
            data: valid.map((proposal) => ({
                dedupeKey: `rewind:${sessionId}:${proposal.type}`,
                evidence: toInputJson(proposal.evidence),
                payload: getPayload(proposal),
                rationale: proposal.rationale,
                sessionId,
                title: proposal.title,
                type: client_1.RewindRecommendationType[proposal.type],
                userId,
            })),
            skipDuplicates: true,
        });
    }
    void metrics_service_1.metricsService.record("rewind_recommendation_created", valid.length, {
        sessionId,
    });
    return db_config_1.prisma.rewindRecommendation.findMany({
        orderBy: { createdAt: "asc" },
        where: { sessionId, userId },
    });
}
async function getRewindRecommendations(sessionId, userId) {
    return db_config_1.prisma.rewindRecommendation.findMany({
        orderBy: { createdAt: "asc" },
        where: { sessionId, userId },
    });
}
function parseProgressPayload(value) {
    return zod_1.z
        .object({
        amount: zod_1.z.number().positive().optional(),
        goalId: zod_1.z.string().min(1),
        notes: zod_1.z.string().optional(),
        occurrenceId: zod_1.z.string().min(1),
    })
        .safeParse(value);
}
async function acceptRewindRecommendation(recommendationId, sessionId, userId, timezone) {
    const recommendation = await db_config_1.prisma.rewindRecommendation.findFirst({
        where: { id: recommendationId, sessionId, userId },
    });
    if (!recommendation) {
        throw new RewindRecommendationError("REWIND_RECOMMENDATION_NOT_FOUND", "Recommendation not found", 404);
    }
    if (recommendation.status === client_1.RewindRecommendationStatus.ACCEPTED) {
        void metrics_service_1.metricsService.record("rewind_recommendation_duplicate_action", 1, {
            type: recommendation.type,
        });
        return recommendation;
    }
    if (recommendation.status !== client_1.RewindRecommendationStatus.PENDING) {
        throw new RewindRecommendationError("REWIND_RECOMMENDATION_UNAVAILABLE", "This recommendation is no longer available", 409);
    }
    if (recommendation.type === client_1.RewindRecommendationType.NEW_GOAL) {
        throw new RewindRecommendationError("GOAL_CREATOR_REQUIRED", "Open the goal creator to review this suggestion", 409);
    }
    if (recommendation.type === client_1.RewindRecommendationType.FLEXX) {
        const accepted = await db_config_1.prisma.rewindRecommendation.update({
            data: {
                acceptedAt: new Date(),
                status: client_1.RewindRecommendationStatus.ACCEPTED,
            },
            where: { id: recommendation.id },
        });
        void metrics_service_1.metricsService.record("rewind_recommendation_accepted", 1, {
            type: recommendation.type,
        });
        return accepted;
    }
    const parsedPayload = parseProgressPayload(recommendation.payload);
    if (!parsedPayload.success) {
        await expireRewindRecommendation(recommendation.id);
        throw new RewindRecommendationError("REWIND_RECOMMENDATION_INVALID", "This progress suggestion is invalid", 409);
    }
    try {
        await (0, goal_v2_service_1.recordGoalProgress)(parsedPayload.data.goalId, parsedPayload.data.occurrenceId, userId, timezone, {
            amount: parsedPayload.data.amount,
            notes: parsedPayload.data.notes,
        }, recommendation.id);
    }
    catch (error) {
        await expireRewindRecommendation(recommendation.id);
        throw error;
    }
    void metrics_service_1.metricsService.record("rewind_recommendation_accepted", 1, {
        type: recommendation.type,
    });
    return db_config_1.prisma.rewindRecommendation.findUniqueOrThrow({
        where: { id: recommendation.id },
    });
}
async function dismissRewindRecommendation(recommendationId, sessionId, userId) {
    const updated = await db_config_1.prisma.rewindRecommendation.updateMany({
        data: {
            dismissedAt: new Date(),
            status: client_1.RewindRecommendationStatus.DISMISSED,
        },
        where: {
            id: recommendationId,
            sessionId,
            status: client_1.RewindRecommendationStatus.PENDING,
            userId,
        },
    });
    if (!updated.count) {
        throw new RewindRecommendationError("REWIND_RECOMMENDATION_UNAVAILABLE", "This recommendation is no longer available", 409);
    }
    void metrics_service_1.metricsService.record("rewind_recommendation_dismissed", 1);
    return db_config_1.prisma.rewindRecommendation.findUniqueOrThrow({
        where: { id: recommendationId },
    });
}
async function expireRewindRecommendation(recommendationId) {
    await db_config_1.prisma.rewindRecommendation.updateMany({
        data: { expiredAt: new Date(), status: client_1.RewindRecommendationStatus.EXPIRED },
        where: {
            id: recommendationId,
            status: client_1.RewindRecommendationStatus.PENDING,
        },
    });
    void metrics_service_1.metricsService.record("rewind_recommendation_expired", 1);
}
