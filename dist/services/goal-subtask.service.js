"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SUBTASKS = exports.SubtaskError = void 0;
exports.assertSubtaskEditable = assertSubtaskEditable;
exports.listSubtasks = listSubtasks;
exports.createSubtask = createSubtask;
exports.updateSubtask = updateSubtask;
const db_config_1 = require("../config/db.config");
class SubtaskError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.SubtaskError = SubtaskError;
exports.MAX_SUBTASKS = 100;
function assertSubtaskEditable(goal) {
    if (goal.status !== "ACTIVE" || goal.archivedAt) {
        throw new SubtaskError(409, "Subtasks can only change while the task is active");
    }
}
async function ownedGoal(client, userId, goalId, lock) {
    if (lock) {
        // Lock the parent so simultaneous additions cannot exceed the task's limit.
        await client.$queryRaw `SELECT id FROM goals_v2 WHERE id = ${goalId} AND user_id = ${userId} FOR UPDATE`;
    }
    const goal = await client.goalV2.findFirst({
        where: { id: goalId, userId },
        select: { status: true, archivedAt: true },
    });
    if (!goal)
        throw new SubtaskError(404, "Task not found");
    return goal;
}
function serialize(subtask) {
    return {
        id: subtask.id,
        title: subtask.title,
        completedAt: subtask.completedAt?.toISOString() ?? null,
        deletedAt: subtask.deletedAt?.toISOString() ?? null,
        revision: subtask.revision,
        createdAt: subtask.createdAt.toISOString(),
    };
}
async function listSubtasks(userId, goalId) {
    await ownedGoal(db_config_1.prisma, userId, goalId, false);
    const subtasks = await db_config_1.prisma.goalSubtask.findMany({
        where: { goalId, deletedAt: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: exports.MAX_SUBTASKS,
    });
    return subtasks.map(serialize);
}
async function createSubtask(userId, goalId, input) {
    return db_config_1.prisma.$transaction(async (transaction) => {
        const goal = await ownedGoal(transaction, userId, goalId, true);
        const existing = await transaction.goalSubtask.findUnique({
            where: { id: input.id },
        });
        if (existing) {
            if (existing.goalId !== goalId)
                throw new SubtaskError(404, "Subtask not found");
            if (existing.title !== input.title || existing.deletedAt)
                throw new SubtaskError(409, "This subtask request was already used");
            return serialize(existing);
        }
        assertSubtaskEditable(goal);
        const count = await transaction.goalSubtask.count({
            where: { goalId, deletedAt: null },
        });
        if (count >= exports.MAX_SUBTASKS)
            throw new SubtaskError(409, "A task can have up to 100 subtasks");
        return serialize(await transaction.goalSubtask.create({ data: { ...input, goalId } }));
    });
}
async function updateSubtask(userId, goalId, subtaskId, input) {
    return db_config_1.prisma.$transaction(async (transaction) => {
        const goal = await ownedGoal(transaction, userId, goalId, true);
        assertSubtaskEditable(goal);
        const existing = await transaction.goalSubtask.findFirst({
            where: { id: subtaskId, goalId },
        });
        if (!existing)
            throw new SubtaskError(404, "Subtask not found");
        if (existing.revision !== input.revision)
            throw new SubtaskError(409, "This subtask changed on another device. Refresh and try again.");
        if (existing.deletedAt && input.deleted !== false)
            throw new SubtaskError(409, "Restore this subtask before editing it");
        if (existing.deletedAt && input.deleted === false) {
            const count = await transaction.goalSubtask.count({
                where: { goalId, deletedAt: null },
            });
            if (count >= exports.MAX_SUBTASKS)
                throw new SubtaskError(409, "A task can have up to 100 subtasks");
        }
        const data = {
            revision: { increment: 1 },
            title: input.title,
            ...(input.completed !== undefined
                ? {
                    completedAt: input.completed
                        ? (existing.completedAt ?? new Date())
                        : null,
                }
                : {}),
            ...(input.deleted !== undefined
                ? { deletedAt: input.deleted ? new Date() : null }
                : {}),
        };
        return serialize(await transaction.goalSubtask.update({ where: { id: subtaskId }, data }));
    });
}
