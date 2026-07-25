"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const node_crypto_1 = require("node:crypto");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const points_config_1 = require("../config/points.config");
const client_app_type_1 = require("../types/client-app.type");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const notification_dedupe_util_1 = require("../utils/notification-dedupe.util");
const cache_service_1 = require("./cache.service");
const metrics_service_1 = require("./metrics.service");
const notification_realtime_service_1 = require("./notification-realtime.service");
const push_notification_service_1 = require("./push-notification.service");
const NOTIFICATION_CLAIM_LEASE_MS = 5 * 60 * 1000;
const FLEXX_DAILY_SEND_CHANCE = 0.55;
const FLEXX_TEMPLATES = [
    {
        message: "Yo ${name}, aren't you flexxing today? Share ${goal} and show them who's boss.",
        title: "Let today show",
    },
    {
        message: "${name}, ${goal} deserves a little spotlight today. Flexx your progress with the people rooting for you.",
        title: "Make your progress visible",
    },
    {
        message: "A small win still counts, ${name}. Give ${goal} its moment on Flexx today.",
        title: "Your win belongs out loud",
    },
];
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseNotificationData(value) {
    if (!value)
        return undefined;
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
class NotificationService {
    getStartOfUtcDay(date) {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    }
    getScheduledUtcTime(dayStart, hour, now) {
        const scheduledFor = new Date(dayStart);
        scheduledFor.setUTCHours(hour, 0, 0, 0);
        return scheduledFor <= now ? now : scheduledFor;
    }
    getSharedFcmTokenPrefix(user) {
        return `[${user.username || user.firstName || "user"}]`;
    }
    getDeterministicRatio(seed) {
        const hash = (0, node_crypto_1.createHash)("sha256").update(seed).digest();
        return hash.readUInt32BE(0) / 0xffffffff;
    }
    getLocalFlexxSchedule(params) {
        const day = luxon_1.DateTime.fromFormat(params.dayKey, "yyyy-LL-dd", {
            zone: params.timezone,
        }).startOf("day");
        const hour = 11 +
            Math.floor(this.getDeterministicRatio(`${params.userId}:${params.dayKey}:hour`) *
                8);
        const minute = Math.floor(this.getDeterministicRatio(`${params.userId}:${params.dayKey}:minute`) *
            60);
        const templateIndex = Math.min(FLEXX_TEMPLATES.length - 1, Math.floor(this.getDeterministicRatio(`${params.userId}:${params.dayKey}:template`) * FLEXX_TEMPLATES.length));
        return {
            scheduledFor: day.set({ hour, minute }).toUTC().toJSDate(),
            templateIndex,
        };
    }
    getFcmTargetKey(target) {
        return `${target.clientApp}:${target.token}`;
    }
    getFcmTargets(user) {
        const targets = new Map();
        for (const token of user.fcmTokens) {
            if (!token)
                continue;
            const target = { clientApp: "vybaa", token };
            targets.set(this.getFcmTargetKey(target), target);
        }
        for (const device of user.fcmDevices) {
            if (!device.token)
                continue;
            const target = {
                clientApp: (0, client_app_type_1.fromPrismaClientApp)(device.clientApp),
                token: device.token,
            };
            targets.set(this.getFcmTargetKey(target), target);
        }
        return [...targets.values()];
    }
    async getSharedFcmTargetsByUser(notifications) {
        const allTargetKeys = new Set();
        for (const notification of notifications) {
            for (const target of this.getFcmTargets(notification.user)) {
                allTargetKeys.add(this.getFcmTargetKey(target));
            }
        }
        if (!allTargetKeys.size)
            return new Map();
        const users = await db_config_1.prisma.user.findMany({
            where: {
                OR: [
                    {
                        fcmTokens: {
                            hasSome: notifications.flatMap((notification) => notification.user.fcmTokens),
                        },
                    },
                    {
                        fcmDevices: {
                            some: {
                                token: {
                                    in: notifications.flatMap((notification) => notification.user.fcmDevices.map((device) => device.token)),
                                },
                            },
                        },
                    },
                ],
            },
            select: {
                fcmDevices: { select: { clientApp: true, token: true } },
                fcmTokens: true,
                id: true,
            },
        });
        const targetOwnerIds = new Map();
        for (const user of users) {
            const targets = this.getFcmTargets(user);
            for (const target of targets) {
                const key = this.getFcmTargetKey(target);
                if (!allTargetKeys.has(key))
                    continue;
                const ownerIds = targetOwnerIds.get(key) ?? new Set();
                ownerIds.add(user.id);
                targetOwnerIds.set(key, ownerIds);
            }
        }
        const sharedByUser = new Map();
        for (const notification of notifications) {
            const sharedTargetKeys = new Set();
            for (const target of this.getFcmTargets(notification.user)) {
                const key = this.getFcmTargetKey(target);
                if ((targetOwnerIds.get(key)?.size ?? 0) > 1) {
                    sharedTargetKeys.add(key);
                }
            }
            sharedByUser.set(notification.userId, sharedTargetKeys);
        }
        return sharedByUser;
    }
    async createDedupedSystemNotification(params) {
        return this.createNotification({
            userId: params.userId,
            type: "system",
            title: params.title,
            message: params.message,
            data: params.data,
            dedupeKey: params.dedupeKey,
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
                    dedupeKey: data.dedupeKey,
                    scheduledFor: data.scheduledFor ?? new Date(),
                    sentAt: null,
                },
            });
            // If not scheduled, send immediately
            if (!data.scheduledFor) {
                await this.sendNotification(notification.id);
            }
            return notification;
        }
        catch (error) {
            if ((0, notification_dedupe_util_1.isNotificationDedupeConflict)(error, data.dedupeKey)) {
                return null;
            }
            logger_util_1.default.error("Error creating notification", {
                errorName: error instanceof Error ? error.name : "UnknownError",
                notificationType: data.type,
                userId: data.userId,
            });
            throw error;
        }
    }
    async claimNotifications(notificationIds) {
        const uniqueIds = [...new Set(notificationIds)];
        if (!uniqueIds.length)
            return null;
        const dispatchToken = (0, node_crypto_1.randomUUID)();
        const claimedAt = new Date();
        const expiredLease = new Date(claimedAt.getTime() - NOTIFICATION_CLAIM_LEASE_MS);
        const result = await db_config_1.prisma.notification.updateMany({
            where: {
                id: { in: uniqueIds },
                sentAt: null,
                OR: [{ dispatchingAt: null }, { dispatchingAt: { lt: expiredLease } }],
            },
            data: {
                dispatchToken,
                dispatchingAt: claimedAt,
                deliveryAttempts: { increment: 1 },
            },
        });
        if (!result.count)
            return null;
        const notifications = await db_config_1.prisma.notification.findMany({
            where: { dispatchToken },
            orderBy: { createdAt: "asc" },
            include: {
                user: {
                    select: {
                        fcmDevices: { select: { clientApp: true, token: true } },
                        fcmTokens: true,
                        firstName: true,
                        username: true,
                    },
                },
            },
        });
        return { dispatchToken, notifications };
    }
    async releaseNotificationClaim(dispatchToken) {
        await db_config_1.prisma.notification.updateMany({
            where: { dispatchToken, sentAt: null },
            data: { dispatchToken: null, dispatchingAt: null },
        });
    }
    async markNotificationsDelivered(dispatchToken) {
        await db_config_1.prisma.notification.updateMany({
            where: { dispatchToken, sentAt: null },
            data: {
                dispatchToken: null,
                dispatchingAt: null,
                sentAt: new Date(),
            },
        });
    }
    toPayload(notification) {
        return {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            data: parseNotificationData(notification.data),
            createdAt: notification.createdAt.toISOString(),
        };
    }
    async dispatchNotificationBatch(notificationIds) {
        const claim = await this.claimNotifications(notificationIds);
        if (!claim?.notifications.length)
            return 0;
        try {
            const sharedTargetsByUser = await this.getSharedFcmTargetsByUser(claim.notifications);
            const pushMessages = [];
            const realtimeSignals = [];
            for (const notification of claim.notifications) {
                const payload = this.toPayload(notification);
                const sharedTargetKeys = sharedTargetsByUser.get(notification.userId) ?? new Set();
                const titlePrefix = this.getSharedFcmTokenPrefix(notification.user);
                for (const target of this.getFcmTargets(notification.user)) {
                    const targetKey = this.getFcmTargetKey(target);
                    pushMessages.push({
                        clientApp: target.clientApp,
                        token: target.token,
                        title: sharedTargetKeys.has(targetKey)
                            ? `${titlePrefix} ${notification.title}`
                            : notification.title,
                        body: notification.message,
                        payload,
                        silent: false,
                    });
                }
                realtimeSignals.push({ notification, payload });
            }
            if (pushMessages.length) {
                await push_notification_service_1.pushNotificationService.sendFCMBatchMessages(pushMessages);
            }
            await this.markNotificationsDelivered(claim.dispatchToken);
            for (const realtimeSignal of realtimeSignals) {
                notification_realtime_service_1.notificationRealtimePublisher.enqueue(realtimeSignal.notification.userId, realtimeSignal.payload);
            }
            logger_util_1.default.info("Notification batch delivered", {
                notifications: claim.notifications.length,
                pushMessages: pushMessages.length,
                realtimeSignals: realtimeSignals.length,
            });
            return claim.notifications.length;
        }
        catch (error) {
            await this.releaseNotificationClaim(claim.dispatchToken);
            logger_util_1.default.error("Notification batch delivery failed", {
                errorName: error instanceof Error ? error.name : "UnknownError",
                notifications: claim.notifications.length,
            });
            throw error;
        }
    }
    async sendNotification(notificationId) {
        const delivered = await this.dispatchNotificationBatch([notificationId]);
        if (!delivered) {
            logger_util_1.default.debug("Notification was already claimed or delivered", {
                notificationId,
            });
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
                    timezone: true,
                },
                take: 500,
            });
            let scheduledCount = 0;
            for (const user of users) {
                const recentGoals = await db_config_1.prisma.goal.findMany({
                    where: {
                        userId: user.id,
                    },
                    select: {
                        id: true,
                        goalText: true,
                        currentDay: true,
                        targetDays: true,
                    },
                    orderBy: { updatedAt: "desc" },
                    take: 10,
                });
                const activeGoal = recentGoals.find((goal) => goal.currentDay < goal.targetDays);
                if (activeGoal) {
                    const timezone = luxon_1.DateTime.now().setZone(user.timezone).isValid
                        ? user.timezone
                        : "UTC";
                    const localDayKey = luxon_1.DateTime.fromJSDate(now, {
                        zone: timezone,
                    }).toFormat("yyyy-LL-dd");
                    const shouldSendFlexx = this.getDeterministicRatio(`${user.id}:${localDayKey}:flexx-decision`) < FLEXX_DAILY_SEND_CHANCE;
                    const flexxSchedule = this.getLocalFlexxSchedule({
                        dayKey: localDayKey,
                        timezone,
                        userId: user.id,
                    });
                    if (shouldSendFlexx && flexxSchedule.scheduledFor > now) {
                        const template = FLEXX_TEMPLATES[flexxSchedule.templateIndex];
                        const name = user.firstName || user.username || "there";
                        const message = template.message
                            .replace("${name}", name)
                            .replace("${goal}", activeGoal.goalText);
                        const notification = await this.createDedupedSystemNotification({
                            userId: user.id,
                            title: template.title,
                            message,
                            data: {
                                type: "flexx_prompt",
                                route: "/app/actions/flexx",
                                goalId: activeGoal.id,
                            },
                            dedupeKey: `flexx_prompt:${localDayKey}`,
                            scheduledFor: flexxSchedule.scheduledFor,
                        });
                        if (notification)
                            scheduledCount++;
                    }
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
                        title: "Community Update",
                        message: `See what is going on in ${recentCommunityActivity.community.name}.`,
                        data: {
                            type: "community_activity_prompt",
                            route: `/app/community/${recentCommunityActivity.communityId}#activity`,
                            communityId: recentCommunityActivity.communityId,
                        },
                        dedupeKey: `community_activity:${dayKey}:${recentCommunityActivity.communityId}`,
                        scheduledFor: this.getScheduledUtcTime(dayStart, 17, now),
                    });
                    if (notification)
                        scheduledCount++;
                }
                const endOfDayNotification = await this.createDedupedSystemNotification({
                    userId: user.id,
                    title: "End-of-Day Summary",
                    message: "Your end-of-day summary is ready when you are.",
                    data: { type: "end_of_day_summary", route: "/app/home" },
                    dedupeKey: `end_of_day_summary:${dayKey}`,
                    scheduledFor: this.getScheduledUtcTime(dayStart, 21, now),
                });
                if (endOfDayNotification)
                    scheduledCount++;
                if (now.getUTCDay() === 0) {
                    const endOfWeekNotification = await this.createDedupedSystemNotification({
                        userId: user.id,
                        title: "Weekly Summary",
                        message: "Your end-of-week summary is ready.",
                        data: { type: "end_of_week_summary", route: "/app/home" },
                        dedupeKey: `end_of_week_summary:${dayKey}`,
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
                orderBy: { scheduledFor: "asc" },
                take: 500,
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
            const skippedNotificationIds = [];
            const deliverableNotificationIds = [];
            for (const notification of pendingNotifications) {
                // For goal reminders, skip sending if the goal has already been
                // checked in for "today" (UTC date comparison).
                if (notification.type === "goal_reminder" && notification.goalId) {
                    const goal = goalsById[notification.goalId];
                    if (goal?.lastCheckInDate &&
                        isSameUtcDate(goal.lastCheckInDate, now)) {
                        skippedNotificationIds.push(notification.id);
                        continue;
                    }
                }
                deliverableNotificationIds.push(notification.id);
            }
            if (skippedNotificationIds.length) {
                await db_config_1.prisma.notification.updateMany({
                    where: { id: { in: skippedNotificationIds }, sentAt: null },
                    data: { sentAt: now },
                });
            }
            const deliveredCount = await this.dispatchNotificationBatch(deliverableNotificationIds);
            const skippedBecauseCheckedIn = skippedNotificationIds.length;
            const processedCount = deliveredCount + skippedBecauseCheckedIn;
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
            data: {
                goalId,
                goalText,
                previousDays,
                resetReason: "missed_checkin",
                communityName,
            },
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
        const truncatedComment = commentText.length > 50
            ? commentText.substring(0, 50) + "..."
            : commentText;
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
