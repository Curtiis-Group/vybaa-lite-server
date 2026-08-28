"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRewards = getRewards;
exports.getRewardTransactions = getRewardTransactions;
exports.getUserTotalRewards = getUserTotalRewards;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Get user's rewards balance and pending points
 */
async function getRewards(req, res) {
    try {
        const userId = req.userId;
        const user = await db_config_1.prisma.user.findUnique({
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
        const pendingPointsRecords = await db_config_1.prisma.goalPendingPoints.findMany({
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
        const activePendingPoints = pendingPointsRecords.filter((record) => record.goal.currentDay < record.goal.targetDays);
        const totalPendingPoints = activePendingPoints.reduce((sum, record) => sum + record.totalPendingPoints, 0);
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
    }
    catch (error) {
        logger_util_1.default.error("Get rewards error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get the user's Play Points ledger. Entries are ordered newest first and
 * include pending awards so the user can follow the balance from award to
 * release.
 */
async function getRewardTransactions(req, res) {
    try {
        const userId = req.userId;
        const requestedLimit = Number(req.query.limit ?? 20);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.floor(requestedLimit), 1), 50)
            : 20;
        const rawCursor = req.query.cursor;
        const cursor = typeof rawCursor === "string" &&
            rawCursor.length > 0 &&
            rawCursor.length <= 512
            ? decodeRewardCursor(rawCursor)
            : null;
        if (rawCursor !== undefined && !cursor) {
            return res.status(400).json({ msg: "Invalid reward transaction cursor" });
        }
        const where = {
            AND: [
                { OR: [{ recipientId: userId }, { senderId: userId }] },
                ...(cursor
                    ? [
                        {
                            OR: [
                                { createdAt: { lt: cursor.createdAt } },
                                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
                            ],
                        },
                    ]
                    : []),
            ],
        };
        const transactions = await db_config_1.prisma.transaction.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: limit + 1,
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
        });
        const hasMore = transactions.length > limit;
        const pageTransactions = hasMore
            ? transactions.slice(0, limit)
            : transactions;
        const lastTransaction = pageTransactions[pageTransactions.length - 1];
        res.json({
            msg: "Reward transactions retrieved successfully",
            data: {
                transactions: pageTransactions.map((transaction) => {
                    let metadata = {};
                    if (transaction.metadata) {
                        try {
                            const parsed = JSON.parse(transaction.metadata);
                            if (parsed &&
                                typeof parsed === "object" &&
                                !Array.isArray(parsed)) {
                                metadata = parsed;
                            }
                        }
                        catch {
                            metadata = {};
                        }
                    }
                    const { recipientId, senderId, metadata: _metadata, ...safeTransaction } = transaction;
                    return {
                        ...safeTransaction,
                        amount: recipientId === userId ? transaction.amount : -transaction.amount,
                        createdAt: transaction.createdAt.toISOString(),
                        metadata: {
                            ...(typeof metadata.goalId === "string"
                                ? { goalId: metadata.goalId }
                                : {}),
                            ...(typeof metadata.milestoneDay === "number"
                                ? { milestoneDay: metadata.milestoneDay }
                                : {}),
                            ...(typeof metadata.milestoneName === "string"
                                ? { milestoneName: metadata.milestoneName.slice(0, 120) }
                                : {}),
                            ...(typeof metadata.source === "string"
                                ? { source: metadata.source.slice(0, 80) }
                                : {}),
                            ...(typeof metadata.state === "string"
                                ? { state: metadata.state.slice(0, 40) }
                                : {}),
                        },
                    };
                }),
                pagination: {
                    limit,
                    hasMore,
                    nextCursor: lastTransaction && hasMore
                        ? encodeRewardCursor(lastTransaction.createdAt, lastTransaction.id)
                        : null,
                },
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get reward transactions error:", {
            error,
            userId: req.userId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
function encodeRewardCursor(createdAt, id) {
    return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id })).toString("base64url");
}
function decodeRewardCursor(value) {
    try {
        const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
        if (!decoded || typeof decoded !== "object")
            return null;
        const candidate = decoded;
        if (typeof candidate.createdAt !== "string" ||
            typeof candidate.id !== "string") {
            return null;
        }
        const createdAt = new Date(candidate.createdAt);
        if (Number.isNaN(createdAt.getTime()) ||
            candidate.id.length === 0 ||
            candidate.id.length > 100) {
            return null;
        }
        return { createdAt, id: candidate.id };
    }
    catch {
        return null;
    }
}
/**
 * Get user's total earned rewards (for display in member lists)
 */
async function getUserTotalRewards(userId) {
    try {
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { points: true },
        });
        return user?.points || 0;
    }
    catch (error) {
        logger_util_1.default.error("Get user total rewards error:", { error, userId });
        return 0;
    }
}
