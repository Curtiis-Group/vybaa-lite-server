import type { GoalSubtask, Prisma } from "@prisma/client";

import { prisma } from "../config/db.config";
import type {
  CreateSubtaskInput,
  UpdateSubtaskInput,
} from "../validators/goal-subtask.validators";

export class SubtaskError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_SUBTASKS = 100;

export function assertSubtaskEditable(goal: {
  status: string;
  archivedAt: Date | null;
}): void {
  if (goal.status !== "ACTIVE" || goal.archivedAt) {
    throw new SubtaskError(
      409,
      "Subtasks can only change while the task is active",
    );
  }
}

async function ownedGoal(
  client: Prisma.TransactionClient,
  userId: string,
  goalId: string,
  lock: boolean,
) {
  if (lock) {
    // Lock the parent so simultaneous additions cannot exceed the task's limit.
    await client.$queryRaw`SELECT id FROM goals_v2 WHERE id = ${goalId} AND user_id = ${userId} FOR UPDATE`;
  }
  const goal = await client.goalV2.findFirst({
    where: { id: goalId, userId },
    select: { status: true, archivedAt: true },
  });
  if (!goal) throw new SubtaskError(404, "Task not found");
  return goal;
}

function serialize(subtask: GoalSubtask) {
  return {
    id: subtask.id,
    title: subtask.title,
    completedAt: subtask.completedAt?.toISOString() ?? null,
    deletedAt: subtask.deletedAt?.toISOString() ?? null,
    revision: subtask.revision,
    createdAt: subtask.createdAt.toISOString(),
  };
}

export async function listSubtasks(userId: string, goalId: string) {
  await ownedGoal(prisma, userId, goalId, false);
  const subtasks = await prisma.goalSubtask.findMany({
    where: { goalId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_SUBTASKS,
  });
  return subtasks.map(serialize);
}

export async function createSubtask(
  userId: string,
  goalId: string,
  input: CreateSubtaskInput,
) {
  return prisma.$transaction(async (transaction) => {
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
    if (count >= MAX_SUBTASKS)
      throw new SubtaskError(409, "A task can have up to 100 subtasks");
    return serialize(
      await transaction.goalSubtask.create({ data: { ...input, goalId } }),
    );
  });
}

export async function updateSubtask(
  userId: string,
  goalId: string,
  subtaskId: string,
  input: UpdateSubtaskInput,
) {
  return prisma.$transaction(async (transaction) => {
    const goal = await ownedGoal(transaction, userId, goalId, true);
    assertSubtaskEditable(goal);
    const existing = await transaction.goalSubtask.findFirst({
      where: { id: subtaskId, goalId },
    });
    if (!existing) throw new SubtaskError(404, "Subtask not found");
    if (existing.revision !== input.revision)
      throw new SubtaskError(
        409,
        "This subtask changed on another device. Refresh and try again.",
      );
    if (existing.deletedAt && input.deleted !== false)
      throw new SubtaskError(409, "Restore this subtask before editing it");
    if (existing.deletedAt && input.deleted === false) {
      const count = await transaction.goalSubtask.count({
        where: { goalId, deletedAt: null },
      });
      if (count >= MAX_SUBTASKS)
        throw new SubtaskError(409, "A task can have up to 100 subtasks");
    }
    const data: Prisma.GoalSubtaskUpdateInput = {
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
    return serialize(
      await transaction.goalSubtask.update({ where: { id: subtaskId }, data }),
    );
  });
}
