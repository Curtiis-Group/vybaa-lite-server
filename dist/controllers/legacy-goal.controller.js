"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listLegacyGoals = listLegacyGoals;
exports.getCurrentLegacyGoal = getCurrentLegacyGoal;
exports.getLegacyGoal = getLegacyGoal;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function serializeLegacyGoal(goal) {
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
async function listLegacyGoals(req, res) {
    try {
        const requestedPage = Number(req.query.page ?? 1);
        const requestedLimit = Number(req.query.limit ?? 10);
        const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
        const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, 100)
            : 10;
        const where = { archivedAt: null, userId: req.userId };
        const [goals, totalCount] = await Promise.all([
            db_config_1.prisma.goal.findMany({
                include: { community: { select: { id: true, name: true } } },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                where,
            }),
            db_config_1.prisma.goal.count({ where }),
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
    }
    catch (error) {
        logger_util_1.default.error("Legacy goals read error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getCurrentLegacyGoal(req, res) {
    try {
        const goal = await db_config_1.prisma.goal.findFirst({
            include: { community: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            where: { archivedAt: null, userId: req.userId },
        });
        res.json({
            data: goal ? serializeLegacyGoal(goal) : null,
            msg: goal ? "Legacy goal retrieved successfully" : "No legacy goal",
        });
    }
    catch (error) {
        logger_util_1.default.error("Current legacy goal read error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getLegacyGoal(req, res) {
    try {
        const goal = await db_config_1.prisma.goal.findFirst({
            include: { community: { select: { id: true, name: true } } },
            where: {
                archivedAt: null,
                id: String(req.params.goalId),
                userId: req.userId,
            },
        });
        if (!goal) {
            res.status(404).json({ data: null, msg: "Legacy goal not found" });
            return;
        }
        res.json({ data: serializeLegacyGoal(goal), msg: "Legacy goal retrieved successfully" });
    }
    catch (error) {
        logger_util_1.default.error("Legacy goal read error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
