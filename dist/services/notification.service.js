"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const ably_config_1 = require("../config/ably.config");
const db_config_1 = require("../config/db.config");
const points_config_1 = require("../config/points.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const cache_service_1 = require("./cache.service");
const metrics_service_1 = require("./metrics.service");
const push_notification_service_1 = require("./push-notification.service");
class NotificationService {
    constructor() {
        this.ablyClient = (0, ably_config_1.getAblyClient)();
    }
    getStartOfUtcDay(date) {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }
    getScheduledUtcTime(dayStart, hour, now) {
        const scheduledFor = new Date(dayStart);
        scheduledFor.setUTCHours(hour, 0, 0, 0);
        return scheduledFor <= now ? now : scheduledFor;
    }
    getRecipientTitle(user, fallback) {
        const name = user.username || user.firstName;
        return name ? `${name} notifications for ${name}` : fallback;
    }
    async createDedupedSystemNotification(params) {
        const recentNotifications = await db_config_1.prisma.notification.findMany({
            where: {
                userId: params.userId,
                type: "system",
                createdAt: { gte: params.windowStart },
            },
            select: { data: true },
            take: 100,
        });
        const alreadyCreated = recentNotifications.some((notification) => {
            if (!notification.data) {
                return false;
            }
            try {
                const data = JSON.parse(notification.data);
                return data.dedupeKey === params.dedupeKey;
            }
            catch {
                return false;
            }
        });
        if (alreadyCreated) {
            return null;
        }
        return this.createNotification({
            userId: params.userId,
            type: "system",
            title: params.title,
            message: params.message,
            data: {
                ...params.data,
                dedupeKey: params.dedupeKey,
            },
            scheduledFor: params.scheduledFor,
        });
    }
    /**
     * Create a notification in the database
     */
    async createNotification(data) {
        try {
            const notification = await db_config_1.prisma.notification.create({
                data: {
                    userId: data.userId,
                    goalId: data.goalId,
                    type: data.type,
                    title: data.title,
                    message: data.message,
                    data: data.data ? JSON.stringify(data.data) : null,
                    scheduledFor: data.scheduledFor,
                    sentAt: data.scheduledFor ? null : new Date(), // If no schedule, mark as sent immediately
                },
            });
            // If not scheduled, send immediately
            if (!data.scheduledFor) {
                await this.sendNotification(notification.id);
            }
            return notification;
        }
        catch (error) {
            logger_util_1.default.error("Error creating notification:", error);
            throw error;
        }
    }
    /**
     * Send a notification via Ably and FCM
     */
    async sendNotification(notificationId) {
        try {
            const notification = await db_config_1.prisma.notification.findUnique({
                where: { id: notificationId },
                include: {
                    user: {
                        select: { fcmTokens: true },
                    },
                },
            });
            if (!notification) {
                logger_util_1.default.warn(`Notification ${notificationId} not found`);
                return;
            }
            // Create channel for user
            const channel = this.ablyClient.channels.get(`user:${notification.userId}`);
            // Prepare payload
            const payload = {
                id: notification.id,
                type: notification.type,
                title: notification.title,
                message: notification.message,
                data: notification.data ? JSON.parse(notification.data) : undefined,
                createdAt: notification.createdAt.toISOString(),
            };
            // Publish to Ably (for real-time web notifications)
            await channel.publish("notification", payload);
            // Send FCM push notification if user has tokens
            if (notification.user.fcmTokens && notification.user.fcmTokens.length > 0) {
                try {
                    await push_notification_service_1.pushNotificationService.sendFCMMulticast(notification.user.fcmTokens, notification.title, notification.message, payload, false);
                }
                catch (fcmError) {
                    logger_util_1.default.error("Error sending FCM push:", fcmError);
                    // Don't fail the entire notification if FCM fails
                }
            }
            // Mark as sent
            await db_config_1.prisma.notification.update({
                where: { id: notificationId },
                data: { sentAt: new Date() },
            });
            logger_util_1.default.info(`Notification ${notificationId} sent to user ${notification.userId}`);
        }
        catch (error) {
            logger_util_1.default.error(`Error sending notification ${notificationId}:`, error);
            throw error;
        }
    }
    /**
     * Get all notifications for a user
     */
    async getUserNotifications(userId, limit = 50, page = 1) {
        const skip = (page - 1) * limit;
        const [notifications, totalCount] = await Promise.all([
            db_config_1.prisma.notification.findMany({
                where: { userId },
                orderBy: { createdAt: "desc" },
                take: limit,
                skip,
            }),
            db_config_1.prisma.notification.count({ where: { userId } }),
        ]);
        return {
            notifications: notifications.map((n) => ({
                ...n,
                data: n.data ? JSON.parse(n.data) : null,
            })),
            pagination: {
                page,
                limit,
                totalCount,
                totalPages: Math.ceil(totalCount / limit),
                hasNextPage: page < Math.ceil(totalCount / limit),
                hasPrevPage: page > 1,
            },
        };
    }
    /**
     * Get unread notification count
     */
    async getUnreadCount(userId) {
        return db_config_1.prisma.notification.count({
            where: {
                userId,
                isRead: false,
                sentAt: { not: null }, // Only count sent notifications
            },
        });
    }
    /**
     * Mark notification as read
     */
    async markAsRead(notificationId, userId) {
        return db_config_1.prisma.notification.updateMany({
            where: {
                id: notificationId,
                userId, // Ensure user owns this notification
            },
            data: { isRead: true },
        });
    }
    /**
     * Mark all notifications as read
     */
    async markAllAsRead(userId) {
        return db_config_1.prisma.notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true },
        });
    }
    /**
     * Delete a notification
     */
    async deleteNotification(notificationId, userId) {
        return db_config_1.prisma.notification.deleteMany({
            where: {
                id: notificationId,
                userId, // Ensure user owns this notification
            },
        });
    }
    /**
     * Schedule goal reminders for all goals with reminder times
     */
    async scheduleGoalReminders() {
        try {
            // Ensure we only run the heavy scheduling logic once per UTC day.
            const now = new Date();
            const todayKey = now.toISOString().split("T")[0]; // YYYY-MM-DD (UTC)
            const cacheKey = "scheduler:goalReminders:lastRunDate";
            const lastRun = await cache_service_1.cacheService.get(cacheKey);
            if (lastRun === todayKey) {
                // Already scheduled for today; skip DB work.
                return;
            }
            const goals = await db_config_1.prisma.goal.findMany({
                where: {
                    reminderTime: { not: null },
                },
                include: {
                    user: true,
                },
            });
            // Use UTC date to avoid timezone issues
            const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            let scheduledCount = 0;
            for (const goal of goals) {
                if (!goal.reminderTime)
                    continue;
                // Parse reminder time (format: "HH:MM")
                const [hours, minutes] = goal.reminderTime.split(":").map(Number);
                // Calculate scheduled time for today using UTC
                const scheduledTime = new Date(today);
                scheduledTime.setUTCHours(hours || 0, minutes, 0, 0);
                // If the time has already passed today, schedule for tomorrow
                if (scheduledTime <= now) {
                    scheduledTime.setUTCDate(scheduledTime.getUTCDate() + 1);
                }
                // Check if there's already a scheduled reminder for this goal at this time
                const existingReminder = await db_config_1.prisma.notification.findFirst({
                    where: {
                        userId: goal.userId,
                        goalId: goal.id,
                        type: "goal_reminder",
                        scheduledFor: scheduledTime,
                        sentAt: null,
                    },
                });
                if (!existingReminder) {
                    // Create the reminder
                    await this.createNotification({
                        userId: goal.userId,
                        goalId: goal.id,
                        type: "goal_reminder",
                        title: "Goal Reminder",
                        message: `Time to check in on your goal: ${goal.goalText}`,
                        data: {
                            goalId: goal.id,
                            goalText: goal.goalText,
                        },
                        scheduledFor: scheduledTime,
                    });
                    scheduledCount++;
                    logger_util_1.default.info(`Scheduled reminder for goal ${goal.id} at ${scheduledTime.toISOString()}`);
                }
            }
            // Mark this day's scheduling as completed; TTL slightly over 24h for safety.
            await cache_service_1.cacheService.set(cacheKey, todayKey, 26 * 60 * 60);
            // Record metrics (fire-and-forget)
            metrics_service_1.metricsService
                .record("scheduler_goal_reminders_scheduled", scheduledCount, {
                day: todayKey,
            })
                .catch(() => { });
        }
        catch (error) {
            logger_util_1.default.error("Error scheduling goal reminders:", error);
        }
    }
    /**
     * Schedule lightweight engagement prompts with per-user dedupe windows.
     */
    async scheduleEngagementNotifications() {
        try {
            const now = new Date();
            const dayStart = this.getStartOfUtcDay(now);
            const dayKey = dayStart.toISOString().slice(0, 10);
            const hourKey = now.toISOString().slice(0, 13);
            const cacheKey = "scheduler:engagement:lastRunHour";
            const lastRun = await cache_service_1.cacheService.get(cacheKey);
            if (lastRun === hourKey) {
                return;
            }
            const users = await db_config_1.prisma.user.findMany({
                select: {
                    id: true,
                    username: true,
                    firstName: true,
                },
                take: 500,
            });
            let scheduledCount = 0;
            for (const user of users) {
                const title = this.getRecipientTitle(user, "Vybaa notifications");
                const completedRewindToday = await db_config_1.prisma.rewindSession.findFirst({
                    where: {
                        userId: user.id,
                        completed: true,
                        OR: [
                            { completedAt: { gte: dayStart } },
                            { checkInAt: { gte: dayStart } },
                        ],
                    },
                    select: { id: true },
                });
                if (!completedRewindToday) {
                    const notification = await this.createDedupedSystemNotification({
                        userId: user.id,
                        title,
                        message: "Time to rewind and check in with yourself.",
                        data: { type: "time_to_rewind", route: "/app/rewind" },
                        dedupeKey: `time_to_rewind:${dayKey}`,
                        windowStart: dayStart,
                        scheduledFor: this.getScheduledUtcTime(dayStart, 18, now),
                    });
                    if (notification)
                        scheduledCount++;
                }
                const recentGoals = await db_config_1.prisma.goal.findMany({
                    where: {
                        userId: user.id,
                    },
                    select: { id: true, goalText: true, currentDay: true, targetDays: true },
                    orderBy: { updatedAt: "desc" },
                    take: 10,
                });
                const activeGoal = recentGoals.find((goal) => goal.currentDay < goal.targetDays);
                if (activeGoal) {
                    const notification = await this.createDedupedSystemNotification({
                        userId: user.id,
                        title,
                        message: `Flexx on your friends today: ${activeGoal.goalText}`,
                        data: { type: "flexx_prompt", route: "/app/goal", goalId: activeGoal.id },
                        dedupeKey: `flexx_prompt:${dayKey}`,
                        windowStart: dayStart,
                        scheduledFor: this.getScheduledUtcTime(dayStart, 12, now),
                    });
                    if (notification)
                        scheduledCount++;
                }
                const recentCommunityActivity = await db_config_1.prisma.communityActivity.findFirst({
                    where: {
                        userId: { not: user.id },
                        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
                        community: {
                            members: {
                                some: { userId: user.id },
                            },
                        },
                    },
                    select: {
                        communityId: true,
                        community: { select: { name: true } },
                    },
                    orderBy: { createdAt: "desc" },
                });
                if (recentCommunityActivity) {
                    const notification = await this.createDedupedSystemNotification({
                        userId: user.id,
                        title,
                        message: `See what is going on in ${recentCommunityActivity.community.name}.`,
                        data: {
                            type: "community_activity_prompt",
                            route: `/app/community/${recentCommunityActivity.communityId}#activity`,
                            communityId: recentCommunityActivity.communityId,
                        },
                        dedupeKey: `community_activity:${dayKey}:${recentCommunityActivity.communityId}`,
                        windowStart: dayStart,
                        scheduledFor: this.getScheduledUtcTime(dayStart, 17, now),
                    });
                    if (notification)
                        scheduledCount++;
                }
                const endOfDayNotification = await this.createDedupedSystemNotification({
                    userId: user.id,
                    title,
                    message: "Your end-of-day summary is ready when you are.",
                    data: { type: "end_of_day_summary", route: "/app/home" },
                    dedupeKey: `end_of_day_summary:${dayKey}`,
                    windowStart: dayStart,
                    scheduledFor: this.getScheduledUtcTime(dayStart, 21, now),
                });
                if (endOfDayNotification)
                    scheduledCount++;
                if (now.getUTCDay() === 0) {
                    const weekStart = new Date(dayStart);
                    weekStart.setUTCDate(dayStart.getUTCDate() - 6);
                    const endOfWeekNotification = await this.createDedupedSystemNotification({
                        userId: user.id,
                        title,
                        message: "Your end-of-week summary is ready.",
                        data: { type: "end_of_week_summary", route: "/app/home" },
                        dedupeKey: `end_of_week_summary:${dayKey}`,
                        windowStart: weekStart,
                        scheduledFor: this.getScheduledUtcTime(dayStart, 18, now),
                    });
                    if (endOfWeekNotification)
                        scheduledCount++;
                }
            }
            await cache_service_1.cacheService.set(cacheKey, hourKey, 90 * 60);
            if (scheduledCount > 0) {
                metrics_service_1.metricsService
                    .record("scheduler_engagement_notifications_scheduled", scheduledCount, {
                    hour: hourKey,
                })
                    .catch(() => { });
            }
        }
        catch (error) {
            logger_util_1.default.error("Error scheduling engagement notifications:", error);
        }
    }
    /**
     * Process pending notifications (send scheduled notifications that are due)
     */
    async processPendingNotifications() {
        try {
            const now = new Date();
            // Find notifications scheduled for now or earlier that haven't been sent
            const pendingNotifications = await db_config_1.prisma.notification.findMany({
                where: {
                    scheduledFor: { lte: now },
                    sentAt: null,
                },
                select: {
                    id: true,
                    type: true,
                    goalId: true,
                },
            });
            if (pendingNotifications.length === 0) {
                return;
            }
            // Preload goals for goal_reminder notifications so we can avoid
            // sending reminders after a goal has already been completed today.
            const goalReminderNotifications = pendingNotifications.filter((n) => n.type === "goal_reminder" && n.goalId);
            const goalIds = Array.from(new Set(goalReminderNotifications
                .map((n) => n.goalId)
                .filter((id) => !!id)));
            const goalsById = {};
            if (goalIds.length > 0) {
                const goals = await db_config_1.prisma.goal.findMany({
                    where: { id: { in: goalIds } },
                    select: { id: true, lastCheckInDate: true },
                });
                for (const goal of goals) {
                    goalsById[goal.id] = {
                        lastCheckInDate: goal.lastCheckInDate,
                    };
                }
            }
            const isSameUtcDate = (a, b) => {
                return (a.getUTCFullYear() === b.getUTCFullYear() &&
                    a.getUTCMonth() === b.getUTCMonth() &&
                    a.getUTCDate() === b.getUTCDate());
            };
            let processedCount = 0;
            let skippedBecauseCheckedIn = 0;
            for (const notification of pendingNotifications) {
                // For goal reminders, skip sending if the goal has already been
                // checked in for "today" (UTC date comparison).
                if (notification.type === "goal_reminder" && notification.goalId) {
                    const goal = goalsById[notification.goalId];
                    if (goal?.lastCheckInDate && isSameUtcDate(goal.lastCheckInDate, now)) {
                        // Mark as sent without sending a push/real-time notification,
                        // so it won't be retried again for this cycle.
                        await db_config_1.prisma.notification.update({
                            where: { id: notification.id },
                            data: { sentAt: now },
                        });
                        processedCount++;
                        skippedBecauseCheckedIn++;
                        continue;
                    }
                }
                await this.sendNotification(notification.id);
                processedCount++;
            }
            if (processedCount > 0) {
                logger_util_1.default.info(`Processed ${processedCount} pending notifications`);
            }
            // Record metrics (fire-and-forget)
            if (processedCount > 0) {
                metrics_service_1.metricsService
                    .record("scheduler_notifications_processed", processedCount)
                    .catch(() => { });
            }
            if (skippedBecauseCheckedIn > 0) {
                metrics_service_1.metricsService
                    .record("scheduler_notifications_skipped_already_checked_in", skippedBecauseCheckedIn)
                    .catch(() => { });
            }
        }
        catch (error) {
            logger_util_1.default.error("Error processing pending notifications:", error);
        }
    }
    /**
     * Send goal completed notification
     */
    async sendGoalCompletedNotification(userId, goalId, goalText, communityName) {
        const title = communityName
            ? "Community Goal Completed! 🎉"
            : "Goal Completed!";
        const message = communityName
            ? `Congratulations! You've completed your goal in ${communityName}: ${goalText}`
            : `Congratulations! You've completed your goal: ${goalText}`;
        return this.createNotification({
            userId,
            goalId,
            type: "goal_completed",
            title,
            message,
            data: { goalId, goalText, communityName },
        });
    }
    /**
     * Send streak milestone notification
     */
    async sendStreakMilestoneNotification(userId, goalId, days, goalText, communityName) {
        const points = (0, points_config_1.getStreakMilestonePoints)(days);
        const pointsText = points > 0 ? ` (+${points} Play Points)` : "";
        const message = communityName
            ? `Amazing! You're on a ${days}-day streak in ${communityName} for: ${goalText}${pointsText}`
            : `Amazing! You're on a ${days}-day streak for: ${goalText}${pointsText}`;
        return this.createNotification({
            userId,
            goalId,
            type: "streak_milestone",
            title: `${days}-Day Streak!${pointsText}`,
            message,
            data: { goalId, goalText, days, communityName, points },
        });
    }
    /**
     * Send streak reset notification
     */
    async sendStreakResetNotification(userId, goalId, previousDays, goalText, communityName) {
        const message = communityName
            ? `Your ${previousDays}-day streak in ${communityName} for "${goalText}" was reset due to a missed check-in.`
            : `Your ${previousDays}-day streak for "${goalText}" was reset due to a missed check-in.`;
        return this.createNotification({
            userId,
            goalId,
            type: "system",
            title: "Streak Reset",
            message,
            data: { goalId, goalText, previousDays, resetReason: "missed_checkin", communityName },
        });
    }
    /**
     * Send notification when someone joins a community (notify owner and mods)
     */
    async sendMemberJoinedNotification(communityId, newMemberId, newMemberName, communityName) {
        // Get all owners and mods to notify
        const ownersAndMods = await db_config_1.prisma.communityMember.findMany({
            where: {
                communityId,
                role: { in: ["OWNER", "MOD"] },
                userId: { not: newMemberId }, // Don't notify the person who joined
            },
            select: { userId: true },
        });
        const notifications = ownersAndMods.map((member) => this.createNotification({
            userId: member.userId,
            type: "system",
            title: "New Member Joined",
            message: `${newMemberName} joined ${communityName}`,
            data: { communityId, newMemberId, communityName },
        }));
        await Promise.all(notifications);
    }
    /**
     * Send notification when someone leaves a community (notify owner and mods)
     */
    async sendMemberLeftNotification(communityId, leftMemberId, leftMemberName, communityName) {
        // Get all owners and mods to notify
        const ownersAndMods = await db_config_1.prisma.communityMember.findMany({
            where: {
                communityId,
                role: { in: ["OWNER", "MOD"] },
                userId: { not: leftMemberId }, // Don't notify the person who left
            },
            select: { userId: true },
        });
        const notifications = ownersAndMods.map((member) => this.createNotification({
            userId: member.userId,
            type: "system",
            title: "Member Left",
            message: `${leftMemberName} left ${communityName}`,
            data: { communityId, leftMemberId, communityName },
        }));
        await Promise.all(notifications);
    }
    /**
     * Send notification when a new template is created (notify all members except creator)
     */
    async sendTemplateCreatedNotification(communityId, templateId, templateGoalText, creatorName, communityName, creatorId) {
        // Get all members except the creator
        const members = await db_config_1.prisma.communityMember.findMany({
            where: {
                communityId,
                userId: { not: creatorId }, // Exclude creator
            },
            select: { userId: true },
        });
        const notifications = members
            .filter((member) => member.userId) // Safety check
            .map((member) => this.createNotification({
            userId: member.userId,
            type: "system",
            title: "New Goal Template",
            message: `${creatorName} created a new goal template in ${communityName}: ${templateGoalText}`,
            data: { communityId, templateId, templateGoalText, communityName },
        }));
        await Promise.all(notifications);
    }
    /**
     * Send notification when someone starts a goal from your template
     */
    async sendGoalStartedFromTemplateNotification(templateCreatorId, starterName, templateGoalText, communityName, goalId) {
        return this.createNotification({
            userId: templateCreatorId,
            goalId,
            type: "system",
            title: "Someone Started Your Template",
            message: `${starterName} started a goal from your template "${templateGoalText}" in ${communityName}`,
            data: { goalId, templateGoalText, communityName, starterName },
        });
    }
    /**
     * Send notification when someone reacts to your activity
     */
    async sendActivityReactionNotification(activityOwnerId, reactorName, activityType, communityName, activityId) {
        // Don't notify if user reacted to their own activity
        if (!activityOwnerId)
            return;
        return this.createNotification({
            userId: activityOwnerId,
            type: "system",
            title: "New Reaction",
            message: `${reactorName} reacted to your activity in ${communityName}`,
            data: { activityId, activityType, communityName, reactorName },
        });
    }
    /**
     * Send notification when someone comments on your activity
     */
    async sendActivityCommentNotification(activityOwnerId, commenterName, commentText, communityName, activityId) {
        // Don't notify if user commented on their own activity
        if (!activityOwnerId)
            return;
        const truncatedComment = commentText.length > 50 ? commentText.substring(0, 50) + "..." : commentText;
        return this.createNotification({
            userId: activityOwnerId,
            type: "system",
            title: "New Comment",
            message: `${commenterName} commented on your activity in ${communityName}: "${truncatedComment}"`,
            data: { activityId, commentText, communityName, commenterName },
        });
    }
    /**
     * Send notification when user's role is changed
     */
    async sendRoleChangedNotification(userId, newRole, communityName, changedBy) {
        const roleLabel = newRole === "MOD" ? "moderator" : "member";
        return this.createNotification({
            userId,
            type: "system",
            title: "Role Updated",
            message: `${changedBy} changed your role to ${roleLabel} in ${communityName}`,
            data: { communityId: "", newRole, communityName, changedBy },
        });
    }
    /**
     * Send notification when a community is deleted (notify all members)
     */
    async sendCommunityDeletedNotification(communityId, communityName) {
        const members = await db_config_1.prisma.communityMember.findMany({
            where: { communityId },
            select: { userId: true },
        });
        const notifications = members.map((member) => this.createNotification({
            userId: member.userId,
            type: "system",
            title: "Community Deleted",
            message: `The community "${communityName}" has been deleted`,
            data: { communityId, communityName },
        }));
        await Promise.all(notifications);
    }
    /**
     * Send notification when a template is deleted (notify users who started goals from it)
     */
    async sendTemplateDeletedNotification(templateId, templateGoalText, communityName) {
        // Find all goals started from this template
        const goals = await db_config_1.prisma.goal.findMany({
            where: { templateId },
            select: { userId: true, id: true },
            distinct: ["userId"], // Get unique users
        });
        const notifications = goals.map((goal) => this.createNotification({
            userId: goal.userId,
            goalId: goal.id,
            type: "system",
            title: "Template Deleted",
            message: `The goal template "${templateGoalText}" in ${communityName} has been deleted`,
            data: { templateId, templateGoalText, communityName, goalId: goal.id },
        }));
        await Promise.all(notifications);
    }
    /**
     * Send notification when a milestone is reached
     */
    async sendMilestoneReachedNotification(userId, goalId, milestoneName, points, goalText, communityName) {
        const message = communityName
            ? `You reached the milestone "${milestoneName}" (+${points} pts) in ${communityName} for: ${goalText}`
            : `You reached the milestone "${milestoneName}" (+${points} pts) for: ${goalText}`;
        return this.createNotification({
            userId,
            goalId,
            type: "system",
            title: "Milestone Reached! 🎯",
            message,
            data: { goalId, milestoneName, points, goalText, communityName },
        });
    }
}
exports.notificationService = new NotificationService();
