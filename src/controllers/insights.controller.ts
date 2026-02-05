import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

export async function getInsights(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    // Use aggregation queries for efficiency - NO full data fetching
    const [
      goalStats,
      totalCheckIns,
      longestStreakGoal,
      recentActivity,
    ] = await Promise.all([
      // Aggregate goal statistics
      prisma.goal.aggregate({
        where: { userId },
        _count: { id: true },
        _sum: {
          targetDays: true,
          currentDay: true,
        },
        _avg: {
          currentDay: true,
          targetDays: true,
        },
      }),

      // Count total check-ins across all goals
      prisma.checkIn.count({
        where: {
          goal: { userId },
        },
      }),

      // Find goal with longest current streak (most efficient way)
      prisma.goal.findFirst({
        where: { userId },
        orderBy: { currentDay: 'desc' },
        select: {
          currentDay: true,
        },
      }),

      // Get check-ins from last 30 days for chart data
      prisma.checkIn.findMany({
        where: {
          goal: { userId },
          checkInDate: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        select: {
          checkInDate: true,
          goalId: true,
        },
        orderBy: {
          checkInDate: 'asc',
        },
      }),
    ]);

    // Calculate metrics
    const totalGoals = goalStats._count.id;
    const totalDays = goalStats._sum.targetDays || 0;
    const completedDays = goalStats._sum.currentDay || 0;
    const averageProgress = totalGoals > 0
      ? ((completedDays / totalDays) * 100)
      : 0;
    const longestStreak = longestStreakGoal?.currentDay || 0;
    const completionRate = totalDays > 0 ? (completedDays / totalDays) * 100 : 0;

    // Process activity data for chart - group by date
    const activityMap = new Map<string, number>();
    recentActivity.forEach((checkIn) => {
      const dateKey = checkIn.checkInDate.toISOString().split('T')[0];
      activityMap.set(dateKey, (activityMap.get(dateKey) || 0) + 1);
    });

    // Convert to array of chart data points
    const chartData = Array.from(activityMap.entries())
      .map(([date, count]) => ({
        date,
        checkIns: count,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate streak information (current active streak)
    const currentStreak = await calculateCurrentStreak(userId);

    res.json({
      msg: "Insights retrieved successfully",
      data: {
        summary: {
          totalGoals,
          totalCheckIns,
          completedDays,
          totalDays,
          averageProgress: Math.round(averageProgress * 10) / 10,
          longestStreak,
          completionRate: Math.round(completionRate * 10) / 10,
          currentStreak,
        },
        chartData,
      },
    });
  } catch (error) {
    logger.error("Get insights error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

// Helper to calculate current active streak
async function calculateCurrentStreak(userId: string): Promise<number> {
  const now = new Date();
  const today = new Date(now.toISOString().split('T')[0]);
  let streak = 0;
  let currentDate = new Date(today);

  // Check backwards day by day until we find a gap
  while (true) {
    const dateStr = currentDate.toISOString().split('T')[0];
    const startOfDay = new Date(dateStr + 'T00:00:00Z');
    const endOfDay = new Date(dateStr + 'T23:59:59Z');

    const checkInExists = await prisma.checkIn.findFirst({
      where: {
        goal: { userId },
        checkInDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    if (!checkInExists) {
      break;
    }

    streak++;
    currentDate.setDate(currentDate.getDate() - 1);

    // Safety limit to prevent infinite loops
    if (streak > 1000) break;
  }

  return streak;
}
