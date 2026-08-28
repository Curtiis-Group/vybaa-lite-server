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
        points: true,
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
      (record) => record.goal.currentDay < record.goal.targetDays,
    );

    const totalPendingPoints = activePendingPoints.reduce(
      (sum, record) => sum + record.totalPendingPoints,
      0,
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
 * Get the user's Play Points ledger. Entries are ordered newest first and
 * include pending awards so the user can follow the balance from award to
 * release.
 */
export async function getRewardTransactions(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const requestedPage = Number(req.query.page ?? 1);
    const requestedLimit = Number(req.query.limit ?? 20);
    const page =
      Number.isFinite(requestedPage) && requestedPage > 0
        ? Math.floor(requestedPage)
        : 1;
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
      : 20;

    const where = {
      OR: [{ recipientId: userId }, { senderId: userId }],
    };
    const [transactions, total] = await prisma.$transaction([
      prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          recipientId: true,
          senderId: true,
          type: true,
          amount: true,
          fiatAmount: true,
          referenceId: true,
          metadata: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({
      msg: "Reward transactions retrieved successfully",
      data: {
        transactions: transactions.map((transaction) => {
          let metadata: Record<string, unknown> = {};
          if (transaction.metadata) {
            try {
              const parsed: unknown = JSON.parse(transaction.metadata);
              if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
              ) {
                metadata = parsed as Record<string, unknown>;
              }
            } catch {
              metadata = {};
            }
          }

          return {
            ...transaction,
            amount:
              transaction.recipientId === userId
                ? transaction.amount
                : -transaction.amount,
            createdAt: transaction.createdAt.toISOString(),
            metadata,
          };
        }),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
        },
      },
    });
  } catch (error) {
    logger.error("Get reward transactions error:", {
      error,
      userId: req.userId,
    });
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
