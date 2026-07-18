import { randomUUID } from "node:crypto";
import { getAblyClient } from "../config/ably.config";
import { prisma } from "../config/db.config";
import { getStreakMilestonePoints } from "../config/points.config";
import logger from "../utils/logger.util";
import { isNotificationDedupeConflict } from "../utils/notification-dedupe.util";
import { cacheService } from "./cache.service";
import { metricsService } from "./metrics.service";
import { pushNotificationService } from "./push-notification.service";

export interface CreateNotificationData {
  userId: string;
  goalId?: string;
  type: "goal_reminder" | "goal_completed" | "streak_milestone" | "system";
  title: string;
  message: string;
  data?: Record<string, unknown>;
  dedupeKey?: string;
  scheduledFor?: Date;
}

export interface NotificationPayload extends Record<string, unknown> {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

type DeliverableNotification = {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  data: string | null;
  createdAt: Date;
  user: {
    fcmTokens: string[];
    firstName: string | null;
    username: string | null;
  };
};

type NotificationClaim = {
  dispatchToken: string;
  notifications: DeliverableNotification[];
};

const NOTIFICATION_CLAIM_LEASE_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNotificationData(
  value: string | null,
): Record<string, unknown> | undefined {
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

class NotificationService {
  private ablyClient;

  constructor() {
    this.ablyClient = getAblyClient();
  }

  private getStartOfUtcDay(date: Date) {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private getScheduledUtcTime(dayStart: Date, hour: number, now: Date) {
    const scheduledFor = new Date(dayStart);
    scheduledFor.setUTCHours(hour, 0, 0, 0);
    return scheduledFor <= now ? now : scheduledFor;
  }

  private getSharedFcmTokenPrefix(user: {
    username: string | null;
    firstName: string | null;
  }) {
    return `[${user.username || user.firstName || "user"}]`;
  }

  private async getSharedFcmTokensByUser(
    notifications: DeliverableNotification[],
  ): Promise<Map<string, Set<string>>> {
    const allTokens = new Set<string>();
    for (const notification of notifications) {
      for (const token of notification.user.fcmTokens) {
        if (token) allTokens.add(token);
      }
    }
    if (!allTokens.size) return new Map();

    const users = await prisma.user.findMany({
      where: { fcmTokens: { hasSome: [...allTokens] } },
      select: { id: true, fcmTokens: true },
    });
    const tokenOwnerIds = new Map<string, Set<string>>();
    for (const user of users) {
      for (const token of new Set(user.fcmTokens)) {
        if (!allTokens.has(token)) continue;
        const ownerIds = tokenOwnerIds.get(token) ?? new Set<string>();
        ownerIds.add(user.id);
        tokenOwnerIds.set(token, ownerIds);
      }
    }

    const sharedByUser = new Map<string, Set<string>>();
    for (const notification of notifications) {
      const sharedTokens = new Set<string>();
      for (const token of new Set(notification.user.fcmTokens)) {
        if ((tokenOwnerIds.get(token)?.size ?? 0) > 1) {
          sharedTokens.add(token);
        }
      }
      sharedByUser.set(notification.userId, sharedTokens);
    }
    return sharedByUser;
  }

  private async createDedupedSystemNotification(params: {
    userId: string;
    title: string;
    message: string;
    data: Record<string, unknown>;
    dedupeKey: string;
    scheduledFor?: Date;
  }) {
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
  async createNotification(data: CreateNotificationData) {
    try {
      const notification = await prisma.notification.create({
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
    } catch (error) {
      if (isNotificationDedupeConflict(error, data.dedupeKey)) {
        return null;
      }

      logger.error("Error creating notification", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        notificationType: data.type,
        userId: data.userId,
      });
      throw error;
    }
  }

  private async claimNotifications(
    notificationIds: string[],
  ): Promise<NotificationClaim | null> {
    const uniqueIds = [...new Set(notificationIds)];
    if (!uniqueIds.length) return null;

    const dispatchToken = randomUUID();
    const claimedAt = new Date();
    const expiredLease = new Date(
      claimedAt.getTime() - NOTIFICATION_CLAIM_LEASE_MS,
    );
    const result = await prisma.notification.updateMany({
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
    if (!result.count) return null;

    const notifications = await prisma.notification.findMany({
      where: { dispatchToken },
      include: {
        user: {
          select: { fcmTokens: true, firstName: true, username: true },
        },
      },
    });
    return { dispatchToken, notifications };
  }

  private async releaseNotificationClaim(dispatchToken: string): Promise<void> {
    await prisma.notification.updateMany({
      where: { dispatchToken, sentAt: null },
      data: { dispatchToken: null, dispatchingAt: null },
    });
  }

  private async markNotificationsDelivered(
    dispatchToken: string,
  ): Promise<void> {
    await prisma.notification.updateMany({
      where: { dispatchToken, sentAt: null },
      data: {
        dispatchToken: null,
        dispatchingAt: null,
        sentAt: new Date(),
      },
    });
  }

  private toPayload(
    notification: DeliverableNotification,
  ): NotificationPayload {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: parseNotificationData(notification.data),
      createdAt: notification.createdAt.toISOString(),
    };
  }

  private async dispatchNotificationBatch(
    notificationIds: string[],
  ): Promise<number> {
    const claim = await this.claimNotifications(notificationIds);
    if (!claim?.notifications.length) return 0;

    try {
      const sharedTokensByUser = await this.getSharedFcmTokensByUser(
        claim.notifications,
      );
      const pushMessages: Array<{
        token: string;
        title: string;
        body: string;
        payload: Record<string, unknown>;
        silent: boolean;
      }> = [];
      const ablyPublishes = claim.notifications.map(async (notification) => {
        const payload = this.toPayload(notification);
        const sharedTokens =
          sharedTokensByUser.get(notification.userId) ?? new Set<string>();
        const titlePrefix = this.getSharedFcmTokenPrefix(notification.user);

        for (const token of new Set(notification.user.fcmTokens)) {
          if (!token) continue;
          pushMessages.push({
            token,
            title: sharedTokens.has(token)
              ? `${titlePrefix} ${notification.title}`
              : notification.title,
            body: notification.message,
            payload,
            silent: false,
          });
        }

        const channel = this.ablyClient.channels.get(
          `user:${notification.userId}`,
        );
        return channel.publish("notification", payload);
      });
      const ablyResults = await Promise.allSettled(ablyPublishes);
      const ablyFailures = ablyResults.filter(
        (result) => result.status === "rejected",
      ).length;
      if (ablyFailures) {
        logger.warn("Notification realtime batch had failures", {
          attempted: ablyResults.length,
          failed: ablyFailures,
        });
      }

      if (pushMessages.length) {
        await pushNotificationService.sendFCMBatchMessages(pushMessages);
      }

      await this.markNotificationsDelivered(claim.dispatchToken);
      logger.info("Notification batch delivered", {
        notifications: claim.notifications.length,
        pushMessages: pushMessages.length,
      });
      return claim.notifications.length;
    } catch (error) {
      await this.releaseNotificationClaim(claim.dispatchToken);
      logger.error("Notification batch delivery failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        notifications: claim.notifications.length,
      });
      throw error;
    }
  }

  async sendNotification(notificationId: string): Promise<void> {
    const delivered = await this.dispatchNotificationBatch([notificationId]);
    if (!delivered) {
      logger.debug("Notification was already claimed or delivered", {
        notificationId,
      });
    }
  }

  /**
   * Get all notifications for a user
   */
  async getUserNotifications(
    userId: string,
    limit: number = 50,
    page: number = 1,
  ) {
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
      const today = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );

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
   * Schedule lightweight engagement prompts with per-user dedupe windows.
   */
  async scheduleEngagementNotifications() {
    try {
      const now = new Date();
      const dayStart = this.getStartOfUtcDay(now);
      const dayKey = dayStart.toISOString().slice(0, 10);
      const hourKey = now.toISOString().slice(0, 13);
      const cacheKey = "scheduler:engagement:lastRunHour";

      const lastRun = await cacheService.get<string>(cacheKey);
      if (lastRun === hourKey) {
        return;
      }

      const users = await prisma.user.findMany({
        select: {
          id: true,
          username: true,
          firstName: true,
        },
        take: 500,
      });

      let scheduledCount = 0;

      for (const user of users) {
        const completedRewindToday = await prisma.rewindSession.findFirst({
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
            title: "Time to Rewind",
            message: "Time to rewind and check in with yourself.",
            data: { type: "time_to_rewind", route: "/app/rewind" },
            dedupeKey: `time_to_rewind:${dayKey}`,
            scheduledFor: this.getScheduledUtcTime(dayStart, 18, now),
          });
          if (notification) scheduledCount++;
        }

        const recentGoals = await prisma.goal.findMany({
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
        const activeGoal = recentGoals.find(
          (goal) => goal.currentDay < goal.targetDays,
        );

        if (activeGoal) {
          const notification = await this.createDedupedSystemNotification({
            userId: user.id,
            title: "Flexx Check-in",
            message: `Flexx on your friends today: ${activeGoal.goalText}`,
            data: {
              type: "flexx_prompt",
              route: "/app/goal",
              goalId: activeGoal.id,
            },
            dedupeKey: `flexx_prompt:${dayKey}`,
            scheduledFor: this.getScheduledUtcTime(dayStart, 12, now),
          });
          if (notification) scheduledCount++;
        }

        const recentCommunityActivity =
          await prisma.communityActivity.findFirst({
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
          if (notification) scheduledCount++;
        }

        const endOfDayNotification = await this.createDedupedSystemNotification(
          {
            userId: user.id,
            title: "End-of-Day Summary",
            message: "Your end-of-day summary is ready when you are.",
            data: { type: "end_of_day_summary", route: "/app/home" },
            dedupeKey: `end_of_day_summary:${dayKey}`,
            scheduledFor: this.getScheduledUtcTime(dayStart, 21, now),
          },
        );
        if (endOfDayNotification) scheduledCount++;

        if (now.getUTCDay() === 0) {
          const endOfWeekNotification =
            await this.createDedupedSystemNotification({
              userId: user.id,
              title: "Weekly Summary",
              message: "Your end-of-week summary is ready.",
              data: { type: "end_of_week_summary", route: "/app/home" },
              dedupeKey: `end_of_week_summary:${dayKey}`,
              scheduledFor: this.getScheduledUtcTime(dayStart, 18, now),
            });
          if (endOfWeekNotification) scheduledCount++;
        }
      }

      await cacheService.set(cacheKey, hourKey, 90 * 60);

      if (scheduledCount > 0) {
        metricsService
          .record(
            "scheduler_engagement_notifications_scheduled",
            scheduledCount,
            {
              hour: hourKey,
            },
          )
          .catch(() => {});
      }
    } catch (error) {
      logger.error("Error scheduling engagement notifications:", error);
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
        orderBy: { scheduledFor: "asc" },
        take: 500,
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

      const skippedNotificationIds: string[] = [];
      const deliverableNotificationIds: string[] = [];

      for (const notification of pendingNotifications) {
        // For goal reminders, skip sending if the goal has already been
        // checked in for "today" (UTC date comparison).
        if (notification.type === "goal_reminder" && notification.goalId) {
          const goal = goalsById[notification.goalId];
          if (
            goal?.lastCheckInDate &&
            isSameUtcDate(goal.lastCheckInDate, now)
          ) {
            skippedNotificationIds.push(notification.id);
            continue;
          }
        }

        deliverableNotificationIds.push(notification.id);
      }

      if (skippedNotificationIds.length) {
        await prisma.notification.updateMany({
          where: { id: { in: skippedNotificationIds }, sentAt: null },
          data: { sentAt: now },
        });
      }

      const deliveredCount = await this.dispatchNotificationBatch(
        deliverableNotificationIds,
      );
      const skippedBecauseCheckedIn = skippedNotificationIds.length;
      const processedCount = deliveredCount + skippedBecauseCheckedIn;

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
  async sendGoalCompletedNotification(
    userId: string,
    goalId: string,
    goalText: string,
    communityName?: string,
  ) {
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
  async sendStreakMilestoneNotification(
    userId: string,
    goalId: string,
    days: number,
    goalText: string,
    communityName?: string,
  ) {
    const points = getStreakMilestonePoints(days);
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
  async sendStreakResetNotification(
    userId: string,
    goalId: string,
    previousDays: number,
    goalText: string,
    communityName?: string,
  ) {
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
  async sendMemberJoinedNotification(
    communityId: string,
    newMemberId: string,
    newMemberName: string,
    communityName: string,
  ) {
    // Get all owners and mods to notify
    const ownersAndMods = await prisma.communityMember.findMany({
      where: {
        communityId,
        role: { in: ["OWNER", "MOD"] },
        userId: { not: newMemberId }, // Don't notify the person who joined
      },
      select: { userId: true },
    });

    const notifications = ownersAndMods.map((member) =>
      this.createNotification({
        userId: member.userId,
        type: "system",
        title: "New Member Joined",
        message: `${newMemberName} joined ${communityName}`,
        data: { communityId, newMemberId, communityName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send notification when someone leaves a community (notify owner and mods)
   */
  async sendMemberLeftNotification(
    communityId: string,
    leftMemberId: string,
    leftMemberName: string,
    communityName: string,
  ) {
    // Get all owners and mods to notify
    const ownersAndMods = await prisma.communityMember.findMany({
      where: {
        communityId,
        role: { in: ["OWNER", "MOD"] },
        userId: { not: leftMemberId }, // Don't notify the person who left
      },
      select: { userId: true },
    });

    const notifications = ownersAndMods.map((member) =>
      this.createNotification({
        userId: member.userId,
        type: "system",
        title: "Member Left",
        message: `${leftMemberName} left ${communityName}`,
        data: { communityId, leftMemberId, communityName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send notification when a new template is created (notify all members except creator)
   */
  async sendTemplateCreatedNotification(
    communityId: string,
    templateId: string,
    templateGoalText: string,
    creatorName: string,
    communityName: string,
    creatorId: string,
  ) {
    // Get all members except the creator
    const members = await prisma.communityMember.findMany({
      where: {
        communityId,
        userId: { not: creatorId }, // Exclude creator
      },
      select: { userId: true },
    });

    const notifications = members
      .filter((member) => member.userId) // Safety check
      .map((member) =>
        this.createNotification({
          userId: member.userId,
          type: "system",
          title: "New Goal Template",
          message: `${creatorName} created a new goal template in ${communityName}: ${templateGoalText}`,
          data: { communityId, templateId, templateGoalText, communityName },
        }),
      );

    await Promise.all(notifications);
  }

  /**
   * Send notification when someone starts a goal from your template
   */
  async sendGoalStartedFromTemplateNotification(
    templateCreatorId: string,
    starterName: string,
    templateGoalText: string,
    communityName: string,
    goalId: string,
  ) {
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
  async sendActivityReactionNotification(
    activityOwnerId: string,
    reactorName: string,
    activityType: string,
    communityName: string,
    activityId: string,
  ) {
    // Don't notify if user reacted to their own activity
    if (!activityOwnerId) return;

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
  async sendActivityCommentNotification(
    activityOwnerId: string,
    commenterName: string,
    commentText: string,
    communityName: string,
    activityId: string,
  ) {
    // Don't notify if user commented on their own activity
    if (!activityOwnerId) return;

    const truncatedComment =
      commentText.length > 50
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
  async sendRoleChangedNotification(
    userId: string,
    newRole: string,
    communityName: string,
    changedBy: string,
  ) {
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
  async sendCommunityDeletedNotification(
    communityId: string,
    communityName: string,
  ) {
    const members = await prisma.communityMember.findMany({
      where: { communityId },
      select: { userId: true },
    });

    const notifications = members.map((member) =>
      this.createNotification({
        userId: member.userId,
        type: "system",
        title: "Community Deleted",
        message: `The community "${communityName}" has been deleted`,
        data: { communityId, communityName },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send notification when a template is deleted (notify users who started goals from it)
   */
  async sendTemplateDeletedNotification(
    templateId: string,
    templateGoalText: string,
    communityName: string,
  ) {
    // Find all goals started from this template
    const goals = await prisma.goal.findMany({
      where: { templateId },
      select: { userId: true, id: true },
      distinct: ["userId"], // Get unique users
    });

    const notifications = goals.map((goal) =>
      this.createNotification({
        userId: goal.userId,
        goalId: goal.id,
        type: "system",
        title: "Template Deleted",
        message: `The goal template "${templateGoalText}" in ${communityName} has been deleted`,
        data: { templateId, templateGoalText, communityName, goalId: goal.id },
      }),
    );

    await Promise.all(notifications);
  }

  /**
   * Send notification when a milestone is reached
   */
  async sendMilestoneReachedNotification(
    userId: string,
    goalId: string,
    milestoneName: string,
    points: number,
    goalText: string,
    communityName?: string,
  ) {
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

export const notificationService = new NotificationService();
