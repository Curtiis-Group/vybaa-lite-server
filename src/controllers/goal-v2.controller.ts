import { DateTime } from "luxon";
import type { Response } from "express";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  getGoalAlarmManifest,
  GoalAlarmServiceError,
  updateGoalAlarmRegistration,
} from "../services/goal-alarm.service";
import {
  abandonGoalV2,
  archiveGoalV2,
  createGoalV2,
  deleteGoalProgress,
  getGoalV2,
  GoalV2ServiceError,
  listGoalOccurrences,
  listGoalsV2,
  pauseGoalV2,
  permanentlyDeleteGoalV2,
  recordGoalProgress,
  reopenGoalV2,
  rescheduleGoalOccurrence,
  resumeGoalV2,
  updateGoalConclusionReview,
  updateGoalProgress,
  updateGoalV2,
} from "../services/goal-v2.service";
import { refreshGoalV2RemindersForUser } from "../services/goal-v2-reminder.service";
import {
  generateQuickGoalSetup,
  QuickGoalSetupError,
} from "../services/quick-goal-setup.service";
import {
  assertCanCreateGoal,
  handleSubscriptionAccessError,
} from "../services/subscription-access.service";
import { toPrismaClientApp } from "../types/client-app.type";
import logger from "../utils/logger.util";

async function resolveTimezone(
  req: AuthRequest,
  userId: string,
): Promise<string> {
  const headerTimezone = req.headers["x-user-tz"];
  const candidate =
    typeof headerTimezone === "string" ? headerTimezone.trim() : "";
  if (candidate && DateTime.now().setZone(candidate).isValid) {
    const update = await prisma.user.updateMany({
      data: { timezone: candidate },
      where: { id: userId, timezone: { not: candidate } },
    });
    if (update.count > 0) {
      await refreshGoalV2RemindersForUser(userId);
    }
    return candidate;
  }
  const user = await prisma.user.findUnique({
    select: { timezone: true },
    where: { id: userId },
  });
  return user?.timezone && DateTime.now().setZone(user.timezone).isValid
    ? user.timezone
    : "UTC";
}

function handleControllerError(
  error: unknown,
  req: AuthRequest,
  res: Response,
  operation: string,
): void {
  if (handleSubscriptionAccessError(error, res)) return;
  if (error instanceof GoalV2ServiceError) {
    res.status(error.status).json({ code: error.code, msg: error.message });
    return;
  }
  if (error instanceof QuickGoalSetupError) {
    res
      .status(error.status)
      .json({ code: "QUICK_GOAL_SETUP_FAILED", msg: error.message });
    return;
  }
  if (error instanceof GoalAlarmServiceError) {
    res.status(error.status).json({ code: error.code, msg: error.message });
    return;
  }
  logger.error(`Goal v2 ${operation} error`, {
    errorName: error instanceof Error ? error.name : "UnknownError",
    userId: req.userId,
  });
  res.status(500).json({ msg: "Internal server error" });
}

export async function alarmManifest(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    await resolveTimezone(req, userId);
    const manifest = await getGoalAlarmManifest(userId);
    res.json({ data: manifest, msg: "Goal alarm manifest retrieved" });
  } catch (error) {
    handleControllerError(error, req, res, "alarm manifest");
  }
}

export async function alarmRegistration(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const registration = await updateGoalAlarmRegistration({
      alarmIds: req.body.alarmIds,
      clientApp: toPrismaClientApp(req.clientApp),
      enabled: req.body.enabled,
      fcmToken: req.body.fcmToken,
      userId: req.userId!,
    });
    res.json({ data: registration, msg: "Goal alarm registration updated" });
  } catch (error) {
    handleControllerError(error, req, res, "alarm registration");
  }
}

export async function quickSetup(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const [timezone, user] = await Promise.all([
      resolveTimezone(req, userId),
      prisma.user.findUnique({
        select: { rewindPersona: true },
        where: { id: userId },
      }),
    ]);
    const draft = await generateQuickGoalSetup(
      timezone,
      req.body,
      user?.rewindPersona ?? null,
    );
    res.json({ data: draft, msg: "Goal setup generated" });
  } catch (error) {
    handleControllerError(error, req, res, "quick setup");
  }
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    await assertCanCreateGoal(userId, req.clientApp);
    const goal = await createGoalV2(userId, timezone, req.body);
    res.status(201).json({ data: goal, msg: "Goal created successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "create");
  }
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const result = await listGoalsV2({
      cursor:
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      filter:
        typeof req.query.filter === "string"
          ? (req.query.filter as
              "ACTIVE" | "ARCHIVED" | "DUE" | "ENDED" | "OVERDUE" | "PAUSED")
          : "ACTIVE",
      limit: Number(req.query.limit ?? 20),
      timezone,
      userId,
    });
    res.json({
      data: result.goals,
      msg: "Goals retrieved successfully",
      pagination: result.pagination,
    });
  } catch (error) {
    handleControllerError(error, req, res, "list");
  }
}

export async function detail(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await getGoalV2(String(req.params.goalId), userId, timezone);
    res.json({ data: goal, msg: "Goal retrieved successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "detail");
  }
}

export async function occurrences(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await listGoalOccurrences(
      String(req.params.goalId),
      req.userId!,
      typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      Number(req.query.limit ?? 20),
    );
    res.json({ ...result, msg: "Goal occurrences retrieved successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "occurrences");
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await updateGoalV2(
      String(req.params.goalId),
      userId,
      timezone,
      req.body,
    );
    res.json({ data: goal, msg: "Goal updated successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "update");
  }
}

export async function recordProgress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await recordGoalProgress(
      String(req.params.goalId),
      String(req.params.occurrenceId),
      userId,
      timezone,
      req.body,
    );
    res.status(201).json({ data: goal, msg: "Progress recorded successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "record progress");
  }
}

export async function correctProgress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await updateGoalProgress(
      String(req.params.goalId),
      String(req.params.occurrenceId),
      userId,
      timezone,
      req.body,
    );
    res.json({ data: goal, msg: "Progress updated successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "correct progress");
  }
}

export async function undoProgress(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await deleteGoalProgress(
      String(req.params.goalId),
      String(req.params.occurrenceId),
      userId,
      timezone,
    );
    res.json({ data: goal, msg: "Progress removed successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "undo progress");
  }
}

export async function reschedule(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await rescheduleGoalOccurrence(
      String(req.params.goalId),
      String(req.params.occurrenceId),
      userId,
      timezone,
      req.body.dueDate,
    );
    res.json({ data: goal, msg: "Occurrence rescheduled successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "reschedule");
  }
}

export async function pause(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await pauseGoalV2(String(req.params.goalId), userId, timezone);
    res.json({ data: goal, msg: "Goal paused successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "pause");
  }
}

export async function resume(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await resumeGoalV2(
      String(req.params.goalId),
      userId,
      timezone,
      req.body.deadlinePolicy,
    );
    res.json({ data: goal, msg: "Goal resumed successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "resume");
  }
}

export async function abandon(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await abandonGoalV2(
      String(req.params.goalId),
      userId,
      timezone,
    );
    res.json({ data: goal, msg: "Goal abandoned" });
  } catch (error) {
    handleControllerError(error, req, res, "abandon");
  }
}

export async function archive(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await archiveGoalV2(
      String(req.params.goalId),
      userId,
      timezone,
    );
    res.json({ data: goal, msg: "Goal archived successfully" });
  } catch (error) {
    handleControllerError(error, req, res, "archive");
  }
}

export async function reopen(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    await assertCanCreateGoal(userId, req.clientApp);
    const goal = await reopenGoalV2(
      String(req.params.goalId),
      userId,
      timezone,
    );
    res.status(201).json({ data: goal, msg: "New goal run created" });
  } catch (error) {
    handleControllerError(error, req, res, "reopen");
  }
}

export async function updateReview(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await resolveTimezone(req, userId);
    const goal = await updateGoalConclusionReview(
      String(req.params.goalId),
      userId,
      timezone,
      req.body,
    );
    res.json({ data: goal, msg: "Goal review saved" });
  } catch (error) {
    handleControllerError(error, req, res, "update review");
  }
}

export async function permanentlyDelete(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    await permanentlyDeleteGoalV2(String(req.params.goalId), req.userId!);
    res.json({ msg: "Goal permanently deleted" });
  } catch (error) {
    handleControllerError(error, req, res, "permanent delete");
  }
}

export async function listLegacy(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const goals = await prisma.goal.findMany({
      include: { community: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      where: { userId: req.userId! },
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
  } catch (error) {
    handleControllerError(error, req, res, "list legacy");
  }
}

export async function reopenLegacy(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    await assertCanCreateGoal(userId, req.clientApp);
    const legacyGoal = await prisma.goal.findFirst({
      where: { id: String(req.params.goalId), userId },
    });
    if (!legacyGoal) {
      res.status(404).json({ msg: "Legacy goal not found" });
      return;
    }
    const timezone = await resolveTimezone(req, userId);
    const startDate = DateTime.now().setZone(timezone).toISODate()!;
    const goal = await createGoalV2(userId, timezone, {
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
    res
      .status(201)
      .json({ data: goal, msg: "New goal started from legacy goal" });
  } catch (error) {
    handleControllerError(error, req, res, "reopen legacy");
  }
}

export async function archiveLegacy(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await prisma.goal.updateMany({
      data: { archivedAt: new Date() },
      where: { id: String(req.params.goalId), userId: req.userId! },
    });
    if (!result.count) {
      res.status(404).json({ msg: "Legacy goal not found" });
      return;
    }
    res.json({ msg: "Legacy goal archived" });
  } catch (error) {
    handleControllerError(error, req, res, "archive legacy");
  }
}

export async function deleteLegacy(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await prisma.goal.deleteMany({
      where: {
        archivedAt: { not: null },
        id: String(req.params.goalId),
        userId: req.userId!,
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
  } catch (error) {
    handleControllerError(error, req, res, "delete legacy");
  }
}
