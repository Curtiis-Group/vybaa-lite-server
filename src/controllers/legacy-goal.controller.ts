import type { Response } from "express";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

function serializeLegacyGoal(goal: {
  community: null | { id: string; name: string };
  communityId: null | string;
  createdAt: Date;
  currentDay: number;
  goalText: string;
  id: string;
  lastCheckInDate: Date | null;
  reminderTime: null | string;
  startedAt: Date;
  targetDays: number;
  templateId: null | string;
}) {
  return {
    canCheckIn: false,
    community: goal.community,
    communityId: goal.communityId,
    createdAt: goal.createdAt.toISOString(),
    currentDay: goal.currentDay,
    goalText: goal.goalText,
    id: goal.id,
    lastCheckInDate: goal.lastCheckInDate?.toISOString() ?? null,
    legacy: true,
    reminderTime: goal.reminderTime,
    startedAt: goal.startedAt.toISOString(),
    targetDays: goal.targetDays,
    templateId: goal.templateId,
  };
}

export async function listLegacyGoals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const requestedPage = Number(req.query.page ?? 1);
    const requestedLimit = Number(req.query.limit ?? 10);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit =
      Number.isInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 100)
        : 10;
    const where = { archivedAt: null, userId: req.userId! };
    const [goals, totalCount] = await Promise.all([
      prisma.goal.findMany({
        include: { community: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        where,
      }),
      prisma.goal.count({ where }),
    ]);
    const totalPages = Math.ceil(totalCount / limit);
    res.json({
      data: goals.map(serializeLegacyGoal),
      msg: "Legacy goals retrieved successfully",
      pagination: {
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
        limit,
        page,
        totalCount,
        totalPages,
      },
    });
  } catch (error) {
    logger.error("Legacy goals read error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getCurrentLegacyGoal(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const goal = await prisma.goal.findFirst({
      include: { community: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      where: { archivedAt: null, userId: req.userId! },
    });
    res.json({
      data: goal ? serializeLegacyGoal(goal) : null,
      msg: goal ? "Legacy goal retrieved successfully" : "No legacy goal",
    });
  } catch (error) {
    logger.error("Current legacy goal read error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getLegacyGoal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const goal = await prisma.goal.findFirst({
      include: { community: { select: { id: true, name: true } } },
      where: {
        archivedAt: null,
        id: String(req.params.goalId),
        userId: req.userId!,
      },
    });
    if (!goal) {
      res.status(404).json({ data: null, msg: "Legacy goal not found" });
      return;
    }
    res.json({ data: serializeLegacyGoal(goal), msg: "Legacy goal retrieved successfully" });
  } catch (error) {
    logger.error("Legacy goal read error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}
