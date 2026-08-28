"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllGoals = getAllGoals;
exports.getCurrentGoal = getCurrentGoal;
exports.getGoalById = getGoalById;
exports.createGoal = createGoal;
exports.updateGoal = updateGoal;
exports.checkIn = checkIn;
exports.resetGoal = resetGoal;
exports.deleteGoal = deleteGoal;
exports.bulkDeleteGoals = bulkDeleteGoals;
const db_config_1 = require("../config/db.config");
const points_config_1 = require("../config/points.config");
const achievement_service_1 = require("../services/achievement.service");
const community_activity_service_1 = require("../services/community-activity.service");
const milestone_service_1 = require("../services/milestone.service");
const notification_service_1 = require("../services/notification.service");
const subscription_access_service_1 = require("../services/subscription-access.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
// Helper function to get date string in user's timezone (YYYY-MM-DD)
// Uses date-only comparison as specified in the plan
function getDateString(date, timezone) {
    if (timezone) {
        // Get the date in the user's timezone
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        return formatter.format(date);
    }
    // Default to UTC if no timezone provided
    return date.toISOString().split("T")[0];
}
// Helper function to check if a date is more than 1 day ago
function isMoreThanOneDayAgo(date, timezone) {
    const now = new Date();
    const dateStr = getDateString(date, timezone);
    const nowStr = getDateString(now, timezone);
    // Parse dates and compare
    const dateObj = new Date(dateStr + "T00:00:00");
    const nowObj = new Date(nowStr + "T00:00:00");
    const diffDays = Math.floor((nowObj.getTime() - dateObj.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays > 1;
}
// Helper function to check if goal should be reset
async function checkAndResetGoal(goal, timezone, userId) {
    if (!goal.lastCheckInDate) {
        // If never checked in and started more than 1 day ago, reset
        if (isMoreThanOneDayAgo(goal.startedAt, timezone)) {
            const previousDay = goal.currentDay;
            // Delete all check-ins when resetting
            await db_config_1.prisma.checkIn.deleteMany({
                where: { goalId: goal.id },
            });
            await db_config_1.prisma.goal.update({
                where: { id: goal.id },
                data: {
                    currentDay: 0,
                    lastCheckInDate: null,
                },
            });
            // Send notification about streak reset (only if they had progress)
            if (userId && previousDay > 0) {
                const communityName = goal.community?.name;
                await notification_service_1.notificationService.sendStreakResetNotification(userId, goal.id, previousDay, goal.goalText, communityName);
                // Create community activity for streak reset (if it's a community goal)
                if (goal.communityId) {
                    await community_activity_service_1.communityActivityService.createStreakResetActivity(goal.id, userId, previousDay);
                }
            }
            return true;
        }
        return false;
    }
    // If last check-in was more than 1 day ago, reset
    if (isMoreThanOneDayAgo(goal.lastCheckInDate, timezone)) {
        const previousDay = goal.currentDay;
        // Delete all check-ins when resetting
        await db_config_1.prisma.checkIn.deleteMany({
            where: { goalId: goal.id },
        });
        await db_config_1.prisma.goal.update({
            where: { id: goal.id },
            data: {
                currentDay: 0,
                lastCheckInDate: null,
            },
        });
        // Send notification about streak reset (only if they had progress)
        if (userId && previousDay > 0) {
            const communityName = goal.community?.name;
            await notification_service_1.notificationService.sendStreakResetNotification(userId, goal.id, previousDay, goal.goalText, communityName);
            // Create community activity for streak reset (if it's a community goal)
            if (goal.communityId) {
                await community_activity_service_1.communityActivityService.createStreakResetActivity(goal.id, userId, previousDay);
            }
            // Clear all pending points for this goal (streak reset = lose all milestone rewards)
            await db_config_1.prisma.goalPendingPoints.deleteMany({
                where: { goalId: goal.id },
            });
            logger_util_1.default.info(`Cleared pending points for goal ${goal.id} due to streak reset`);
        }
        return true;
    }
    return false;
}
// Helper function to check if user can check in today
async function canCheckInToday(goalId, timezone) {
    const today = new Date();
    const todayStr = getDateString(today, timezone);
    // Get all check-ins for this goal
    const allCheckIns = await db_config_1.prisma.checkIn.findMany({
        where: { goalId },
    });
    // Check if there's a check-in for today
    const todayCheckIn = allCheckIns.find((checkIn) => {
        const checkInDateStr = getDateString(checkIn.checkInDate, timezone);
        return checkInDateStr === todayStr;
    });
    return !todayCheckIn; // Can check in if no check-in exists for today
}
async function getAllGoals(req, res) {
    try {
        const userId = req.userId;
        const timezone = req.headers["x-user-tz"];
        // Parse pagination parameters
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const canCheckInParam = Array.isArray(req.query.canCheckIn)
            ? req.query.canCheckIn[0]
            : req.query.canCheckIn;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "10")) || 10;
        const skip = (page - 1) * limit;
        // if (false) {
        //   const userFCMS = await prisma.user.findUnique({
        //     where: {
        //       id: userId
        //     }
        //   })
        //   if (userFCMS) {
        //     await pushNotificationService.sendFCMMulticast(
        //       userFCMS.fcmTokens,
        //       "notification.title",
        //       "notification.message",
        //       {},
        //       false
        //     );
        //   }
        // }
        // Parse canCheckIn filter (optional boolean filter)
        const canCheckInFilter = canCheckInParam !== undefined
            ? canCheckInParam === "true" || canCheckInParam === "1"
            : undefined;
        // Validate pagination parameters
        if (page < 1 || limit < 1 || limit > 100) {
            return res.status(400).json({
                msg: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
            });
        }
        // Get total count
        const totalCount = await db_config_1.prisma.goal.count({
            where: { userId },
        });
        // Get paginated goals
        const goals = await db_config_1.prisma.goal.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
                checkIns: {
                    orderBy: { checkInDate: "desc" },
                    take: 1,
                },
                community: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        // Check and reset goals that need resetting
        const goalsWithReset = await Promise.all(goals.map(async (goal) => {
            const wasReset = await checkAndResetGoal(goal, timezone, userId);
            if (wasReset) {
                return await db_config_1.prisma.goal.findUnique({
                    where: { id: goal.id },
                });
            }
            return goal;
        }));
        // Add canCheckIn property to each goal
        const goalsWithCheckInStatus = await Promise.all(goalsWithReset.map(async (goal) => {
            const canCheckIn = await canCheckInToday(goal.id, timezone);
            return {
                id: goal.id,
                goalText: goal.goalText,
                targetDays: goal.targetDays,
                currentDay: goal.currentDay,
                lastCheckInDate: goal.lastCheckInDate?.toISOString() || null,
                startedAt: goal.startedAt.toISOString(),
                createdAt: goal.createdAt.toISOString(),
                reminderTime: goal.reminderTime,
                canCheckIn,
                templateId: goal.templateId || null,
                communityId: goal.communityId || null,
                community: goal.communityId
                    ? {
                        id: goal.community?.id || goal.communityId,
                        name: goal.community?.name || "Community",
                    }
                    : null,
            };
        }));
        // Apply canCheckIn filter if specified
        const filteredGoals = canCheckInFilter !== undefined
            ? goalsWithCheckInStatus.filter((goal) => goal.canCheckIn === canCheckInFilter)
            : goalsWithCheckInStatus;
        // Recalculate pagination based on filtered results
        const filteredTotalCount = canCheckInFilter !== undefined ? filteredGoals.length : totalCount;
        const totalPages = Math.ceil(filteredTotalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Goals retrieved successfully",
            data: filteredGoals,
            pagination: {
                page,
                limit,
                totalCount: filteredTotalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get goals error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getCurrentGoal(req, res) {
    try {
        const userId = req.userId;
        const timezone = req.headers["x-user-tz"];
        // Get the most recent goal (for backward compatibility with single goal)
        const goal = await db_config_1.prisma.goal.findFirst({
            where: { userId },
            orderBy: { createdAt: "desc" },
            include: {
                checkIns: {
                    orderBy: { checkInDate: "desc" },
                },
                community: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!goal) {
            return res.json({
                msg: "No active goal",
                data: null,
            });
        }
        // Check if goal should be reset (automatic reset logic)
        const wasReset = await checkAndResetGoal(goal, timezone, userId);
        // Fetch updated goal if it was reset
        const updatedGoal = wasReset
            ? await db_config_1.prisma.goal.findUnique({
                where: { id: goal.id },
                include: {
                    checkIns: {
                        orderBy: { checkInDate: "desc" },
                    },
                },
            })
            : goal;
        const canCheckIn = await canCheckInToday(updatedGoal.id, timezone);
        res.json({
            msg: wasReset
                ? "Goal reset due to missed day"
                : "Goal retrieved successfully",
            data: {
                id: updatedGoal.id,
                goalText: updatedGoal.goalText,
                targetDays: updatedGoal.targetDays,
                currentDay: updatedGoal.currentDay,
                lastCheckInDate: updatedGoal.lastCheckInDate?.toISOString() || null,
                startedAt: updatedGoal.startedAt.toISOString(),
                wasReset,
                canCheckIn,
                templateId: updatedGoal.templateId || null,
                communityId: updatedGoal.communityId || null,
                community: updatedGoal.community || null,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get current goal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getGoalById(req, res) {
    try {
        const userId = req.userId;
        const goalId = String(req.params.goalId);
        const timezone = req.headers["x-user-tz"];
        const goal = await db_config_1.prisma.goal.findFirst({
            where: {
                id: goalId,
                userId, // Ensure user owns this goal
            },
            include: {
                checkIns: {
                    orderBy: { checkInDate: "desc" },
                },
                community: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        if (!goal) {
            return res.status(404).json({
                msg: "Goal not found",
                data: null,
            });
        }
        // Check if goal should be reset (automatic reset logic)
        const wasReset = await checkAndResetGoal(goal, timezone, userId);
        // Fetch updated goal if it was reset
        const updatedGoal = wasReset
            ? await db_config_1.prisma.goal.findUnique({
                where: { id: goal.id },
                include: {
                    checkIns: {
                        orderBy: { checkInDate: "desc" },
                    },
                },
            })
            : goal;
        const canCheckIn = await canCheckInToday(updatedGoal.id, timezone);
        res.json({
            msg: wasReset
                ? "Goal reset due to missed day"
                : "Goal retrieved successfully",
            data: {
                id: updatedGoal.id,
                goalText: updatedGoal.goalText,
                targetDays: updatedGoal.targetDays,
                currentDay: updatedGoal.currentDay,
                lastCheckInDate: updatedGoal.lastCheckInDate?.toISOString() || null,
                startedAt: updatedGoal.startedAt.toISOString(),
                reminderTime: updatedGoal.reminderTime,
                wasReset,
                canCheckIn,
                templateId: updatedGoal.templateId || null,
                communityId: updatedGoal.communityId || null,
                community: updatedGoal.community || null,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get goal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function createGoal(req, res) {
    try {
        const userId = req.userId;
        const { goalText, targetDays, reminderTime } = req.body;
        await (0, subscription_access_service_1.assertCanCreateGoal)(userId, req.clientApp);
        const goal = await db_config_1.prisma.goal.create({
            data: {
                goalText,
                targetDays,
                currentDay: 0,
                userId,
                startedAt: new Date(),
                reminderTime: reminderTime || null,
            },
        });
        // Create community activity if goal was started from template
        if (goal.templateId && goal.communityId) {
            await community_activity_service_1.communityActivityService.createGoalStartedActivity(goal.id, userId, goal.templateId);
        }
        // Fetch goal with community info if it exists
        const goalWithCommunity = await db_config_1.prisma.goal.findUnique({
            where: { id: goal.id },
            include: {
                community: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        res.json({
            msg: "Goal created successfully",
            data: {
                id: goal.id,
                goalText: goal.goalText,
                targetDays: goal.targetDays,
                currentDay: goal.currentDay,
                startedAt: goal.startedAt.toISOString(),
                lastCheckInDate: null,
                reminderTime: goal.reminderTime,
                canCheckIn: true, // New goals can always be checked in
                templateId: goal.templateId || null,
                communityId: goal.communityId || null,
                community: goalWithCommunity?.community || null,
            },
        });
    }
    catch (error) {
        if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
            return;
        logger_util_1.default.error("Create goal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function updateGoal(req, res) {
    try {
        const userId = req.userId;
        const goalId = String(req.params.goalId);
        const { goalText, targetDays, reminderTime } = req.body;
        // Verify goal exists and belongs to user
        const existingGoal = await db_config_1.prisma.goal.findFirst({
            where: {
                id: goalId,
                userId,
            },
        });
        if (!existingGoal) {
            return res.status(404).json({ msg: "Goal not found" });
        }
        // Build update data
        const updateData = {};
        if (goalText !== undefined)
            updateData.goalText = goalText;
        if (targetDays !== undefined)
            updateData.targetDays = targetDays;
        if (reminderTime !== undefined)
            updateData.reminderTime = reminderTime;
        const updated = await db_config_1.prisma.goal.update({
            where: { id: goalId },
            data: updateData,
        });
        const timezone = req.headers["x-user-tz"];
        const canCheckIn = await canCheckInToday(updated.id, timezone);
        res.json({
            msg: "Goal updated successfully",
            data: {
                id: updated.id,
                goalText: updated.goalText,
                targetDays: updated.targetDays,
                currentDay: updated.currentDay,
                lastCheckInDate: updated.lastCheckInDate?.toISOString() || null,
                startedAt: updated.startedAt.toISOString(),
                reminderTime: updated.reminderTime,
                canCheckIn,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Update goal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function checkIn(req, res) {
    try {
        const userId = req.userId;
        const { goalId, notes, attachments } = req.body;
        const timezone = req.headers["x-user-tz"];
        logger_util_1.default.info("Check-in request:", {
            userId,
            goalId,
            hasNotes: !!notes,
            hasAttachments: !!attachments,
            attachmentsCount: attachments?.length || 0,
        });
        const today = new Date();
        const todayStr = getDateString(today, timezone);
        // If no goalId provided, use the most recent goal (backward compatible)
        let goal;
        if (goalId) {
            goal = await db_config_1.prisma.goal.findFirst({
                where: {
                    id: goalId,
                    userId, // Ensure user owns this goal
                },
            });
        }
        else {
            goal = await db_config_1.prisma.goal.findFirst({
                where: { userId },
                orderBy: { createdAt: "desc" },
            });
        }
        if (!goal) {
            return res.status(404).json({ msg: "Goal not found" });
        }
        // Check if goal should be reset first (MOVED BEFORE check-in validation)
        const wasReset = await checkAndResetGoal(goal, timezone, userId);
        // Fetch fresh goal data after potential reset (with community info for notifications)
        const freshGoal = await db_config_1.prisma.goal.findUnique({
            where: { id: goal.id },
            include: {
                community: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        if (!freshGoal) {
            return res.status(404).json({ msg: "Goal not found" });
        }
        // Now check if already checked in today using date string comparison
        // Get check-ins AFTER reset (so old check-ins are gone)
        const allCheckIns = await db_config_1.prisma.checkIn.findMany({
            where: { goalId: freshGoal.id },
        });
        const todayCheckIn = allCheckIns.find((checkIn) => {
            const checkInDateStr = getDateString(checkIn.checkInDate, timezone);
            return checkInDateStr === todayStr;
        });
        if (todayCheckIn) {
            return res.status(400).json({ msg: "Already checked in today" });
        }
        // Create check-in record
        const checkInDate = new Date(todayStr + "T12:00:00"); // Use noon to avoid timezone issues
        await db_config_1.prisma.checkIn.create({
            data: {
                goalId: freshGoal.id,
                checkInDate,
                notes: notes || null, // Store notes if provided
                attachments: attachments && attachments.length > 0
                    ? JSON.stringify(attachments)
                    : null, // Store attachments as JSON
            },
        });
        // Increment current day and update last check-in date
        const previousDay = freshGoal.currentDay;
        const newCurrentDay = previousDay + 1;
        const updated = await db_config_1.prisma.goal.update({
            where: { id: freshGoal.id },
            data: {
                currentDay: newCurrentDay,
                lastCheckInDate: checkInDate,
            },
        });
        // Check and award milestones for this goal
        // 1. Community template milestones (if applicable)
        await milestone_service_1.milestoneService.checkAndAwardMilestones(freshGoal.id, userId, previousDay);
        // 2. Main app streak milestones (for all goals)
        await milestone_service_1.milestoneService.checkAndAwardStreakMilestones(freshGoal.id, userId, previousDay, newCurrentDay);
        // Check and award achievements
        const awardedAchievements = await achievement_service_1.achievementService.checkAndAwardBadges(userId, freshGoal.id, newCurrentDay, wasReset);
        // Create community activity for check-in
        if (freshGoal.communityId) {
            await community_activity_service_1.communityActivityService.createCheckInActivity(freshGoal.id, userId);
        }
        // Send notification if goal is completed
        if (newCurrentDay >= freshGoal.targetDays) {
            const communityName = freshGoal.community?.name;
            await notification_service_1.notificationService.sendGoalCompletedNotification(userId, freshGoal.id, freshGoal.goalText, communityName);
            // Create community activity for goal completion
            if (freshGoal.communityId) {
                await community_activity_service_1.communityActivityService.createGoalCompletedActivity(freshGoal.id, userId);
            }
            // Release pending Play Points and close their ledger entries together.
            const pendingPoints = await db_config_1.prisma.goalPendingPoints.findUnique({
                where: { goalId: freshGoal.id },
            });
            if (pendingPoints && pendingPoints.totalPendingPoints > 0) {
                const pendingRewardTransactions = await db_config_1.prisma.transaction.findMany({
                    where: {
                        recipientId: userId,
                        referenceId: freshGoal.id,
                        status: "PENDING",
                        type: "REWARD_POINTS",
                    },
                    select: { amount: true },
                });
                const ledgerTotal = pendingRewardTransactions.reduce((total, transaction) => total + transaction.amount, 0);
                const legacyAmount = pendingPoints.totalPendingPoints - ledgerTotal;
                await db_config_1.prisma.$transaction(async (transaction) => {
                    if (legacyAmount > 0.000001) {
                        await transaction.transaction.create({
                            data: {
                                amount: legacyAmount,
                                dedupeKey: `goal:${freshGoal.id}:legacy-release`,
                                metadata: JSON.stringify({
                                    goalId: freshGoal.id,
                                    state: "completed",
                                    source: "legacy_pending_points",
                                }),
                                recipientId: userId,
                                referenceId: freshGoal.id,
                                status: "COMPLETED",
                                type: "REWARD_POINTS",
                            },
                        });
                    }
                    await transaction.transaction.updateMany({
                        where: {
                            recipientId: userId,
                            referenceId: freshGoal.id,
                            status: "PENDING",
                            type: "REWARD_POINTS",
                        },
                        data: {
                            status: "COMPLETED",
                        },
                    });
                    await transaction.user.update({
                        where: { id: userId },
                        data: {
                            points: {
                                increment: pendingPoints.totalPendingPoints,
                            },
                        },
                    });
                    await transaction.goalPendingPoints.delete({
                        where: { goalId: freshGoal.id },
                    });
                });
                logger_util_1.default.info(`Transferred ${pendingPoints.totalPendingPoints} points to user ${userId} for completed goal ${freshGoal.id}`);
            }
            // Check for total goals completed achievement
            await achievement_service_1.achievementService.checkTotalGoalsAchievement(userId);
        }
        // Send streak milestone notifications for milestone days that award points
        else if ((0, points_config_1.isStreakMilestoneWithPoints)(newCurrentDay)) {
            const communityName = freshGoal.community?.name;
            await notification_service_1.notificationService.sendStreakMilestoneNotification(userId, freshGoal.id, newCurrentDay, freshGoal.goalText, communityName);
        }
        // Fetch updated goal with community info
        const updatedGoalWithCommunity = await db_config_1.prisma.goal.findUnique({
            where: { id: updated.id },
            include: {
                community: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
            },
        });
        res.json({
            msg: "Check-in successful",
            data: {
                goal: {
                    id: updated.id,
                    goalText: updated.goalText,
                    targetDays: updated.targetDays,
                    currentDay: updated.currentDay,
                    lastCheckInDate: updated.lastCheckInDate?.toISOString() || null,
                    startedAt: updated.startedAt.toISOString(),
                    reminderTime: updated.reminderTime,
                    canCheckIn: false, // After checking in, can't check in again today
                    templateId: updatedGoalWithCommunity?.templateId || null,
                    communityId: updatedGoalWithCommunity?.communityId || null,
                    community: updatedGoalWithCommunity?.community || null,
                },
                achievements: awardedAchievements,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Check-in error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function resetGoal(req, res) {
    try {
        const userId = req.userId;
        const { goalId } = req.body;
        // If no goalId provided, use the most recent goal (backward compatible)
        let goal;
        if (goalId) {
            goal = await db_config_1.prisma.goal.findFirst({
                where: {
                    id: goalId,
                    userId, // Ensure user owns this goal
                },
            });
        }
        else {
            goal = await db_config_1.prisma.goal.findFirst({
                where: { userId },
                orderBy: { createdAt: "desc" },
            });
        }
        if (!goal) {
            return res.status(404).json({ msg: "Goal not found" });
        }
        // Delete all check-ins
        await db_config_1.prisma.checkIn.deleteMany({
            where: { goalId: goal.id },
        });
        // Reset goal
        const updated = await db_config_1.prisma.goal.update({
            where: { id: goal.id },
            data: {
                currentDay: 0,
                lastCheckInDate: null,
            },
        });
        res.json({
            msg: "Goal reset successfully",
            data: {
                id: updated.id,
                goalText: updated.goalText,
                targetDays: updated.targetDays,
                currentDay: updated.currentDay,
                lastCheckInDate: null,
                startedAt: updated.startedAt.toISOString(),
                reminderTime: updated.reminderTime,
                canCheckIn: true, // After reset, can check in
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Reset goal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function deleteGoal(req, res) {
    try {
        const userId = req.userId;
        const goalId = String(req.params.goalId);
        const goal = await db_config_1.prisma.goal.findFirst({
            where: {
                id: goalId,
                userId, // Ensure user owns this goal
            },
        });
        if (!goal) {
            return res.status(404).json({ msg: "Goal not found" });
        }
        // Delete all check-ins (cascade should handle this, but being explicit)
        await db_config_1.prisma.checkIn.deleteMany({
            where: { goalId: goal.id },
        });
        // Delete goal
        await db_config_1.prisma.goal.delete({
            where: { id: goal.id },
        });
        // Create community activity for goal deletion (if it's a community goal)
        if (goal.communityId) {
            await community_activity_service_1.communityActivityService.createGoalDeletedActivity(goal.id, userId);
        }
        res.json({
            msg: "Goal deleted successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Delete goal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function bulkDeleteGoals(req, res) {
    try {
        const userId = req.userId;
        const { goalIds } = req.body;
        if (!Array.isArray(goalIds) || goalIds.length === 0) {
            return res.status(400).json({ msg: "goalIds array is required" });
        }
        if (goalIds.length > 50) {
            return res
                .status(400)
                .json({ msg: "Cannot delete more than 50 goals at once" });
        }
        // Find all goals that belong to the user
        const goalsToDelete = await db_config_1.prisma.goal.findMany({
            where: {
                id: { in: goalIds },
                userId, // Ensure user owns these goals
            },
            select: { id: true },
        });
        const foundIds = goalsToDelete.map((g) => g.id);
        const notFoundIds = goalIds.filter((id) => !foundIds.includes(id));
        if (foundIds.length === 0) {
            return res.status(404).json({
                msg: "None of the specified goals were found or belong to you",
                data: {
                    deleted: 0,
                    notFound: notFoundIds.length,
                },
            });
        }
        // Delete check-ins for all goals (cascade should handle, but being explicit)
        await db_config_1.prisma.checkIn.deleteMany({
            where: { goalId: { in: foundIds } },
        });
        // Delete all goals
        const deleteResult = await db_config_1.prisma.goal.deleteMany({
            where: { id: { in: foundIds } },
        });
        const summary = {
            deleted: deleteResult.count,
            notFound: notFoundIds.length,
            total: goalIds.length,
        };
        logger_util_1.default.info("Bulk delete goals:", { userId, summary });
        res.json({
            msg: `Successfully deleted ${summary.deleted} goal(s)${summary.notFound > 0 ? `, ${summary.notFound} not found` : ""}`,
            data: summary,
        });
    }
    catch (error) {
        logger_util_1.default.error("Bulk delete goals error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
