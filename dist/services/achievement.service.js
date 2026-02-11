"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.achievementService = void 0;
const db_config_1 = require("../config/db.config");
const badges_config_1 = require("../config/badges.config");
const notification_service_1 = require("./notification.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
class AchievementService {
    /**
     * Check if user has already earned an achievement
     */
    async hasAchievement(userId, type, milestone) {
        const existing = await db_config_1.prisma.achievement.findUnique({
            where: {
                userId_type_milestone: {
                    userId,
                    type,
                    milestone,
                },
            },
        });
        return !!existing;
    }
    /**
     * Award a badge to a user
     */
    async awardBadge(userId, type, milestone, goalId) {
        try {
            // Check if already earned
            const alreadyEarned = await this.hasAchievement(userId, type, milestone);
            if (alreadyEarned) {
                return null;
            }
            // Get badge definition
            const badgeDef = (0, badges_config_1.getBadgeDefinition)(type, milestone);
            if (!badgeDef) {
                logger_util_1.default.warn(`No badge definition found for ${type} milestone ${milestone}`);
                return null;
            }
            // Create achievement
            const achievement = await db_config_1.prisma.achievement.create({
                data: {
                    userId,
                    goalId,
                    type,
                    milestone,
                    title: badgeDef.title,
                    description: badgeDef.description,
                    badgeIcon: badgeDef.badgeIcon,
                },
            });
            // Send notification about achievement
            await notification_service_1.notificationService.createNotification({
                userId,
                goalId,
                type: "system",
                title: `Achievement Unlocked: ${badgeDef.title}`,
                message: badgeDef.description,
                data: {
                    achievementId: achievement.id,
                    badgeIcon: badgeDef.badgeIcon,
                    type,
                    milestone,
                },
            });
            logger_util_1.default.info(`Badge awarded: ${badgeDef.title} to user ${userId}`);
            return {
                id: achievement.id,
                type: achievement.type,
                milestone: achievement.milestone,
                title: achievement.title,
                description: achievement.description,
                badgeIcon: achievement.badgeIcon,
                earnedAt: achievement.earnedAt.toISOString(),
            };
        }
        catch (error) {
            logger_util_1.default.error("Error awarding badge:", error);
            return null;
        }
    }
    /**
     * Check and award all applicable badges after a check-in
     */
    async checkAndAwardBadges(userId, goalId, currentDay, wasResetBefore = false) {
        const awardedBadges = [];
        try {
            // 1. Check streak milestone badges
            const streakMilestones = (0, badges_config_1.getStreakMilestones)();
            if (streakMilestones.includes(currentDay)) {
                const badge = await this.awardBadge(userId, "streak_milestone", currentDay, goalId);
                if (badge)
                    awardedBadges.push(badge);
            }
            // 2. Check perfect week (7 consecutive days)
            if (currentDay === 7 || (currentDay > 7 && currentDay % 7 === 0)) {
                // Verify it's truly consecutive by checking check-ins
                const checkIns = await db_config_1.prisma.checkIn.findMany({
                    where: { goalId },
                    orderBy: { checkInDate: "desc" },
                    take: 7,
                });
                if (checkIns.length === 7) {
                    const badge = await this.awardBadge(userId, "perfect_week", 1, goalId);
                    if (badge)
                        awardedBadges.push(badge);
                }
            }
            // 3. Check comeback badge (if they reset before this check-in)
            if (wasResetBefore && currentDay === 1) {
                const badge = await this.awardBadge(userId, "comeback", 1, goalId);
                if (badge)
                    awardedBadges.push(badge);
            }
            // 4. Check total check-ins milestone
            const totalCheckIns = await db_config_1.prisma.checkIn.count({
                where: {
                    goal: { userId },
                },
            });
            const checkInMilestones = [50, 100, 200, 500];
            for (const milestone of checkInMilestones) {
                if (totalCheckIns === milestone) {
                    const badge = await this.awardBadge(userId, "total_checkins", milestone);
                    if (badge)
                        awardedBadges.push(badge);
                }
            }
            // 5. Check early bird / night owl (based on current time)
            const currentHour = new Date().getHours();
            if (currentHour < 9) {
                const badge = await this.awardBadge(userId, "early_bird", 1);
                if (badge)
                    awardedBadges.push(badge);
            }
            else if (currentHour >= 21) {
                const badge = await this.awardBadge(userId, "night_owl", 1);
                if (badge)
                    awardedBadges.push(badge);
            }
            return awardedBadges;
        }
        catch (error) {
            logger_util_1.default.error("Error checking and awarding badges:", error);
            return awardedBadges;
        }
    }
    /**
     * Check and award total goals completed badge
     */
    async checkTotalGoalsAchievement(userId) {
        try {
            // Count completed goals (currentDay >= targetDays)
            const completedGoals = await db_config_1.prisma.goal.count({
                where: {
                    userId,
                    currentDay: {
                        gte: db_config_1.prisma.goal.fields.targetDays,
                    },
                },
            });
            const goalMilestones = [3, 5, 10];
            for (const milestone of goalMilestones) {
                if (completedGoals === milestone) {
                    return await this.awardBadge(userId, "total_goals", milestone);
                }
            }
            return null;
        }
        catch (error) {
            logger_util_1.default.error("Error checking total goals achievement:", error);
            return null;
        }
    }
    /**
     * Get all achievements for a user
     */
    async getUserAchievements(userId) {
        const achievements = await db_config_1.prisma.achievement.findMany({
            where: { userId },
            orderBy: { earnedAt: "desc" },
        });
        return achievements.map((a) => ({
            id: a.id,
            userId: a.userId,
            goalId: a.goalId,
            type: a.type,
            milestone: a.milestone,
            title: a.title,
            description: a.description,
            badgeIcon: a.badgeIcon,
            earnedAt: a.earnedAt.toISOString(),
        }));
    }
    /**
     * Get achievement stats for a user
     */
    async getUserAchievementStats(userId) {
        const achievements = await db_config_1.prisma.achievement.findMany({
            where: { userId },
        });
        const stats = {
            totalBadges: achievements.length,
            recentBadges: achievements
                .sort((a, b) => b.earnedAt.getTime() - a.earnedAt.getTime())
                .slice(0, 5)
                .map((a) => ({
                id: a.id,
                title: a.title,
                badgeIcon: a.badgeIcon,
                earnedAt: a.earnedAt.toISOString(),
            })),
            byType: {
                streak_milestone: achievements.filter((a) => a.type === "streak_milestone").length,
                total_goals: achievements.filter((a) => a.type === "total_goals").length,
                total_checkins: achievements.filter((a) => a.type === "total_checkins").length,
                perfect_week: achievements.filter((a) => a.type === "perfect_week").length,
                comeback: achievements.filter((a) => a.type === "comeback").length,
                early_bird: achievements.filter((a) => a.type === "early_bird").length,
                night_owl: achievements.filter((a) => a.type === "night_owl").length,
            },
        };
        return stats;
    }
}
exports.achievementService = new AchievementService();
