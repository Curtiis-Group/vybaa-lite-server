import { getAblyClient } from "../config/ably.config";
import { prisma } from "../config/db.config";
import logger from "../utils/logger.util";
import { cacheService } from "./cache.service";
import { metricsService } from "./metrics.service";
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
      // Ensure we only run the heavy scheduling logic once per UTC day.
      const now = new Date();
      const todayKey = now.toISOString().split("T")[0]; // YYYY-MM-DD (UTC)
      const cacheKey = "scheduler:goalReminders:lastRunDate";

      const lastRun = await cacheService.get<string>(cacheKey);
      if (lastRun === todayKey) {
        // Already scheduled for today; skip DB work.
        return;
      }

      const goals = await prisma.goal.findMany({
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

          scheduledCount++;
          logger.info(
            `Scheduled reminder for goal ${goal.id} at ${scheduledTime.toISOString()}`,
          );
        }
      }

      // Mark this day's scheduling as completed; TTL slightly over 24h for safety.
      await cacheService.set(cacheKey, todayKey, 26 * 60 * 60);

      // Record metrics (fire-and-forget)
      metricsService
        .record("scheduler_goal_reminders_scheduled", scheduledCount, {
          day: todayKey!,
        })
        .catch(() => {});
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
      const goalReminderNotifications = pendingNotifications.filter(
        (n) => n.type === "goal_reminder" && n.goalId,
      );

      const goalIds = Array.from(
        new Set(
          goalReminderNotifications
            .map((n) => n.goalId)
            .filter((id): id is string => !!id),
        ),
      );

      const goalsById: Record<string, { lastCheckInDate: Date | null }> = {};

      if (goalIds.length > 0) {
        const goals = await prisma.goal.findMany({
          where: { id: { in: goalIds } },
          select: { id: true, lastCheckInDate: true },
        });

        for (const goal of goals) {
          goalsById[goal.id] = {
            lastCheckInDate: goal.lastCheckInDate,
          };
        }
      }

      const isSameUtcDate = (a: Date, b: Date) => {
        return (
          a.getUTCFullYear() === b.getUTCFullYear() &&
          a.getUTCMonth() === b.getUTCMonth() &&
          a.getUTCDate() === b.getUTCDate()
        );
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
            await prisma.notification.update({
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
        logger.info(`Processed ${processedCount} pending notifications`);
      }

      // Record metrics (fire-and-forget)
      if (processedCount > 0) {
        metricsService
          .record("scheduler_notifications_processed", processedCount)
          .catch(() => {});
      }
      if (skippedBecauseCheckedIn > 0) {
        metricsService
          .record(
            "scheduler_notifications_skipped_already_checked_in",
            skippedBecauseCheckedIn,
          )
          .catch(() => {});
      }
    } catch (error) {
      logger.error("Error processing pending notifications:", error);
    }
  }

  /**
   * Send goal completed notification
   */
  async sendGoalCompletedNotification(userId: string, goalId: string, goalText: string, communityName?: string) {
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
  async sendStreakMilestoneNotification(userId: string, goalId: string, days: number, goalText: string, communityName?: string) {
    const message = communityName
      ? `Amazing! You're on a ${days}-day streak in ${communityName} for: ${goalText}`
      : `Amazing! You're on a ${days}-day streak for: ${goalText}`;
    
    return this.createNotification({
      userId,
      goalId,
      type: "streak_milestone",
      title: `${days}-Day Streak!`,
      message,
      data: { goalId, goalText, days, communityName },
    });
  }

  /**
   * Send streak reset notification
   */
  async sendStreakResetNotification(userId: string, goalId: string, previousDays: number, goalText: string, communityName?: string) {
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
}

export const notificationService = new NotificationService();
