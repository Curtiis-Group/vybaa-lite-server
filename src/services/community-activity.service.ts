import { prisma } from "../config/db.config";
import { CommunityActivityType } from "@prisma/client";
import logger from "../utils/logger.util";

/**
 * Service for automatically generating community activities from goal events
 */
class CommunityActivityService {
  /**
   * Create activity when a goal is started from a template
   */
  async createGoalStartedActivity(goalId: string, userId: string, templateId: string): Promise<void> {
    try {
      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
        include: {
          template: {
            include: {
              community: true,
            },
          },
        },
      });

      if (!goal || !goal.template || !goal.communityId) {
        return; // Not a community goal, skip
      }

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_STARTED,
          goalId,
          metadata: JSON.stringify({
            templateId,
            templateTitle: goal.template.title,
          }),
        },
      });
    } catch (error) {
      logger.error("Create goal started activity error:", { error, goalId, userId });
    }
  }

  /**
   * Create activity when a user checks in to a community goal
   */
  async createCheckInActivity(goalId: string, userId: string): Promise<void> {
    try {
      const goal = await prisma.goal.findUnique({
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
      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_CHECK_IN,
          goalId,
          metadata: JSON.stringify({
            currentDay: goal.currentDay,
            templateId: goal.templateId,
          }),
        },
      });
    } catch (error) {
      logger.error("Create check-in activity error:", { error, goalId, userId });
    }
  }

  /**
   * Create activity when a goal is completed
   */
  async createGoalCompletedActivity(goalId: string, userId: string): Promise<void> {
    try {
      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
        include: {
          template: true,
        },
      });

      if (!goal || !goal.communityId) {
        return; // Not a community goal, skip
      }

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_COMPLETED,
          goalId,
          metadata: JSON.stringify({
            targetDays: goal.targetDays,
            templateId: goal.templateId,
          }),
        },
      });
    } catch (error) {
      logger.error("Create goal completed activity error:", { error, goalId, userId });
    }
  }

  /**
   * Create activity when an achievement is earned for a community goal
   */
  async createAchievementActivity(achievementId: string, userId: string, goalId: string | null): Promise<void> {
    try {
      if (!goalId) {
        return; // Not goal-specific achievement, skip
      }

      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
        include: {
          template: true,
        },
      });

      if (!goal || !goal.communityId) {
        return; // Not a community goal, skip
      }

      const achievement = await prisma.achievement.findUnique({
        where: { id: achievementId },
      });

      if (!achievement) {
        return;
      }

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.ACHIEVEMENT_EARNED,
          goalId,
          metadata: JSON.stringify({
            achievementType: achievement.type,
            milestone: achievement.milestone,
            title: achievement.title,
            templateId: goal.templateId,
          }),
        },
      });
    } catch (error) {
      logger.error("Create achievement activity error:", { error, achievementId, userId, goalId });
    }
  }

  /**
   * Create activity when a template is created
   */
  async createTemplateCreatedActivity(templateId: string, userId: string, communityId: string): Promise<void> {
    try {
      const template = await prisma.goalTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return;
      }

      await prisma.communityActivity.create({
        data: {
          communityId,
          userId,
          type: CommunityActivityType.TEMPLATE_CREATED,
          metadata: JSON.stringify({
            templateId,
            templateTitle: template.title,
          }),
        },
      });
    } catch (error) {
      logger.error("Create template created activity error:", { error, templateId, userId, communityId });
    }
  }
}

export const communityActivityService = new CommunityActivityService();
