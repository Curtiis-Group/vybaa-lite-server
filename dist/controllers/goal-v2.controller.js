"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.create = create;
exports.list = list;
exports.detail = detail;
exports.occurrences = occurrences;
exports.update = update;
exports.recordProgress = recordProgress;
exports.correctProgress = correctProgress;
exports.undoProgress = undoProgress;
exports.reschedule = reschedule;
exports.pause = pause;
exports.resume = resume;
exports.abandon = abandon;
exports.archive = archive;
exports.reopen = reopen;
exports.updateReview = updateReview;
exports.permanentlyDelete = permanentlyDelete;
exports.listLegacy = listLegacy;
exports.reopenLegacy = reopenLegacy;
exports.archiveLegacy = archiveLegacy;
exports.deleteLegacy = deleteLegacy;
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const goal_v2_service_1 = require("../services/goal-v2.service");
const goal_v2_reminder_service_1 = require("../services/goal-v2-reminder.service");
const subscription_access_service_1 = require("../services/subscription-access.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
async function resolveTimezone(req, userId) {
    const headerTimezone = req.headers["x-user-tz"];
    const candidate = typeof headerTimezone === "string" ? headerTimezone.trim() : "";
    if (candidate && luxon_1.DateTime.now().setZone(candidate).isValid) {
        const update = await db_config_1.prisma.user.updateMany({
            data: { timezone: candidate },
            where: { id: userId, timezone: { not: candidate } },
        });
        if (update.count > 0) {
            await (0, goal_v2_reminder_service_1.refreshGoalV2RemindersForUser)(userId);
        }
        return candidate;
    }
    const user = await db_config_1.prisma.user.findUnique({
        select: { timezone: true },
        where: { id: userId },
    });
    return user?.timezone && luxon_1.DateTime.now().setZone(user.timezone).isValid
        ? user.timezone
        : "UTC";
}
function handleControllerError(error, req, res, operation) {
    if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
        return;
    if (error instanceof goal_v2_service_1.GoalV2ServiceError) {
        res.status(error.status).json({ code: error.code, msg: error.message });
        return;
    }
    logger_util_1.default.error(`Goal v2 ${operation} error`, {
        errorName: error instanceof Error ? error.name : "UnknownError",
        userId: req.userId,
    });
    res.status(500).json({ msg: "Internal server error" });
}
async function create(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        await (0, subscription_access_service_1.assertCanCreateGoal)(userId, req.clientApp);
        const goal = await (0, goal_v2_service_1.createGoalV2)(userId, timezone, req.body);
        res.status(201).json({ data: goal, msg: "Goal created successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "create");
    }
}
async function list(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const result = await (0, goal_v2_service_1.listGoalsV2)({
            cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
            filter: typeof req.query.filter === "string"
                ? req.query.filter
                : "ACTIVE",
            limit: Number(req.query.limit ?? 20),
            timezone,
            userId,
        });
        res.json({ data: result.goals, msg: "Goals retrieved successfully", pagination: result.pagination });
    }
    catch (error) {
        handleControllerError(error, req, res, "list");
    }
}
async function detail(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.getGoalV2)(String(req.params.goalId), userId, timezone);
        res.json({ data: goal, msg: "Goal retrieved successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "detail");
    }
}
async function occurrences(req, res) {
    try {
        const result = await (0, goal_v2_service_1.listGoalOccurrences)(String(req.params.goalId), req.userId, typeof req.query.cursor === "string" ? req.query.cursor : undefined, Number(req.query.limit ?? 20));
        res.json({ ...result, msg: "Goal occurrences retrieved successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "occurrences");
    }
}
async function update(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.updateGoalV2)(String(req.params.goalId), userId, timezone, req.body);
        res.json({ data: goal, msg: "Goal updated successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "update");
    }
}
async function recordProgress(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.recordGoalProgress)(String(req.params.goalId), String(req.params.occurrenceId), userId, timezone, req.body);
        res.status(201).json({ data: goal, msg: "Progress recorded successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "record progress");
    }
}
async function correctProgress(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.updateGoalProgress)(String(req.params.goalId), String(req.params.occurrenceId), userId, timezone, req.body);
        res.json({ data: goal, msg: "Progress updated successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "correct progress");
    }
}
async function undoProgress(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.deleteGoalProgress)(String(req.params.goalId), String(req.params.occurrenceId), userId, timezone);
        res.json({ data: goal, msg: "Progress removed successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "undo progress");
    }
}
async function reschedule(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.rescheduleGoalOccurrence)(String(req.params.goalId), String(req.params.occurrenceId), userId, timezone, req.body.dueDate);
        res.json({ data: goal, msg: "Occurrence rescheduled successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "reschedule");
    }
}
async function pause(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.pauseGoalV2)(String(req.params.goalId), userId, timezone);
        res.json({ data: goal, msg: "Goal paused successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "pause");
    }
}
async function resume(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.resumeGoalV2)(String(req.params.goalId), userId, timezone, req.body.deadlinePolicy);
        res.json({ data: goal, msg: "Goal resumed successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "resume");
    }
}
async function abandon(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.abandonGoalV2)(String(req.params.goalId), userId, timezone);
        res.json({ data: goal, msg: "Goal abandoned" });
    }
    catch (error) {
        handleControllerError(error, req, res, "abandon");
    }
}
async function archive(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.archiveGoalV2)(String(req.params.goalId), userId, timezone);
        res.json({ data: goal, msg: "Goal archived successfully" });
    }
    catch (error) {
        handleControllerError(error, req, res, "archive");
    }
}
async function reopen(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        await (0, subscription_access_service_1.assertCanCreateGoal)(userId, req.clientApp);
        const goal = await (0, goal_v2_service_1.reopenGoalV2)(String(req.params.goalId), userId, timezone);
        res.status(201).json({ data: goal, msg: "New goal run created" });
    }
    catch (error) {
        handleControllerError(error, req, res, "reopen");
    }
}
async function updateReview(req, res) {
    try {
        const userId = req.userId;
        const timezone = await resolveTimezone(req, userId);
        const goal = await (0, goal_v2_service_1.updateGoalConclusionReview)(String(req.params.goalId), userId, timezone, req.body);
        res.json({ data: goal, msg: "Goal review saved" });
    }
    catch (error) {
        handleControllerError(error, req, res, "update review");
    }
}
async function permanentlyDelete(req, res) {
    try {
        await (0, goal_v2_service_1.permanentlyDeleteGoalV2)(String(req.params.goalId), req.userId);
        res.json({ msg: "Goal permanently deleted" });
    }
    catch (error) {
        handleControllerError(error, req, res, "permanent delete");
    }
}
async function listLegacy(req, res) {
    try {
        const goals = await db_config_1.prisma.goal.findMany({
            include: { community: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            where: { userId: req.userId },
        });
        res.json({
            data: goals.map((goal) => ({
                archivedAt: goal.archivedAt?.toISOString() ?? null,
                community: goal.community,
                currentDay: goal.currentDay,
                id: goal.id,
                isCompleted: goal.currentDay >= goal.targetDays,
                lastCheckInDate: goal.lastCheckInDate?.toISOString() ?? null,
                legacy: true,
                reminderTime: goal.reminderTime,
                startedAt: goal.startedAt.toISOString(),
                targetDays: goal.targetDays,
                title: goal.goalText,
            })),
            msg: "Legacy goals retrieved successfully",
        });
    }
    catch (error) {
        handleControllerError(error, req, res, "list legacy");
    }
}
async function reopenLegacy(req, res) {
    try {
        const userId = req.userId;
        await (0, subscription_access_service_1.assertCanCreateGoal)(userId, req.clientApp);
        const legacyGoal = await db_config_1.prisma.goal.findFirst({
            where: { id: String(req.params.goalId), userId },
        });
        if (!legacyGoal) {
            res.status(404).json({ msg: "Legacy goal not found" });
            return;
        }
        const timezone = await resolveTimezone(req, userId);
        const startDate = luxon_1.DateTime.now().setZone(timezone).toISODate();
        const goal = await (0, goal_v2_service_1.createGoalV2)(userId, timezone, {
            missPolicy: { mode: "STRICT" },
            reminderTimes: legacyGoal.reminderTime ? [legacyGoal.reminderTime] : [],
            rewardReleasePolicy: "ON_COMPLETION",
            schedule: { startDate, type: "DAILY" },
            target: {
                count: Math.min(Math.max(legacyGoal.targetDays, 1), 365),
                type: "CHECK_IN_COUNT",
            },
            title: legacyGoal.goalText,
        });
        res.status(201).json({ data: goal, msg: "New goal started from legacy goal" });
    }
    catch (error) {
        handleControllerError(error, req, res, "reopen legacy");
    }
}
async function archiveLegacy(req, res) {
    try {
        const result = await db_config_1.prisma.goal.updateMany({
            data: { archivedAt: new Date() },
            where: { id: String(req.params.goalId), userId: req.userId },
        });
        if (!result.count) {
            res.status(404).json({ msg: "Legacy goal not found" });
            return;
        }
        res.json({ msg: "Legacy goal archived" });
    }
    catch (error) {
        handleControllerError(error, req, res, "archive legacy");
    }
}
async function deleteLegacy(req, res) {
    try {
        const result = await db_config_1.prisma.goal.deleteMany({
            where: {
                archivedAt: { not: null },
                id: String(req.params.goalId),
                userId: req.userId,
            },
        });
        if (!result.count) {
            res.status(409).json({
                code: "LEGACY_GOAL_MUST_BE_ARCHIVED",
                msg: "Archive this legacy goal before permanently deleting it",
            });
            return;
        }
        res.json({ msg: "Legacy goal permanently deleted" });
    }
    catch (error) {
        handleControllerError(error, req, res, "delete legacy");
    }
}
