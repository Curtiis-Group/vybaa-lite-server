import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

/**
 * Get user's rewards balance and pending points
 */
export async function getRewards(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        points: true
      },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Get all pending points from active goals (goals that are not yet completed)
    const pendingPointsRecords = await prisma.goalPendingPoints.findMany({
      where: {
        goal: {
          userId,
        },
      },
      include: {
        goal: {
          select: {
            id: true,
            goalText: true,
            currentDay: true,
            targetDays: true,
            community: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // Filter to only include goals that are not yet completed
    const activePendingPoints = pendingPointsRecords.filter(
      (record) => record.goal.currentDay < record.goal.targetDays
    );

    const totalPendingPoints = activePendingPoints.reduce(
      (sum, record) => sum + record.totalPendingPoints,
      0
    );

    res.json({
      msg: "Rewards retrieved successfully",
      data: {
        balance: user.points,
        pendingPoints: totalPendingPoints,
        pendingBreakdown: activePendingPoints.map((record) => ({
          goalId: record.goal.id,
          goalText: record.goal.goalText,
          currentDay: record.goal.currentDay,
          targetDays: record.goal.targetDays,
          pendingPoints: record.totalPendingPoints,
          community: record.goal.community,
        })),
      },
    });
  } catch (error) {
    logger.error("Get rewards error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get user's total earned rewards (for display in member lists)
 */
export async function getUserTotalRewards(userId: string): Promise<number> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { points: true },
    });

    return user?.points || 0;
  } catch (error) {
    logger.error("Get user total rewards error:", { error, userId });
    return 0;
  }
}
