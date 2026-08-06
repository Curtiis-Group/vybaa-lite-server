import type { Response } from "express";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  getLimitsForAccess,
  getRevenueCatConfig,
  getRevenueCatSubscriptionStatus,
} from "../services/revenuecat.service";
import logger from "../utils/logger.util";

async function getSubscriptionUsage(userId: string): Promise<{
  activeGoals: number;
  ownedCommunities: number;
}> {
  const [goals, ownedCommunities] = await Promise.all([
    prisma.goal.findMany({
      where: { userId },
      select: { currentDay: true, targetDays: true },
    }),
    prisma.community.count({ where: { ownerId: userId } }),
  ]);

  return {
    activeGoals: goals.filter((goal) => goal.currentDay < goal.targetDays).length,
    ownedCommunities,
  };
}

export async function getSubscriptionConfig(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  res.status(200).json({
    msg: "Subscription config retrieved",
    data: getRevenueCatConfig(req.clientApp),
  });
}

export async function getSubscriptionStatus(
  req: AuthRequest,
  res: Response,
): Promise<Response | void> {
  if (!req.userId) {
    return res.status(401).json({ msg: "Authentication required" });
  }

  try {
    const [status, usage] = await Promise.all([
      getRevenueCatSubscriptionStatus(req.userId, req.clientApp),
      getSubscriptionUsage(req.userId),
    ]);

    res.status(200).json({
      msg: "Subscription status retrieved",
      data: { ...status, limits: getLimitsForAccess(status), usage },
    });
  } catch (error) {
    logger.error("Subscription verification failed", {
      clientApp: req.clientApp,
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    res.status(503).json({
      code: "SUBSCRIPTION_UNAVAILABLE",
      msg: "Subscription status is temporarily unavailable",
    });
  }
}

export async function syncSubscriptionStatus(
  req: AuthRequest,
  res: Response,
): Promise<Response | void> {
  if (!req.userId) {
    return res.status(401).json({ msg: "Authentication required" });
  }

  try {
    const status = await getRevenueCatSubscriptionStatus(
      req.userId,
      req.clientApp,
      { forceRefresh: true },
    );
    const usage = await getSubscriptionUsage(req.userId);

    return res.status(200).json({
      msg: "Subscription synchronized",
      data: { ...status, limits: getLimitsForAccess(status), usage },
    });
  } catch (error) {
    logger.error("Subscription synchronization failed", {
      clientApp: req.clientApp,
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    return res.status(503).json({
      code: "SUBSCRIPTION_UNAVAILABLE",
      msg: "Subscription status is temporarily unavailable",
    });
  }
}
