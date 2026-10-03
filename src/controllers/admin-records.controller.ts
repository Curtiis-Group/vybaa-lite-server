import type { Prisma } from "@prisma/client";
import type { Response } from "express";
import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

const GOAL_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "ABANDONED", "AUTO_ABANDONED"] as const;
const REWIND_STATUSES = ["LEGACY", "SCHEDULED", "IN_PROGRESS", "FINALIZING", "COMPLETED", "MISSED"] as const;

type GoalStatus = (typeof GOAL_STATUSES)[number];
type RewindStatus = (typeof REWIND_STATUSES)[number];

interface PageParams {
  limit: number;
  page: number;
  skip: number;
}

function queryString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPageParams(req: AuthRequest): PageParams {
  const requestedPage = Number.parseInt(queryString(req.query.page), 10);
  const requestedLimit = Number.parseInt(queryString(req.query.limit), 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 20;

  return { limit, page, skip: (page - 1) * limit };
}

function getSearch(req: AuthRequest): string {
  return queryString(req.query.search).slice(0, 100);
}

function getStatus(req: AuthRequest): string {
  return queryString(req.query.status).toUpperCase();
}

function pathParam(req: AuthRequest, key: string): string {
  const value = req.params[key];
  return typeof value === "string" ? value.trim() : "";
}

function isGoalStatus(value: string): value is GoalStatus {
  return GOAL_STATUSES.includes(value as GoalStatus);
}

function isRewindStatus(value: string): value is RewindStatus {
  return REWIND_STATUSES.includes(value as RewindStatus);
}

function pagination(total: number, params: PageParams) {
  return {
    page: params.page,
    limit: params.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.limit)),
  };
}

function displayName(user: { firstName: string | null; lastName: string | null; username: string | null }): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || (user.username ? `@${user.username}` : "Unnamed user");
}

function userStatus(user: { isConfirmed: boolean; suspendedAt: Date | null }): "Confirmed" | "Pending" | "Suspended" {
  if (user.suspendedAt) return "Suspended";
  return user.isConfirmed ? "Confirmed" : "Pending";
}

export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const params = getPageParams(req);
    const search = getSearch(req);
    const where: Prisma.UserWhereInput = search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { username: { contains: search, mode: "insensitive" } },
          ],
        }
      : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          username: true,
          avatarUrl: true,
          timezone: true,
          isConfirmed: true,
          suspendedAt: true,
          role: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              goals: true,
              standardGoals: true,
              rewindSessions: true,
              rewindChats: true,
              communityMemberships: true,
            },
          },
        },
      }),
    ]);

    res.json({
      data: users.map((user) => ({
        id: user.id,
        email: user.email,
        displayName: displayName(user),
        username: user.username,
        avatarUrl: user.avatarUrl,
        timezone: user.timezone,
        role: user.role,
        status: userStatus(user),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        counts: {
          goals: user._count.goals + user._count.standardGoals,
          legacyGoals: user._count.goals,
          standardGoals: user._count.standardGoals,
          rewinds: user._count.rewindSessions,
          chats: user._count.rewindChats,
          communities: user._count.communityMemberships,
        },
      })),
      pagination: pagination(total, params),
    });
  } catch (error) {
    logger.error("List admin users error:", { error });
    res.status(500).json({ msg: "Unable to load users" });
  }
}

export async function getUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = pathParam(req, "userId");
    if (!userId) {
      res.status(400).json({ msg: "User id is required" });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        username: true,
        avatarUrl: true,
        currentMood: true,
        rewindPersona: true,
        timezone: true,
        isConfirmed: true,
        isFirstTime: true,
        suspendedAt: true,
        termsAcceptedAt: true,
        role: true,
        points: true,
        realPointsBalance: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            goals: true,
            standardGoals: true,
            rewindSessions: true,
            rewindChats: true,
            communityMemberships: true,
            achievements: true,
            journals: true,
          },
        },
        subscriptionSnapshots: {
          orderBy: { updatedAt: "desc" },
          select: {
            clientApp: true,
            entitlementId: true,
            isPro: true,
            productIdentifier: true,
            periodType: true,
            environment: true,
            expiresAt: true,
            verifiedAt: true,
            updatedAt: true,
          },
        },
        goals: {
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            goalText: true,
            targetDays: true,
            currentDay: true,
            archivedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        standardGoals: {
          orderBy: { createdAt: "desc" },
          take: 12,
          select: {
            id: true,
            title: true,
            status: true,
            progressValue: true,
            targetValue: true,
            currentStreak: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        rewindSessions: {
          orderBy: { updatedAt: "desc" },
          take: 12,
          select: {
            id: true,
            personaId: true,
            status: true,
            completed: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        communityMemberships: {
          orderBy: { joinedAt: "desc" },
          take: 12,
          select: {
            joinedAt: true,
            community: { select: { id: true, name: true, category: true } },
          },
        },
      },
    });

    if (!user) {
      res.status(404).json({ msg: "User not found" });
      return;
    }

    res.json({
      data: {
        ...user,
        displayName: displayName(user),
        status: userStatus(user),
        counts: {
          goals: user._count.goals + user._count.standardGoals,
          legacyGoals: user._count.goals,
          standardGoals: user._count.standardGoals,
          rewinds: user._count.rewindSessions,
          chats: user._count.rewindChats,
          communities: user._count.communityMemberships,
          achievements: user._count.achievements,
          journals: user._count.journals,
        },
      },
    });
  } catch (error) {
    logger.error("Get admin user error:", { error, userId: pathParam(req, "userId") });
    res.status(500).json({ msg: "Unable to load user" });
  }
}

export async function listGoals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const params = getPageParams(req);
    const search = getSearch(req);
    const requestedStatus = getStatus(req);
    const status = isGoalStatus(requestedStatus) ? requestedStatus : undefined;
    const where: Prisma.GoalV2WhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: "insensitive" } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { user: { username: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [total, goals] = await Promise.all([
      prisma.goalV2.count({ where }),
      prisma.goalV2.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          title: true,
          status: true,
          targetType: true,
          targetValue: true,
          unit: true,
          scheduleType: true,
          progressValue: true,
          completedOccurrences: true,
          missedOccurrences: true,
          currentStreak: true,
          longestStreak: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
          community: { select: { id: true, name: true } },
        },
      }),
    ]);

    res.json({
      data: goals.map((goal) => ({
        ...goal,
        owner: { ...goal.user, displayName: displayName(goal.user) },
        user: undefined,
      })),
      pagination: pagination(total, params),
    });
  } catch (error) {
    logger.error("List admin goals error:", { error });
    res.status(500).json({ msg: "Unable to load goals" });
  }
}

export async function getGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const goalId = pathParam(req, "goalId");
    if (!goalId) {
      res.status(400).json({ msg: "Goal id is required" });
      return;
    }

    const goal = await prisma.goalV2.findUnique({
      where: { id: goalId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        targetType: true,
        targetValue: true,
        unit: true,
        scheduleType: true,
        weekdays: true,
        startDate: true,
        endDate: true,
        hardStopDate: true,
        reminderTimes: true,
        missMode: true,
        graceHours: true,
        breakStreakOnMiss: true,
        forfeitPendingOnMiss: true,
        maxConsecutiveMisses: true,
        rewardReleasePolicy: true,
        progressValue: true,
        completedOccurrences: true,
        missedOccurrences: true,
        currentStreak: true,
        longestStreak: true,
        consecutiveMisses: true,
        pausedAt: true,
        completedAt: true,
        abandonedAt: true,
        archivedAt: true,
        startedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
        community: { select: { id: true, name: true, category: true } },
        occurrences: {
          orderBy: { dueDate: "desc" },
          take: 30,
          select: {
            id: true,
            status: true,
            dueDate: true,
            originalDueDate: true,
            completedAt: true,
            progress: { select: { amount: true, notes: true, createdAt: true } },
          },
        },
        conclusion: {
          select: {
            outcome: true,
            finalProgress: true,
            adherenceRate: true,
            completedOccurrences: true,
            missedOccurrences: true,
            currentStreak: true,
            longestStreak: true,
            durationDays: true,
            earnedPoints: true,
            releasedPoints: true,
            forfeitedPoints: true,
            rating: true,
            reflection: true,
            nextStep: true,
            endedAt: true,
          },
        },
      },
    });

    if (!goal) {
      res.status(404).json({ msg: "Goal not found" });
      return;
    }

    res.json({
      data: {
        ...goal,
        owner: { ...goal.user, displayName: displayName(goal.user) },
        user: undefined,
      },
    });
  } catch (error) {
    logger.error("Get admin goal error:", { error, goalId: pathParam(req, "goalId") });
    res.status(500).json({ msg: "Unable to load goal" });
  }
}

export async function listRewinds(req: AuthRequest, res: Response): Promise<void> {
  try {
    const params = getPageParams(req);
    const search = getSearch(req);
    const requestedStatus = getStatus(req);
    const status = isRewindStatus(requestedStatus) ? requestedStatus : undefined;
    const where: Prisma.RewindSessionWhereInput = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { personaId: { contains: search, mode: "insensitive" } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { user: { username: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const [total, rewinds] = await Promise.all([
      prisma.rewindSession.count({ where }),
      prisma.rewindSession.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          personaId: true,
          voiceProvider: true,
          isTestSession: true,
          sessionDateKey: true,
          status: true,
          completed: true,
          completedAt: true,
          startedAt: true,
          scheduledFor: true,
          summary: true,
          emotionalTags: true,
          transcriptAvailable: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    res.json({
      data: rewinds.map((rewind) => ({
        ...rewind,
        owner: { ...rewind.user, displayName: displayName(rewind.user) },
        user: undefined,
      })),
      pagination: pagination(total, params),
    });
  } catch (error) {
    logger.error("List admin rewinds error:", { error });
    res.status(500).json({ msg: "Unable to load rewinds" });
  }
}

export async function getRewind(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rewindId = pathParam(req, "rewindId");
    if (!rewindId) {
      res.status(400).json({ msg: "Rewind id is required" });
      return;
    }

    const rewind = await prisma.rewindSession.findUnique({
      where: { id: rewindId },
      select: {
        id: true,
        personaId: true,
        voiceProvider: true,
        isTestSession: true,
        sessionDateKey: true,
        timezone: true,
        status: true,
        completionSource: true,
        openingAnswered: true,
        currentQuestionIndex: true,
        completed: true,
        completedAt: true,
        checkInAt: true,
        summary: true,
        emotionalInsight: true,
        emotionalTags: true,
        nextStepNote: true,
        comparisonInsight: true,
        transcriptAvailable: true,
        journalSavedAt: true,
        scheduledFor: true,
        startedAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
        turns: {
          orderBy: { sequence: "asc" },
          select: { id: true, sequence: true, role: true, content: true, createdAt: true },
        },
        recommendations: {
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, status: true, title: true, rationale: true, acceptedAt: true, dismissedAt: true },
        },
      },
    });

    if (!rewind) {
      res.status(404).json({ msg: "Rewind session not found" });
      return;
    }

    res.json({
      data: {
        ...rewind,
        owner: { ...rewind.user, displayName: displayName(rewind.user) },
        user: undefined,
      },
    });
  } catch (error) {
    logger.error("Get admin rewind error:", { error, rewindId: pathParam(req, "rewindId") });
    res.status(500).json({ msg: "Unable to load rewind session" });
  }
}

export async function listCommunities(req: AuthRequest, res: Response): Promise<void> {
  try {
    const params = getPageParams(req);
    const search = getSearch(req);
    const where: Prisma.CommunityWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { category: { contains: search, mode: "insensitive" } },
            { owner: { email: { contains: search, mode: "insensitive" } } },
            { owner: { username: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {};

    const [total, communities] = await Promise.all([
      prisma.community.count({ where }),
      prisma.community.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          name: true,
          description: true,
          category: true,
          isPublic: true,
          createdAt: true,
          updatedAt: true,
          owner: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
          _count: { select: { members: true, templates: true, activities: true, goals: true } },
        },
      }),
    ]);

    res.json({
      data: communities.map((community) => ({
        ...community,
        owner: { ...community.owner, displayName: displayName(community.owner) },
        counts: community._count,
        _count: undefined,
      })),
      pagination: pagination(total, params),
    });
  } catch (error) {
    logger.error("List admin communities error:", { error });
    res.status(500).json({ msg: "Unable to load communities" });
  }
}

export async function getCommunity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const communityId = pathParam(req, "communityId");
    if (!communityId) {
      res.status(400).json({ msg: "Community id is required" });
      return;
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: {
        id: true,
        name: true,
        description: true,
        coverImage: true,
        category: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        owner: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
        _count: { select: { members: true, templates: true, activities: true, goals: true } },
        members: {
          orderBy: { joinedAt: "desc" },
          take: 50,
          select: {
            id: true,
            role: true,
            joinedAt: true,
            user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
          },
        },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            metadata: true,
            createdAt: true,
            user: { select: { id: true, username: true, firstName: true, lastName: true } },
            _count: { select: { reactions: true, comments: true } },
          },
        },
      },
    });

    if (!community) {
      res.status(404).json({ msg: "Community not found" });
      return;
    }

    res.json({
      data: {
        ...community,
        owner: { ...community.owner, displayName: displayName(community.owner) },
        counts: community._count,
        _count: undefined,
        members: community.members.map((member) => ({
          ...member,
          user: { ...member.user, displayName: displayName(member.user) },
        })),
        activities: community.activities.map((activity) => ({
          ...activity,
          user: { ...activity.user, displayName: displayName(activity.user) },
          counts: activity._count,
          _count: undefined,
        })),
      },
    });
  } catch (error) {
    logger.error("Get admin community error:", { error, communityId: pathParam(req, "communityId") });
    res.status(500).json({ msg: "Unable to load community" });
  }
}

export async function listActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const params = getPageParams(req);
    const search = getSearch(req);
    const where: Prisma.ActivitySignalWhereInput = search
      ? {
          OR: [
            { description: { contains: search, mode: "insensitive" } },
            { eventType: { contains: search, mode: "insensitive" } },
            { personaId: { contains: search, mode: "insensitive" } },
            { user: { email: { contains: search, mode: "insensitive" } } },
            { user: { username: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {};

    const [total, activities] = await Promise.all([
      prisma.activitySignal.count({ where }),
      prisma.activitySignal.findMany({
        where,
        orderBy: { happenedAt: "desc" },
        skip: params.skip,
        take: params.limit,
        select: {
          id: true,
          sourceType: true,
          eventType: true,
          localDateKey: true,
          description: true,
          personaId: true,
          happenedAt: true,
          createdAt: true,
          user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
        },
      }),
    ]);

    res.json({
      data: activities.map((activity) => ({
        ...activity,
        user: { ...activity.user, displayName: displayName(activity.user) },
      })),
      pagination: pagination(total, params),
    });
  } catch (error) {
    logger.error("List admin activity error:", { error });
    res.status(500).json({ msg: "Unable to load activity" });
  }
}

export async function getActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const activityId = pathParam(req, "activityId");
    if (!activityId) {
      res.status(400).json({ msg: "Activity id is required" });
      return;
    }

    const activity = await prisma.activitySignal.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        eventType: true,
        localDateKey: true,
        description: true,
        personaId: true,
        metadata: true,
        privacyEligible: true,
        happenedAt: true,
        createdAt: true,
        user: { select: { id: true, email: true, username: true, firstName: true, lastName: true } },
      },
    });

    if (!activity) {
      res.status(404).json({ msg: "Activity not found" });
      return;
    }

    res.json({
      data: {
        ...activity,
        user: { ...activity.user, displayName: displayName(activity.user) },
      },
    });
  } catch (error) {
    logger.error("Get admin activity error:", { error, activityId: pathParam(req, "activityId") });
    res.status(500).json({ msg: "Unable to load activity" });
  }
}
