import { RewindFrequency } from "@prisma/client";
import type { Response } from "express";

import { prisma } from "../config/db.config";
import type { ClientApp } from "../types/client-app.type";
import {
  getLimitsForAccess,
  getRevenueCatSubscriptionStatus,
} from "./revenuecat.service";

export type SubscriptionErrorCode =
  | "FREE_LIMIT_REACHED"
  | "PLAN_LIMIT_REACHED"
  | "PRO_REQUIRED"
  | "SUBSCRIPTION_UNAVAILABLE";

export class SubscriptionAccessError extends Error {
  public readonly code: SubscriptionErrorCode;
  public readonly statusCode: number;

  public constructor(
    code: SubscriptionErrorCode,
    message: string,
    statusCode: number = 403,
  ) {
    super(message);
    this.name = "SubscriptionAccessError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function requiresProForRewindFrequency(
  frequency: RewindFrequency,
): boolean {
  return (
    frequency === RewindFrequency.MORNINGS_AND_EVENINGS ||
    frequency === RewindFrequency.CUSTOM
  );
}

export function requiresProForInsightsRange(
  range: "7d" | "30d" | "90d",
): boolean {
  return range !== "7d";
}

async function getVybaaAccess(userId: string, clientApp: ClientApp) {
  if (clientApp !== "vybaa") return null;

  try {
    return await getRevenueCatSubscriptionStatus(userId, clientApp);
  } catch {
    throw new SubscriptionAccessError(
      "SUBSCRIPTION_UNAVAILABLE",
      "Subscription status is temporarily unavailable",
      503,
    );
  }
}

export async function assertCanCreateGoal(
  userId: string,
  clientApp: ClientApp,
): Promise<void> {
  const access = await getVybaaAccess(userId, clientApp);
  if (!access) return;

  const limit = getLimitsForAccess(access).activeGoals;
  if (limit === null) return;

  const goals = await prisma.goal.findMany({
    where: { userId },
    select: { currentDay: true, targetDays: true },
  });
  const activeGoalCount = goals.filter(
    (goal) => goal.currentDay < goal.targetDays,
  ).length;

  if (activeGoalCount >= limit) {
    throw new SubscriptionAccessError(
      "FREE_LIMIT_REACHED",
      `Free accounts can have up to ${limit} active goals`,
    );
  }
}

export async function assertCanCreateCommunity(
  userId: string,
  clientApp: ClientApp,
): Promise<void> {
  const access = await getVybaaAccess(userId, clientApp);
  if (!access) return;

  const limit = getLimitsForAccess(access).ownedCommunities;
  const ownedCommunityCount = await prisma.community.count({
    where: { ownerId: userId },
  });

  if (ownedCommunityCount >= limit) {
    throw new SubscriptionAccessError(
      access.isPro ? "PLAN_LIMIT_REACHED" : "FREE_LIMIT_REACHED",
      access.isPro
        ? `Vybaa Pro supports up to ${limit} owned communities`
        : "Upgrade to Vybaa Pro to create another community",
    );
  }
}

export async function assertCanUseRewindFrequency(
  userId: string,
  clientApp: ClientApp,
  frequency: RewindFrequency,
): Promise<void> {
  const access = await getVybaaAccess(userId, clientApp);
  if (!access || access.isPro) return;

  if (requiresProForRewindFrequency(frequency)) {
    throw new SubscriptionAccessError(
      "PRO_REQUIRED",
      "Morning and evening or custom Rewind routines require Vybaa Pro",
    );
  }
}

export async function assertCanUseRewindInsightsRange(
  userId: string,
  clientApp: ClientApp,
  range: "7d" | "30d" | "90d",
): Promise<void> {
  const access = await getVybaaAccess(userId, clientApp);
  if (!access || access.isPro || !requiresProForInsightsRange(range)) return;

  throw new SubscriptionAccessError(
    "PRO_REQUIRED",
    `${range === "30d" ? "30-day" : "90-day"} Rewind insights require Vybaa Pro`,
  );
}

export function handleSubscriptionAccessError(
  error: unknown,
  res: Response,
): boolean {
  if (!(error instanceof SubscriptionAccessError)) return false;

  res.status(error.statusCode).json({ code: error.code, msg: error.message });
  return true;
}
