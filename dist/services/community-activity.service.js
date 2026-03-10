"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.communityActivityService = void 0;
const db_config_1 = require("../config/db.config");
const client_1 = require("@prisma/client");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Service for automatically generating community activities from goal events
 */
class CommunityActivityService {
    /**
     * Create activity when a goal is started from a template
     */
    async createGoalStartedActivity(goalId, userId, templateId) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    template: true,
                },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.GOAL_STARTED,
                    goalId,
                    metadata: JSON.stringify({
                        templateId,
                        goalText: goal.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create goal started activity error:", { error, goalId, userId });
        }
    }
    /**
     * Create activity when a user checks in to a community goal
     */
    async createCheckInActivity(goalId, userId) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    template: true,
                },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            // Only create activity for significant check-ins (e.g., milestones)
            // For now, create activity for every check-in, but we could filter by milestones
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.GOAL_CHECK_IN,
                    goalId,
                    metadata: JSON.stringify({
                        currentDay: goal.currentDay,
                        templateId: goal.templateId,
                        goalText: goal.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create check-in activity error:", { error, goalId, userId });
        }
    }
    /**
     * Create activity when a goal is completed
     */
    async createGoalCompletedActivity(goalId, userId) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    template: true,
                },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.GOAL_COMPLETED,
                    goalId,
                    metadata: JSON.stringify({
                        targetDays: goal.targetDays,
                        templateId: goal.templateId,
                        goalText: goal.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create goal completed activity error:", { error, goalId, userId });
        }
    }
    /**
     * Create activity when a user's streak is reset for a community goal
     */
    async createStreakResetActivity(goalId, userId, previousDays) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    template: true,
                },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.GOAL_STREAK_RESET,
                    goalId,
                    metadata: JSON.stringify({
                        previousDays,
                        templateId: goal.templateId,
                        goalText: goal.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create streak reset activity error:", { error, goalId, userId });
        }
    }
    /**
     * Create activity when an achievement is earned for a community goal
     */
    async createAchievementActivity(achievementId, userId, goalId) {
        try {
            if (!goalId) {
                return; // Not goal-specific achievement, skip
            }
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
                include: {
                    template: true,
                },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            const achievement = await db_config_1.prisma.achievement.findUnique({
                where: { id: achievementId },
            });
            if (!achievement) {
                return;
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.ACHIEVEMENT_EARNED,
                    goalId,
                    metadata: JSON.stringify({
                        achievementType: achievement.type,
                        milestone: achievement.milestone,
                        title: achievement.title,
                        templateId: goal.templateId,
                        goalText: goal.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create achievement activity error:", { error, achievementId, userId, goalId });
        }
    }
    /**
     * Create activity when a template is created
     */
    async createTemplateCreatedActivity(templateId, userId, communityId) {
        try {
            const template = await db_config_1.prisma.goalTemplate.findUnique({
                where: { id: templateId },
            });
            if (!template) {
                return;
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId,
                    userId,
                    type: client_1.CommunityActivityType.TEMPLATE_CREATED,
                    metadata: JSON.stringify({
                        templateId,
                        templateTitle: template.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create template created activity error:", { error, templateId, userId, communityId });
        }
    }
    /**
     * Create activity when a member leaves a community
     */
    async createMemberLeftActivity(communityId, userId) {
        try {
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId,
                    userId,
                    type: client_1.CommunityActivityType.MEMBER_LEFT,
                    metadata: JSON.stringify({}),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create member left activity error:", { error, communityId, userId });
        }
    }
    /**
     * Create activity when a community goal is deleted
     */
    async createGoalDeletedActivity(goalId, userId) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.GOAL_DELETED,
                    goalId,
                    metadata: JSON.stringify({
                        goalText: goal.goalText,
                        targetDays: goal.targetDays,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create goal deleted activity error:", { error, goalId, userId });
        }
    }
    /**
     * Create activity when a milestone is reached for a community goal
     */
    async createMilestoneReachedActivity(goalId, userId, milestone) {
        try {
            const goal = await db_config_1.prisma.goal.findUnique({
                where: { id: goalId },
            });
            if (!goal || !goal.communityId) {
                return; // Not a community goal, skip
            }
            await db_config_1.prisma.communityActivity.create({
                data: {
                    communityId: goal.communityId,
                    userId,
                    type: client_1.CommunityActivityType.MILESTONE_REACHED,
                    goalId,
                    metadata: JSON.stringify({
                        milestoneId: milestone.id,
                        milestoneName: milestone.name,
                        points: milestone.points,
                        goalText: goal.goalText,
                    }),
                },
            });
        }
        catch (error) {
            logger_util_1.default.error("Create milestone reached activity error:", { error, goalId, userId, milestoneId: milestone.id });
        }
    }
}
exports.communityActivityService = new CommunityActivityService();
