"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRewards = getRewards;
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
                points: true
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
