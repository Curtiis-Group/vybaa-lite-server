import { getAblyClient } from "../config/ably.config";
import { prisma } from "../config/db.config";
import logger from "../utils/logger.util";
import { pushNotificationService } from "./push-notification.service";

export interface CreateNotificationData {
  userId: string;
  goalId?: string;
  type: "goal_reminder" | "goal_completed" | "streak_milestone" | "system";
  title: string;
  message: string;
  data?: any;
  scheduledFor?: Date;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: any;
  createdAt: string;
}

class NotificationService {
  private ablyClient;

  constructor() {
    this.ablyClient = getAblyClient();
  }

  /**
   * Create a notification in the database
   */
  async createNotification(data: CreateNotificationData) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: data.userId,
          goalId: data.goalId!,
          type: data.type,
          title: data.title,
          message: data.message,
          data: data.data ? JSON.stringify(data.data) : null,
          scheduledFor: data.scheduledFor!,
          sentAt: data.scheduledFor ? null : new Date(), // If no schedule, mark as sent immediately
        },
      });

      // If not scheduled, send immediately
      if (!data.scheduledFor) {
        await this.sendNotification(notification.id);
      }

      return notification;
    } catch (error) {
      logger.error("Error creating notification:", error);
      throw error;
    }
  }

  /**
   * Send a notification via Ably and FCM
   */
  async sendNotification(notificationId: string) {
    try {
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
        include: {
          user: {
            select: { fcmTokens: true },
          },
        },
      });

      if (!notification) {
        logger.warn(`Notification ${notificationId} not found`);
        return;
      }

      // Create channel for user
      const channel = this.ablyClient.channels.get(`user:${notification.userId}`);

      // Prepare payload
      const payload: NotificationPayload = {
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
          await pushNotificationService.sendFCMMulticast(
            notification.user.fcmTokens,
            notification.title,
            notification.message,
            payload,
            false
          );
        } catch (fcmError) {
          logger.error("Error sending FCM push:", fcmError);
          // Don't fail the entire notification if FCM fails
        }
      }

      // Mark as sent
      await prisma.notification.update({
        where: { id: notificationId },
        data: { sentAt: new Date() },
      });

      logger.info(`Notification ${notificationId} sent to user ${notification.userId}`);
    } catch (error) {
      logger.error(`Error sending notification ${notificationId}:`, error);
      throw error;
    }
  }

  /**
   * Get all notifications for a user
   */
  async getUserNotifications(userId: string, limit: number = 50, page: number = 1) {
    const skip = (page - 1) * limit;

    const [notifications, totalCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      prisma.notification.count({ where: { userId } }),
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
  async getUnreadCount(userId: string) {
    return prisma.notification.count({
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
  async markAsRead(notificationId: string, userId: string) {
    return prisma.notification.updateMany({
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
  async markAllAsRead(userId: string) {
    return prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, userId: string) {
    return prisma.notification.deleteMany({
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
      const goals = await prisma.goal.findMany({
        where: {
          reminderTime: { not: null },
        },
        include: {
          user: true,
        },
      });

      const now = new Date();
      // Use UTC date to avoid timezone issues
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

      for (const goal of goals) {
        if (!goal.reminderTime) continue;

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
        const existingReminder = await prisma.notification.findFirst({
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

          logger.info(`Scheduled reminder for goal ${goal.id} at ${scheduledTime.toISOString()}`);
        }
      }
    } catch (error) {
      logger.error("Error scheduling goal reminders:", error);
    }
  }

  /**
   * Process pending notifications (send scheduled notifications that are due)
   */
  async processPendingNotifications() {
    try {
      const now = new Date();

      // Find notifications scheduled for now or earlier that haven't been sent
      const pendingNotifications = await prisma.notification.findMany({
        where: {
          scheduledFor: { lte: now },
          sentAt: null,
        },
      });

      for (const notification of pendingNotifications) {
        await this.sendNotification(notification.id);
      }

      if (pendingNotifications.length > 0) {
        logger.info(`Processed ${pendingNotifications.length} pending notifications`);
      }
    } catch (error) {
      logger.error("Error processing pending notifications:", error);
    }
  }

  /**
   * Send goal completed notification
   */
  async sendGoalCompletedNotification(userId: string, goalId: string, goalText: string) {
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
  async sendStreakMilestoneNotification(userId: string, goalId: string, days: number, goalText: string) {
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
  async sendStreakResetNotification(userId: string, goalId: string, previousDays: number, goalText: string) {
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

export const notificationService = new NotificationService();
