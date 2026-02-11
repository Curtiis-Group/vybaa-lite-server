"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = void 0;
const ably_config_1 = require("../config/ably.config");
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const push_notification_service_1 = require("./push-notification.service");
class NotificationService {
    constructor() {
        this.ablyClient = (0, ably_config_1.getAblyClient)();
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
            const goals = await db_config_1.prisma.goal.findMany({
                where: {
                    reminderTime: { not: null },
                },
                include: {
                    user: true,
                },
            });
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            for (const goal of goals) {
                if (!goal.reminderTime)
                    continue;
                // Parse reminder time (format: "HH:MM")
                const [hours, minutes] = goal.reminderTime.split(":").map(Number);
                // Calculate scheduled time for today
                const scheduledTime = new Date(today);
                scheduledTime.setHours(hours || 0, minutes, 0, 0);
                // If the time has already passed today, schedule for tomorrow
                if (scheduledTime <= now) {
                    scheduledTime.setDate(scheduledTime.getDate() + 1);
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
                    logger_util_1.default.info(`Scheduled reminder for goal ${goal.id} at ${scheduledTime.toISOString()}`);
                }
            }
        }
        catch (error) {
            logger_util_1.default.error("Error scheduling goal reminders:", error);
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
            });
            for (const notification of pendingNotifications) {
                await this.sendNotification(notification.id);
            }
            if (pendingNotifications.length > 0) {
                logger_util_1.default.info(`Processed ${pendingNotifications.length} pending notifications`);
            }
        }
        catch (error) {
            logger_util_1.default.error("Error processing pending notifications:", error);
        }
    }
    /**
     * Send goal completed notification
     */
    async sendGoalCompletedNotification(userId, goalId, goalText) {
        return this.createNotification({
            userId,
            goalId,
            type: "goal_completed",
            title: "Goal Completed!",
            message: `Congratulations! You've completed your goal: ${goalText}`,
            data: { goalId, goalText },
        });
    }
    /**
     * Send streak milestone notification
     */
    async sendStreakMilestoneNotification(userId, goalId, days, goalText) {
        return this.createNotification({
            userId,
            goalId,
            type: "streak_milestone",
            title: `${days}-Day Streak!`,
            message: `Amazing! You're on a ${days}-day streak for: ${goalText}`,
            data: { goalId, goalText, days },
        });
    }
    /**
     * Send streak reset notification
     */
    async sendStreakResetNotification(userId, goalId, previousDays, goalText) {
        return this.createNotification({
            userId,
            goalId,
            type: "system",
            title: "Streak Reset",
            message: `Your ${previousDays}-day streak for "${goalText}" was reset due to a missed check-in.`,
            data: { goalId, goalText, previousDays, resetReason: "missed_checkin" },
        });
    }
}
exports.notificationService = new NotificationService();
