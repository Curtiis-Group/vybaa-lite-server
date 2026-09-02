import { RewindFrequency } from "@prisma/client";
import type { Response } from "express";

import { prisma } from "../config/db.config";
import type { ClientApp } from "../types/client-app.type";
import {
  FREE_SUBSCRIPTION_LIMITS,
  getLimitsForAccess,
  getRevenueCatSubscriptionStatus,
  type SubscriptionAccess,
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

export type SubscriptionAccessLoader = (
  userId: string,
  clientApp: ClientApp,
) => Promise<SubscriptionAccess | null>;

export type SubscriptionUsageLoader = (userId: string) => Promise<number>;

export interface SubscriptionGateDependencies {
  countActiveGoals?: SubscriptionUsageLoader;
  countOwnedCommunities?: SubscriptionUsageLoader;
  loadAccess?: SubscriptionAccessLoader;
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

async function countActiveGoals(userId: string): Promise<number> {
  const [legacyGoals, standardGoals] = await Promise.all([
    prisma.goal.findMany({
      where: { archivedAt: null, userId },
      select: { currentDay: true, targetDays: true },
    }),
    prisma.goalV2.count({
      where: { archivedAt: null, status: { in: ["ACTIVE", "PAUSED"] }, userId },
    }),
  ]);
  return (
    legacyGoals.filter((goal) => goal.currentDay < goal.targetDays).length +
    standardGoals
  );
}

async function countOwnedCommunities(userId: string): Promise<number> {
  return prisma.community.count({ where: { ownerId: userId } });
}

export async function assertCanCreateGoal(
  userId: string,
  clientApp: ClientApp,
  dependencies: SubscriptionGateDependencies = {},
): Promise<void> {
  if (clientApp !== "vybaa") return;

  const activeGoalCount = await (
    dependencies.countActiveGoals ?? countActiveGoals
  )(userId);
  if (activeGoalCount < FREE_SUBSCRIPTION_LIMITS.activeGoals) return;

  const access = await (dependencies.loadAccess ?? getVybaaAccess)(
    userId,
    clientApp,
  );
  if (access?.isPro) return;

  throw new SubscriptionAccessError(
    "FREE_LIMIT_REACHED",
    `Free accounts can have up to ${FREE_SUBSCRIPTION_LIMITS.activeGoals} active goals`,
  );
}

export async function assertCanCreateCommunity(
  userId: string,
  clientApp: ClientApp,
  dependencies: SubscriptionGateDependencies = {},
): Promise<void> {
  if (clientApp !== "vybaa") return;

  const ownedCommunityCount = await (
    dependencies.countOwnedCommunities ?? countOwnedCommunities
  )(userId);
  if (ownedCommunityCount < FREE_SUBSCRIPTION_LIMITS.ownedCommunities) return;

  const access = await (dependencies.loadAccess ?? getVybaaAccess)(
    userId,
    clientApp,
  );
  if (!access?.isPro) {
    throw new SubscriptionAccessError(
      "FREE_LIMIT_REACHED",
      "Upgrade to Vybaa Pro to create another community",
    );
  }

  const limit = getLimitsForAccess(access).ownedCommunities;
  if (ownedCommunityCount < limit) return;

  throw new SubscriptionAccessError(
    "PLAN_LIMIT_REACHED",
    `Vybaa Pro supports up to ${limit} owned communities`,
  );
}

export async function assertCanUseRewindFrequency(
  userId: string,
  clientApp: ClientApp,
  frequency: RewindFrequency,
  loadAccess: SubscriptionAccessLoader = getVybaaAccess,
): Promise<void> {
  if (!requiresProForRewindFrequency(frequency)) return;

  const access = await loadAccess(userId, clientApp);
  if (access?.isPro) return;

  throw new SubscriptionAccessError(
    "PRO_REQUIRED",
    "Morning and evening or custom Rewind routines require Vybaa Pro",
  );
}

export async function assertCanUseRewindInsightsRange(
  userId: string,
  clientApp: ClientApp,
  range: "7d" | "30d" | "90d",
  loadAccess: SubscriptionAccessLoader = getVybaaAccess,
): Promise<void> {
  if (!requiresProForInsightsRange(range)) return;

  const access = await loadAccess(userId, clientApp);
  if (access?.isPro) return;

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
