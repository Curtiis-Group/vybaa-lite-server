import { MilestoneTriggerType, TemplateMilestone } from "@prisma/client";
import { prisma } from "../config/db.config";
import { getStreakMilestonePoints, isStreakMilestoneWithPoints } from "../config/points.config";
import logger from "../utils/logger.util";
import { communityActivityService } from "./community-activity.service";
import { notificationService } from "./notification.service";

export class MilestoneService {
  /**
   * Check and award milestones for a goal based on its progress change.
   * previousDay: goal.currentDay before increment
   */
  async checkAndAwardMilestones(goalId: string, userId: string, previousDay: number): Promise<void> {
    try {
      const goal = await prisma.goal.findUnique({
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

      const milestones = await prisma.templateMilestone.findMany({
        where: { templateId: goal.templateId },
        orderBy: { order: "asc" },
      });

      if (milestones.length === 0) {
        return;
      }

      const triggered: TemplateMilestone[] = [];

      const prevPct = (previousDay / targetDays) * 100;
      const currPct = (currentDay / targetDays) * 100;

      for (const m of milestones) {
        let shouldTrigger = false;

        if (m.triggerType === MilestoneTriggerType.DAY) {
          shouldTrigger = currentDay >= m.triggerValue && previousDay < m.triggerValue;
        } else if (m.triggerType === MilestoneTriggerType.PERCENTAGE) {
          shouldTrigger = currPct >= m.triggerValue && prevPct < m.triggerValue;
        }

        if (shouldTrigger) {
          triggered.push(m);
        }
      }

      if (triggered.length === 0) {
        return;
      }

      const triggeredIds = triggered.map((m) => m.id);

      const existingHits = await prisma.goalMilestoneHit.findMany({
        where: {
          goalId,
          milestoneId: { in: triggeredIds },
        },
      });

      const alreadyHitIds = new Set(existingHits.map((h) => h.milestoneId));
      const newHits = triggered.filter((m) => !alreadyHitIds.has(m.id));

      if (newHits.length === 0) {
        return;
      }

      // Get community name for notification
      const community = await prisma.community.findUnique({
        where: { id: goal.communityId },
        select: { name: true },
      });

      // Calculate total points from new milestones
      const totalNewPoints = newHits.reduce((sum, m) => sum + m.points, 0);

      // Create or update pending points record
      await prisma.goalPendingPoints.upsert({
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
      for (const m of newHits) {
        await prisma.goalMilestoneHit.create({
          data: {
            goalId,
            milestoneId: m.id,
          },
        });

        await communityActivityService.createMilestoneReachedActivity(goalId, userId, m);

        // Send milestone notification
        notificationService.sendMilestoneReachedNotification(
          userId,
          goalId,
          m.name,
          m.points,
          goal.goalText || "",
          community?.name
        ).catch((err) => logger.error("Error sending milestone notification:", err));
      }
    } catch (error) {
      logger.error("Milestone evaluation error:", { error, goalId, userId, previousDay });
    }
  }

  /**
   * Check and award streak milestone points for any goal (community or personal).
   * This uses the main app milestone points configuration.
   * previousDay: goal.currentDay before increment
   */
  async checkAndAwardStreakMilestones(goalId: string, userId: string, previousDay: number, currentDay: number): Promise<void> {
    try {
      // Check if we just crossed a streak milestone
      if (!isStreakMilestoneWithPoints(currentDay)) {
        return; // Not a milestone day
      }

      // Check if we already awarded points for this milestone
      // We'll track this by checking if we've already awarded points for this day
      // Since we can't easily track main app milestones like template milestones,
      // we'll check if the goal has pending points that include this milestone's points
      // For simplicity, we'll just award points if the day matches a milestone
      // and the previous day was less than the milestone

      const points = getStreakMilestonePoints(currentDay);
      if (points === 0) {
        return; // No points for this milestone
      }

      // Only award if we just crossed the milestone (previousDay < milestone <= currentDay)
      if (previousDay >= currentDay) {
        return; // Already past this milestone
      }

      // Get goal info for logging
      const goal = await prisma.goal.findUnique({
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
      await prisma.goalPendingPoints.upsert({
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

      logger.info(
        `Awarded ${points} Play Points for streak milestone day ${currentDay} on goal ${goalId} (user ${userId})`
      );

      // Send notification about streak milestone (if not already sent by notification service)
      // The notification service already handles this, but we can add a points-specific message
      const communityName = goal.community?.name;
      const milestoneName = `Day ${currentDay} Streak`;
      
      // Note: We don't create a community activity for main app streak milestones
      // as they're not community-specific. Only template milestones create activities.
    } catch (error) {
      logger.error("Streak milestone points error:", { error, goalId, userId, previousDay, currentDay });
    }
  }
}

export const milestoneService = new MilestoneService();

