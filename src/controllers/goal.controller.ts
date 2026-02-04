import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

// Helper function to get date string in user's timezone (YYYY-MM-DD)
// Uses date-only comparison as specified in the plan
function getDateString(date: Date, timezone?: string): string {
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
function isMoreThanOneDayAgo(date: Date, timezone?: string): boolean {
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
async function checkAndResetGoal(goal: any, timezone?: string): Promise<boolean> {
  if (!goal.lastCheckInDate) {
    // If never checked in and started more than 1 day ago, reset
    if (isMoreThanOneDayAgo(goal.startedAt, timezone)) {
      await prisma.goal.update({
        where: { id: goal.id },
        data: {
          currentDay: 0,
          lastCheckInDate: null,
        },
      });
      return true;
    }
    return false;
  }

  // If last check-in was more than 1 day ago, reset
  if (isMoreThanOneDayAgo(goal.lastCheckInDate, timezone)) {
    await prisma.goal.update({
      where: { id: goal.id },
      data: {
        currentDay: 0,
        lastCheckInDate: null,
      },
    });
    return true;
  }

  return false;
}

export async function getAllGoals(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const timezone = req.headers["x-user-tz"] as string | undefined;

    const goals = await prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        checkIns: {
          orderBy: { checkInDate: "desc" },
          take: 1,
        },
      },
    });

    // Check and reset goals that need resetting
    const goalsWithReset = await Promise.all(
      goals.map(async (goal) => {
        const wasReset = await checkAndResetGoal(goal, timezone);
        if (wasReset) {
          return await prisma.goal.findUnique({
            where: { id: goal.id },
          });
        }
        return goal;
      })
    );

    res.json({
      msg: "Goals retrieved successfully",
      data: goalsWithReset.map((goal) => ({
        id: goal!.id,
        goalText: goal!.goalText,
        targetDays: goal!.targetDays,
        currentDay: goal!.currentDay,
        lastCheckInDate: goal!.lastCheckInDate?.toISOString() || null,
        startedAt: goal!.startedAt.toISOString(),
        createdAt: goal!.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    logger.error("Get goals error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getCurrentGoal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const timezone = req.headers["x-user-tz"] as string | undefined;

    // Get the most recent goal (for backward compatibility with single goal)
    const goal = await prisma.goal.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        checkIns: {
          orderBy: { checkInDate: "desc" },
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
    const wasReset = await checkAndResetGoal(goal, timezone);

    // Fetch updated goal if it was reset
    const updatedGoal = wasReset
      ? await prisma.goal.findUnique({
          where: { id: goal.id },
          include: {
            checkIns: {
              orderBy: { checkInDate: "desc" },
            },
          },
        })
      : goal;

    res.json({
      msg: wasReset ? "Goal reset due to missed day" : "Goal retrieved successfully",
      data: {
        id: updatedGoal!.id,
        goalText: updatedGoal!.goalText,
        targetDays: updatedGoal!.targetDays,
        currentDay: updatedGoal!.currentDay,
        lastCheckInDate: updatedGoal!.lastCheckInDate?.toISOString() || null,
        startedAt: updatedGoal!.startedAt.toISOString(),
        wasReset,
      },
    });
  } catch (error) {
    logger.error("Get current goal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getGoalById(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { goalId } = req.params;
    const timezone = req.headers["x-user-tz"] as string | undefined;

    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId, // Ensure user owns this goal
      },
      include: {
        checkIns: {
          orderBy: { checkInDate: "desc" },
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
    const wasReset = await checkAndResetGoal(goal, timezone);

    // Fetch updated goal if it was reset
    const updatedGoal = wasReset
      ? await prisma.goal.findUnique({
          where: { id: goal.id },
          include: {
            checkIns: {
              orderBy: { checkInDate: "desc" },
            },
          },
        })
      : goal;

    res.json({
      msg: wasReset ? "Goal reset due to missed day" : "Goal retrieved successfully",
      data: {
        id: updatedGoal!.id,
        goalText: updatedGoal!.goalText,
        targetDays: updatedGoal!.targetDays,
        currentDay: updatedGoal!.currentDay,
        lastCheckInDate: updatedGoal!.lastCheckInDate?.toISOString() || null,
        startedAt: updatedGoal!.startedAt.toISOString(),
        wasReset,
      },
    });
  } catch (error) {
    logger.error("Get goal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function createGoal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { goalText, targetDays } = req.body;

    const goal = await prisma.goal.create({
      data: {
        goalText,
        targetDays,
        currentDay: 0,
        userId,
        startedAt: new Date(),
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
      },
    });
  } catch (error) {
    logger.error("Create goal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateGoal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { goalId } = req.params;
    const { goalText, targetDays } = req.body;

    // Verify goal exists and belongs to user
    const existingGoal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId,
      },
    });

    if (!existingGoal) {
      return res.status(404).json({ msg: "Goal not found" });
    }

    // Build update data
    const updateData: any = {};
    if (goalText !== undefined) updateData.goalText = goalText;
    if (targetDays !== undefined) updateData.targetDays = targetDays;

    const updated = await prisma.goal.update({
      where: { id: goalId },
      data: updateData,
    });

    res.json({
      msg: "Goal updated successfully",
      data: {
        id: updated.id,
        goalText: updated.goalText,
        targetDays: updated.targetDays,
        currentDay: updated.currentDay,
        lastCheckInDate: updated.lastCheckInDate?.toISOString() || null,
        startedAt: updated.startedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Update goal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function checkIn(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { goalId } = req.body;
    const timezone = req.headers["x-user-tz"] as string | undefined;
    const today = new Date();
    const todayStr = getDateString(today, timezone);

    // If no goalId provided, use the most recent goal (backward compatible)
    let goal;
    if (goalId) {
      goal = await prisma.goal.findFirst({
        where: {
          id: goalId,
          userId, // Ensure user owns this goal
        },
      });
    } else {
      goal = await prisma.goal.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!goal) {
      return res.status(404).json({ msg: "Goal not found" });
    }

    // Check if already checked in today using date string comparison
    // Get all check-ins for this goal and compare by date string
    const allCheckIns = await prisma.checkIn.findMany({
      where: { goalId: goal.id },
    });

    const todayCheckIn = allCheckIns.find((checkIn) => {
      const checkInDateStr = getDateString(checkIn.checkInDate, timezone);
      return checkInDateStr === todayStr;
    });

    if (todayCheckIn) {
      return res.status(400).json({ msg: "Already checked in today" });
    }

    // Check if goal should be reset first
    await checkAndResetGoal(goal, timezone);

    // Fetch updated goal
    const updatedGoal = await prisma.goal.findUnique({
      where: { id: goal.id },
    });

    if (!updatedGoal) {
      return res.status(404).json({ msg: "Goal not found" });
    }

    // Create check-in record
    const checkInDate = new Date(todayStr + "T12:00:00"); // Use noon to avoid timezone issues
    await prisma.checkIn.create({
      data: {
        goalId: updatedGoal.id,
        checkInDate,
      },
    });

    // Increment current day and update last check-in date
    const newCurrentDay = updatedGoal.currentDay + 1;
    const updated = await prisma.goal.update({
      where: { id: updatedGoal.id },
      data: {
        currentDay: newCurrentDay,
        lastCheckInDate: checkInDate,
      },
    });

    res.json({
      msg: "Check-in successful",
      data: {
        id: updated.id,
        goalText: updated.goalText,
        targetDays: updated.targetDays,
        currentDay: updated.currentDay,
        lastCheckInDate: updated.lastCheckInDate?.toISOString() || null,
      },
    });
  } catch (error) {
    logger.error("Check-in error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function resetGoal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { goalId } = req.body;

    // If no goalId provided, use the most recent goal (backward compatible)
    let goal;
    if (goalId) {
      goal = await prisma.goal.findFirst({
        where: {
          id: goalId,
          userId, // Ensure user owns this goal
        },
      });
    } else {
      goal = await prisma.goal.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
    }

    if (!goal) {
      return res.status(404).json({ msg: "Goal not found" });
    }

    // Delete all check-ins
    await prisma.checkIn.deleteMany({
      where: { goalId: goal.id },
    });

    // Reset goal
    const updated = await prisma.goal.update({
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
      },
    });
  } catch (error) {
    logger.error("Reset goal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function deleteGoal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { goalId } = req.params;

    const goal = await prisma.goal.findFirst({
      where: {
        id: goalId,
        userId, // Ensure user owns this goal
      },
    });

    if (!goal) {
      return res.status(404).json({ msg: "Goal not found" });
    }

    // Delete all check-ins (cascade should handle this, but being explicit)
    await prisma.checkIn.deleteMany({
      where: { goalId: goal.id },
    });

    // Delete goal
    await prisma.goal.delete({
      where: { id: goal.id },
    });

    res.json({
      msg: "Goal deleted successfully",
    });
  } catch (error) {
    logger.error("Delete goal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
