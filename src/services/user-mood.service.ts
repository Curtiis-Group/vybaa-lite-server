import { prisma } from "../config/db.config";
import logger from "../utils/logger.util";

const CURRENT_MOOD_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;

type MoodSignalSnapshot = {
  activeGoalCount: number;
  averageGoalProgress: number;
  completedGoalCount: number;
  recentActivityCount: number;
  recentCheckInCount: number;
  recentCompletedChillCount: number;
  recentJournalCount: number;
  rewindCompletedCount: number;
  rewindResponseCount: number;
};

function shouldReuseCurrentMood(currentMood: string | null, updatedAt: Date): boolean {
  if (!currentMood) {
    return false;
  }

  return Date.now() - updatedAt.getTime() < CURRENT_MOOD_REFRESH_WINDOW_MS;
}

function roundToWholePercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function deriveMoodFromSignals(signals: MoodSignalSnapshot): string {
  if (
    signals.recentActivityCount === 0 &&
    signals.rewindCompletedCount === 0 &&
    signals.recentCompletedChillCount === 0
  ) {
    return "Quiet";
  }

  if (
    signals.averageGoalProgress >= 75 &&
    signals.recentCheckInCount >= 2 &&
    signals.rewindCompletedCount > 0
  ) {
    return "Focused";
  }

  if (
    signals.completedGoalCount > 0 ||
    (signals.averageGoalProgress >= 60 && signals.recentActivityCount >= 3)
  ) {
    return "Confident";
  }

  if (signals.rewindCompletedCount > 0 && signals.rewindResponseCount >= 3) {
    return "Reflective";
  }

  if (signals.recentCompletedChillCount > 0 && signals.recentJournalCount > 0) {
    return "Grounded";
  }

  if (signals.recentActivityCount >= 3 || signals.recentCheckInCount >= 1) {
    return "Steady";
  }

  if (signals.activeGoalCount > 0 && signals.averageGoalProgress < 35) {
    return "Recharging";
  }

  return "Present";
}

async function buildMoodSignalSnapshot(userId: string): Promise<MoodSignalSnapshot> {
  const now = new Date();
  const activityWindowStart = new Date(now.getTime() - CURRENT_MOOD_REFRESH_WINDOW_MS);

  const [goals, recentCheckInCount, recentCompletedChillCount, recentJournalCount, rewindSessions] =
    await Promise.all([
      prisma.goal.findMany({
        where: { userId },
        select: {
          currentDay: true,
          targetDays: true,
        },
      }),
      prisma.checkIn.count({
        where: {
          goal: { userId },
          createdAt: { gte: activityWindowStart },
        },
      }),
      prisma.chillSession.count({
        where: {
          userId,
          completed: true,
          completedAt: { gte: activityWindowStart },
        },
      }),
      prisma.journal.count({
        where: {
          userId,
          updatedAt: { gte: activityWindowStart },
        },
      }),
      prisma.rewindSession.findMany({
        where: {
          userId,
          updatedAt: { gte: activityWindowStart },
        },
        select: {
          completed: true,
          responses: true,
        },
      }),
    ]);

  const activeGoalCount = goals.length;
  const completedGoalCount = goals.filter((goal) => goal.currentDay >= goal.targetDays).length;

  let progressAccumulator = 0;
  for (const goal of goals) {
    if (!goal.targetDays) {
      continue;
    }

    progressAccumulator += Math.min(goal.currentDay / goal.targetDays, 1);
  }

  const averageGoalProgress =
    activeGoalCount > 0
      ? roundToWholePercent((progressAccumulator / activeGoalCount) * 100)
      : 0;

  let rewindCompletedCount = 0;
  let rewindResponseCount = 0;
  for (const session of rewindSessions) {
    if (session.completed) {
      rewindCompletedCount += 1;
    }

    if (session.responses && typeof session.responses === "object" && !Array.isArray(session.responses)) {
      rewindResponseCount += Object.keys(session.responses as Record<string, unknown>).length;
    }
  }

  const recentActivityCount =
    recentCheckInCount +
    recentCompletedChillCount +
    recentJournalCount +
    rewindCompletedCount;

  return {
    activeGoalCount,
    averageGoalProgress,
    completedGoalCount,
    recentActivityCount,
    recentCheckInCount,
    recentCompletedChillCount,
    recentJournalCount,
    rewindCompletedCount,
    rewindResponseCount,
  };
}

class UserMoodService {
  async refreshCurrentMoodIfNeeded(userId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        currentMood: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return null;
    }

    if (shouldReuseCurrentMood(user.currentMood, user.updatedAt)) {
      return user.currentMood;
    }

    const signals = await buildMoodSignalSnapshot(userId);
    const nextMood = deriveMoodFromSignals(signals);

    await prisma.user.update({
      where: { id: userId },
      data: { currentMood: nextMood },
    });

    logger.info("Refreshed generated current mood", {
      userId,
      mood: nextMood,
      signals,
    });

    return nextMood;
  }
}

export const userMoodService = new UserMoodService();
