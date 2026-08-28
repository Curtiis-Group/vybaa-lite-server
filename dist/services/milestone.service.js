"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.milestoneService = exports.MilestoneService = void 0;
const client_1 = require("@prisma/client");
const db_config_1 = require("../config/db.config");
const points_config_1 = require("../config/points.config");
const sequence_milestone_util_1 = require("../utils/sequence-milestone.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const community_activity_service_1 = require("./community-activity.service");
const notification_service_1 = require("./notification.service");
const reward_ledger_service_1 = require("./reward-ledger.service");
class MilestoneService {
    /**
     * Check and award milestones for a goal based on its progress change.
     * previousDay: goal.currentDay before increment
     */
    async checkAndAwardMilestones(goalId, userId, previousDay) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    template: true,
                },
            });
            if (!goal || !goal.templateId || !goal.communityId) {
                return; // Not a community/template goal
            }
            const currentDay = goal.currentDay;
            const targetDays = goal.targetDays;
            const milestones = await db_config_1.prisma.templateMilestone.findMany({
                where: { templateId: goal.templateId },
                orderBy: { order: "asc" },
            });
            if (milestones.length === 0) {
                return;
            }
            const triggered = [];
            const prevPct = (previousDay / targetDays) * 100;
            const currPct = (currentDay / targetDays) * 100;
            for (const m of milestones) {
                if (m.triggerType === client_1.MilestoneTriggerType.DAY) {
                    if (currentDay >= m.triggerValue && previousDay < m.triggerValue) {
                        triggered.push({
                            milestone: m,
                            pointsAwarded: m.points,
                            sequenceValue: 0,
                        });
                    }
                    continue;
                }
                if (m.triggerType === client_1.MilestoneTriggerType.PERCENTAGE) {
                    if (currPct >= m.triggerValue && prevPct < m.triggerValue) {
                        triggered.push({
                            milestone: m,
                            pointsAwarded: m.points,
                            sequenceValue: 0,
                        });
                    }
                    continue;
                }
                if (m.triggerType === client_1.MilestoneTriggerType.SEQUENCE) {
                    const sequenceAwards = (0, sequence_milestone_util_1.calculateSequenceMilestoneAwards)({
                        bonusPoints: m.sequenceBonusPoints,
                        currentDay,
                        endDay: m.sequenceEndDay,
                        interval: m.triggerValue,
                        points: m.points,
                        previousDay,
                        startDay: m.sequenceStartDay,
                    });
                    for (const sequenceAward of sequenceAwards) {
                        triggered.push({
                            milestone: m,
                            pointsAwarded: sequenceAward.pointsAwarded,
                            sequenceValue: sequenceAward.sequenceValue,
                        });
                    }
                }
            }
            if (triggered.length === 0) {
                return;
            }
            const triggeredIds = triggered.map((award) => award.milestone.id);
            const existingHits = await db_config_1.prisma.goalMilestoneHit.findMany({
                where: {
                    goalId,
                    milestoneId: { in: triggeredIds },
                },
                select: {
                    milestoneId: true,
                    sequenceValue: true,
                },
            });
            const alreadyHitKeys = new Set(existingHits.map((hit) => `${hit.milestoneId}:${hit.sequenceValue}`));
            const newHits = triggered.filter((award) => {
                return !alreadyHitKeys.has(`${award.milestone.id}:${award.sequenceValue}`);
            });
            if (newHits.length === 0) {
                return;
            }
            // Get community name for notification
            const community = await db_config_1.prisma.community.findUnique({
                where: { id: goal.communityId },
                select: { name: true },
            });
            let totalNewPoints = 0;
            for (const award of newHits) {
                totalNewPoints += award.pointsAwarded;
            }
            // Create or update pending points record
            await db_config_1.prisma.goalPendingPoints.upsert({
                where: { goalId },
                create: {
                    goalId,
                    totalPendingPoints: totalNewPoints,
                },
                update: {
                    totalPendingPoints: {
                        increment: totalNewPoints,
                    },
                },
            });
            // Record milestone hits and create activities
            for (const award of newHits) {
                await db_config_1.prisma.goalMilestoneHit.create({
                    data: {
                        goalId,
                        milestoneId: award.milestone.id,
                        pointsAwarded: award.pointsAwarded,
                        sequenceValue: award.sequenceValue,
                    },
                });
                await (0, reward_ledger_service_1.recordPendingRewardTransaction)({
                    amount: award.pointsAwarded,
                    dedupeKey: `goal:${goalId}:milestone:${award.milestone.id}:${award.sequenceValue}`,
                    goalId,
                    milestoneDay: currentDay,
                    milestoneName: award.milestone.name,
                    userId,
                });
                const milestoneName = award.sequenceValue > 0
                    ? `${award.milestone.name} (${award.sequenceValue})`
                    : award.milestone.name;
                await community_activity_service_1.communityActivityService.createMilestoneReachedActivity(goalId, userId, {
                    id: award.milestone.id,
                    name: milestoneName,
                    points: award.pointsAwarded,
                });
                notification_service_1.notificationService
                    .sendMilestoneReachedNotification(userId, goalId, milestoneName, award.pointsAwarded, goal.goalText || "", community?.name)
                    .catch((err) => logger_util_1.default.error("Error sending milestone notification:", err));
            }
        }
        catch (error) {
            logger_util_1.default.error("Milestone evaluation error:", {
                error,
                goalId,
                userId,
                previousDay,
            });
        }
    }
    /**
     * Check and award streak milestone points for any goal (community or personal).
     * This uses the main app milestone points configuration.
     * previousDay: goal.currentDay before increment
     */
    async checkAndAwardStreakMilestones(goalId, userId, previousDay, currentDay) {
        try {
            // Check if we just crossed a streak milestone
            if (!(0, points_config_1.isStreakMilestoneWithPoints)(currentDay)) {
                return; // Not a milestone day
            }
            // Check if we already awarded points for this milestone
            // We'll track this by checking if we've already awarded points for this day
            // Since we can't easily track main app milestones like template milestones,
            // we'll check if the goal has pending points that include this milestone's points
            // For simplicity, we'll just award points if the day matches a milestone
            // and the previous day was less than the milestone
            const points = (0, points_config_1.getStreakMilestonePoints)(currentDay);
            if (points === 0) {
                return; // No points for this milestone
            }
            // Only award if we just crossed the milestone (previousDay < milestone <= currentDay)
            if (previousDay >= currentDay) {
                return; // Already past this milestone
            }
            // Get goal info for logging
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    community: {
                        select: { name: true },
                    },
                },
            });
            if (!goal) {
                return;
            }
            // Add points to GoalPendingPoints
            await db_config_1.prisma.goalPendingPoints.upsert({
                where: { goalId },
                create: {
                    goalId,
                    totalPendingPoints: points,
                },
                update: {
                    totalPendingPoints: {
                        increment: points,
                    },
                },
            });
            await (0, reward_ledger_service_1.recordPendingRewardTransaction)({
                amount: points,
                dedupeKey: `goal:${goalId}:streak:${currentDay}`,
                goalId,
                milestoneDay: currentDay,
                milestoneName: `Day ${currentDay} Streak`,
                userId,
            });
            logger_util_1.default.info(`Awarded ${points} Play Points for streak milestone day ${currentDay} on goal ${goalId} (user ${userId})`);
            // Send notification about streak milestone (if not already sent by notification service)
            // The notification service already handles this, but we can add a points-specific message
            const communityName = goal.community?.name;
            const milestoneName = `Day ${currentDay} Streak`;
            // Note: We don't create a community activity for main app streak milestones
            // as they're not community-specific. Only template milestones create activities.
        }
        catch (error) {
            logger_util_1.default.error("Streak milestone points error:", {
                error,
                goalId,
                userId,
                previousDay,
                currentDay,
            });
        }
    }
}
exports.MilestoneService = MilestoneService;
exports.milestoneService = new MilestoneService();
