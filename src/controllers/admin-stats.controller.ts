import { Response } from "express";
import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

interface AdminMetric {
  change: string;
  label: string;
  tone: "negative" | "neutral" | "positive";
  value: string;
}

interface AdminHealthItem {
  label: string;
  progress: number;
  value: string;
}

interface AdminRecentActivityItem {
  description: string;
  timeLabel: string;
  title: string;
}

interface AdminWeeklyActivityItem {
  dayLabel: string;
  value: number;
}

interface AdminStatsData {
  healthItems: AdminHealthItem[];
  metrics: AdminMetric[];
  recentActivity: AdminRecentActivityItem[];
  summary: string;
  title: string;
  weeklyActivity: AdminWeeklyActivityItem[];
}

interface RecentEvent {
  createdAt: Date;
  description: string;
  title: string;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: 1,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

function formatPercent(value: number): string {
  const clampedValue = Math.max(0, Math.min(100, value));
  return `${Math.round(clampedValue)}%`;
}

function formatTimeAgo(date: Date): string {
  const diffInMinutes = Math.max(1, Math.floor((Date.now() - date.getTime()) / 60000));

  if (diffInMinutes < 60) {
    return `${diffInMinutes} min ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hr ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  return `${diffInDays} day ago`;
}

function getStartOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function getRecentRangeStart(days: number): Date {
  const todayStart = getStartOfUtcDay(new Date());
  const rangeStart = new Date(todayStart);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - (days - 1));
  return rangeStart;
}

function buildWeeklyActivityItems(checkInDates: Date[], rangeStart: Date): AdminWeeklyActivityItem[] {
  const counts = new Map<string, number>();

  for (let index = 0; index < 7; index += 1) {
    const currentDate = new Date(rangeStart);
    currentDate.setUTCDate(rangeStart.getUTCDate() + index);
    counts.set(currentDate.toISOString().slice(0, 10), 0);
  }

  for (const checkInDate of checkInDates) {
    const dateKey = getStartOfUtcDay(checkInDate).toISOString().slice(0, 10);
    const currentCount = counts.get(dateKey);
    if (currentCount !== undefined) {
      counts.set(dateKey, currentCount + 1);
    }
  }

  const items: AdminWeeklyActivityItem[] = [];

  for (const [dateKey, value] of counts.entries()) {
    const date = new Date(`${dateKey}T00:00:00.000Z`);
    items.push({
      dayLabel: date.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" }),
      value,
    });
  }

  return items;
}

function buildRecentActivityItems(input: {
  checkIns: { checkInDate: Date; goal: { goalText: string } | null }[];
  communities: { createdAt: Date; name: string }[];
  rewinds: { createdAt: Date; personaId: string }[];
  users: { createdAt: Date; username: string | null }[];
}): AdminRecentActivityItem[] {
  const events: RecentEvent[] = [];

  for (const user of input.users) {
    events.push({
      createdAt: user.createdAt,
      title: "New user joined",
      description: user.username ? `@${user.username} created an account.` : "A new user created an account.",
    });
  }

  for (const community of input.communities) {
    events.push({
      createdAt: community.createdAt,
      title: "Community created",
      description: `${community.name} was created.`,
    });
  }

  for (const checkIn of input.checkIns) {
    const goalText = checkIn.goal?.goalText?.trim();
    events.push({
      createdAt: checkIn.checkInDate,
      title: "Goal check-in recorded",
      description: goalText ? `Check-in logged for "${goalText}".` : "A goal check-in was logged.",
    });
  }

  for (const rewind of input.rewinds) {
    events.push({
      createdAt: rewind.createdAt,
      title: "Rewind session completed",
      description: `A ${rewind.personaId} rewind was completed.`,
    });
  }

  return events
    .sort((leftEvent, rightEvent) => rightEvent.createdAt.getTime() - leftEvent.createdAt.getTime())
    .slice(0, 3)
    .map((event) => ({
      description: event.description,
      timeLabel: formatTimeAgo(event.createdAt),
      title: event.title,
    }));
}

export async function getAdminStats(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rangeStart = getRecentRangeStart(7);

    const [
      totalUsers,
      newUsersThisWeek,
      totalCommunities,
      totalCommunityMembers,
      goalProgressRows,
      weeklyCheckIns,
      recentCheckIns,
      totalRewindSessions,
      completedRewindSessions,
      rewindsThisWeek,
      recentRewinds,
      recentUsers,
      recentCommunities,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: rangeStart } } }),
      prisma.community.count(),
      prisma.communityMember.count(),
      prisma.goal.findMany({
        select: {
          currentDay: true,
          targetDays: true,
        },
      }),
      prisma.checkIn.findMany({
        where: { checkInDate: { gte: rangeStart } },
        orderBy: { checkInDate: "asc" },
        select: { checkInDate: true },
      }),
      prisma.checkIn.findMany({
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          checkInDate: true,
          goal: {
            select: {
              goalText: true,
            },
          },
        },
      }),
      prisma.rewindSession.count(),
      prisma.rewindSession.count({ where: { completed: true } }),
      prisma.rewindSession.count({
        where: {
          completed: true,
          updatedAt: { gte: rangeStart },
        },
      }),
      prisma.rewindSession.findMany({
        where: { completed: true },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: {
          createdAt: true,
          personaId: true,
        },
      }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          createdAt: true,
          username: true,
        },
      }),
      prisma.community.findMany({
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          createdAt: true,
          name: true,
        },
      }),
    ]);

    const totalGoals = goalProgressRows.length;
    let activeGoals = 0;
    let completedGoals = 0;

    for (const goal of goalProgressRows) {
      if (goal.currentDay > 0) {
        activeGoals += 1;
      }

      if (goal.targetDays > 0 && goal.currentDay >= goal.targetDays) {
        completedGoals += 1;
      }
    }

    const goalCompletionRate = totalGoals ? (completedGoals / totalGoals) * 100 : 0;
    const communityParticipationRate = totalUsers ? (totalCommunityMembers / totalUsers) * 100 : 0;
    const rewindCompletionRate = totalRewindSessions ? (completedRewindSessions / totalRewindSessions) * 100 : 0;
    const weeklyCheckInCoverage = activeGoals ? (weeklyCheckIns.length / activeGoals) * 100 : 0;

    const data: AdminStatsData = {
      title: "Stats",
      summary: `${formatCompactNumber(totalUsers)} users, ${formatCompactNumber(activeGoals)} active goals, ${formatCompactNumber(totalCommunities)} communities, and ${formatCompactNumber(rewindsThisWeek)} completed rewinds in the last 7 days.`,
      metrics: [
        {
          label: "Users",
          value: formatCompactNumber(totalUsers),
          change: `${formatCompactNumber(newUsersThisWeek)} new this week`,
          tone: newUsersThisWeek > 0 ? "positive" : "neutral",
        },
        {
          label: "Active goals",
          value: formatCompactNumber(activeGoals),
          change: `${formatCompactNumber(completedGoals)} completed overall`,
          tone: activeGoals > 0 ? "positive" : "neutral",
        },
        {
          label: "Communities",
          value: formatCompactNumber(totalCommunities),
          change: `${formatCompactNumber(totalCommunityMembers)} memberships`,
          tone: totalCommunities > 0 ? "positive" : "neutral",
        },
        {
          label: "Completed rewinds",
          value: formatCompactNumber(rewindsThisWeek),
          change: `${formatCompactNumber(completedRewindSessions)} total completed`,
          tone: rewindsThisWeek > 0 ? "positive" : "neutral",
        },
      ],
      weeklyActivity: buildWeeklyActivityItems(
        weeklyCheckIns.map((checkIn) => checkIn.checkInDate),
        rangeStart,
      ),
      healthItems: [
        {
          label: "Goal completion rate",
          progress: Math.round(goalCompletionRate),
          value: formatPercent(goalCompletionRate),
        },
        {
          label: "Community participation",
          progress: Math.round(communityParticipationRate),
          value: formatPercent(communityParticipationRate),
        },
        {
          label: "Rewind completion rate",
          progress: Math.round(rewindCompletionRate),
          value: formatPercent(rewindCompletionRate),
        },
        {
          label: "Weekly check-in coverage",
          progress: Math.round(weeklyCheckInCoverage),
          value: formatPercent(weeklyCheckInCoverage),
        },
      ],
      recentActivity: buildRecentActivityItems({
        checkIns: recentCheckIns,
        communities: recentCommunities,
        rewinds: recentRewinds,
        users: recentUsers,
      }),
    };

    res.json({
      msg: "Admin stats retrieved successfully",
      data,
    });
  } catch (error) {
    logger.error("Get admin stats error:", { error });
    res.status(500).json({ msg: "Internal server error" });
  }
}
