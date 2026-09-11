import { CommunityActivityType } from "@prisma/client";
import { prisma } from "../config/db.config";
import { isAllowedUserContent } from "../utils/content-moderation.util";
import logger from "../utils/logger.util";

function canPublishActivity(
  ...values: Array<string | null | undefined>
): boolean {
  return values.every((value) => !value || isAllowedUserContent(value));
}

/**
 * Service for automatically generating community activities from goal events
 */
class CommunityActivityService {
  /**
   * Create activity when a goal is started from a template
   */
  async createGoalStartedActivity(
    goalId: string,
    userId: string,
    templateId: string,
  ): Promise<void> {
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
      if (!canPublishActivity(goal.goalText)) return;

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_STARTED,
          goalId,
          metadata: JSON.stringify({
            templateId,
            goalText: goal.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create goal started activity error:", {
        error,
        goalId,
        userId,
      });
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
      if (!canPublishActivity(goal.goalText)) return;

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
            goalText: goal.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create check-in activity error:", {
        error,
        goalId,
        userId,
      });
    }
  }

  /**
   * Create activity when a goal is completed
   */
  async createGoalCompletedActivity(
    goalId: string,
    userId: string,
  ): Promise<void> {
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
      if (!canPublishActivity(goal.goalText)) return;

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_COMPLETED,
          goalId,
          metadata: JSON.stringify({
            targetDays: goal.targetDays,
            templateId: goal.templateId,
            goalText: goal.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create goal completed activity error:", {
        error,
        goalId,
        userId,
      });
    }
  }

  /**
   * Create activity when a user's streak is reset for a community goal
   */
  async createStreakResetActivity(
    goalId: string,
    userId: string,
    previousDays: number,
  ): Promise<void> {
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
      if (!canPublishActivity(goal.goalText)) return;

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_STREAK_RESET,
          goalId,
          metadata: JSON.stringify({
            previousDays,
            templateId: goal.templateId,
            goalText: goal.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create streak reset activity error:", {
        error,
        goalId,
        userId,
      });
    }
  }

  /**
   * Create activity when an achievement is earned for a community goal
   */
  async createAchievementActivity(
    achievementId: string,
    userId: string,
    goalId: string | null,
  ): Promise<void> {
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
      if (!canPublishActivity(goal.goalText, achievement.title)) return;

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
            goalText: goal.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create achievement activity error:", {
        error,
        achievementId,
        userId,
        goalId,
      });
    }
  }

  /**
   * Create activity when a template is created
   */
  async createTemplateCreatedActivity(
    templateId: string,
    userId: string,
    communityId: string,
  ): Promise<void> {
    try {
      const template = await prisma.goalTemplate.findUnique({
        where: { id: templateId },
      });

      if (!template) {
        return;
      }
      if (!canPublishActivity(template.goalText)) return;

      await prisma.communityActivity.create({
        data: {
          communityId,
          userId,
          type: CommunityActivityType.TEMPLATE_CREATED,
          metadata: JSON.stringify({
            templateId,
            templateTitle: template.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create template created activity error:", {
        error,
        templateId,
        userId,
        communityId,
      });
    }
  }

  /**
   * Create activity when a member leaves a community
   */
  async createMemberLeftActivity(
    communityId: string,
    userId: string,
  ): Promise<void> {
    try {
      await prisma.communityActivity.create({
        data: {
          communityId,
          userId,
          type: CommunityActivityType.MEMBER_LEFT,
          metadata: JSON.stringify({}),
        },
      });
    } catch (error) {
      logger.error("Create member left activity error:", {
        error,
        communityId,
        userId,
      });
    }
  }

  /**
   * Create activity when a community goal is deleted
   */
  async createGoalDeletedActivity(
    goalId: string,
    userId: string,
  ): Promise<void> {
    try {
      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!goal || !goal.communityId) {
        return; // Not a community goal, skip
      }
      if (!canPublishActivity(goal.goalText)) return;

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.GOAL_DELETED,
          goalId,
          metadata: JSON.stringify({
            goalText: goal.goalText,
            targetDays: goal.targetDays,
          }),
        },
      });
    } catch (error) {
      logger.error("Create goal deleted activity error:", {
        error,
        goalId,
        userId,
      });
    }
  }

  /**
   * Create activity when a milestone is reached for a community goal
   */
  async createMilestoneReachedActivity(
    goalId: string,
    userId: string,
    milestone: { id: string; name: string; points: number },
  ): Promise<void> {
    try {
      const goal = await prisma.goal.findUnique({
        where: { id: goalId },
      });

      if (!goal || !goal.communityId) {
        return; // Not a community goal, skip
      }
      if (!canPublishActivity(goal.goalText, milestone.name)) return;

      await prisma.communityActivity.create({
        data: {
          communityId: goal.communityId,
          userId,
          type: CommunityActivityType.MILESTONE_REACHED,
          goalId,
          metadata: JSON.stringify({
            milestoneId: milestone.id,
            milestoneName: milestone.name,
            points: milestone.points,
            goalText: goal.goalText,
          }),
        },
      });
    } catch (error) {
      logger.error("Create milestone reached activity error:", {
        error,
        goalId,
        userId,
        milestoneId: milestone.id,
      });
    }
  }
}

export const communityActivityService = new CommunityActivityService();
