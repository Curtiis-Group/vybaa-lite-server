import { createHash } from "node:crypto";

import type { ClientApp } from "@prisma/client";
import { GoalOccurrenceStatus, GoalV2Status } from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import { buildGoalReminderCopy } from "../utils/goal-reminder.util";
import { personalizeRewindNotification } from "../utils/rewind-notification-personalization.util";

export const GOAL_ALARM_LIMIT = 64;
export const GOAL_ALARM_WINDOW_DAYS = 30;
export const GOAL_ALARM_SNOOZE_MINUTES = 10;

export type GoalAlarmManifestItem = {
  body: string;
  fireAt: string;
  goalId: string;
  id: string;
  occurrenceId: string;
  route: string;
  snoozeMinutes: number;
  title: string;
};

type GoalAlarmSource = {
  dueDate: Date;
  id: string;
  goal: {
    id: string;
    reminderTimes: string[];
    title: string;
    user: {
      firstName: string | null;
      rewindPersona: string | null;
      timezone: string;
      username: string | null;
    };
  };
};

export type GoalAlarmManifest = {
  alarms: GoalAlarmManifestItem[];
  revision: string;
};

export class GoalAlarmServiceError extends Error {
  public readonly code: string;
  public readonly status: number;

  public constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getGoalAlarmId(
  occurrenceId: string,
  reminderTime: string,
): string {
  return `goal_v2:${occurrenceId}:${reminderTime}`;
}

export function buildGoalAlarmManifest(
  sources: GoalAlarmSource[],
  now: Date,
  limit = GOAL_ALARM_LIMIT,
): GoalAlarmManifest {
  const upperBound = DateTime.fromJSDate(now)
    .plus({ days: GOAL_ALARM_WINDOW_DAYS })
    .toJSDate();
  const alarms: GoalAlarmManifestItem[] = [];

  for (const source of sources) {
    const dueDateKey = source.dueDate.toISOString().slice(0, 10);
    const preferredName =
      source.goal.user.firstName ?? source.goal.user.username ?? "there";
    for (const reminderTime of source.goal.reminderTimes) {
      const scheduledFor = DateTime.fromISO(
        `${dueDateKey}T${reminderTime}:00`,
        { zone: source.goal.user.timezone || "UTC" },
      );
      if (!scheduledFor.isValid) continue;
      const fireAt = scheduledFor.toUTC().toJSDate();
      if (fireAt <= now || fireAt > upperBound) continue;

      const id = getGoalAlarmId(source.id, reminderTime);
      const copy = buildGoalReminderCopy({
        goalTitle: source.goal.title,
        preferredName,
        seed: id,
      });
      const presentation = personalizeRewindNotification({
        data: {
          alarmId: id,
          goalId: source.goal.id,
          occurrenceId: source.id,
          route: `/app/goal/${encodeURIComponent(source.goal.id)}`,
        },
        message: copy.message,
        selectedPersonaId: source.goal.user.rewindPersona,
        title: copy.title,
        type: "goal_v2_reminder",
      });
      alarms.push({
        body: presentation.message,
        fireAt: fireAt.toISOString(),
        goalId: source.goal.id,
        id,
        occurrenceId: source.id,
        route: `/app/goal/${encodeURIComponent(source.goal.id)}`,
        snoozeMinutes: GOAL_ALARM_SNOOZE_MINUTES,
        title: presentation.title,
      });
    }
  }

  const selectedAlarms = alarms
    .sort((left, right) => {
      const timeDifference = left.fireAt.localeCompare(right.fireAt);
      return timeDifference || left.id.localeCompare(right.id);
    })
    .slice(0, limit);
  const revision = createHash("sha256")
    .update(JSON.stringify(selectedAlarms))
    .digest("hex");
  return { alarms: selectedAlarms, revision };
}

export async function getGoalAlarmManifest(
  userId: string,
  now = new Date(),
): Promise<GoalAlarmManifest> {
  const upperBound = DateTime.fromJSDate(now)
    .plus({ days: GOAL_ALARM_WINDOW_DAYS + 1 })
    .toJSDate();
  const sources = await prisma.goalOccurrence.findMany({
    include: {
      goal: {
        include: {
          user: {
            select: {
              firstName: true,
              rewindPersona: true,
              timezone: true,
              username: true,
            },
          },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    where: {
      dueDate: { lte: upperBound },
      goal: {
        reminderTimes: { isEmpty: false },
        status: GoalV2Status.ACTIVE,
        userId,
      },
      status: {
        in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
      },
    },
  });
  return buildGoalAlarmManifest(sources, now);
}

export async function updateGoalAlarmRegistration(params: {
  alarmIds: string[];
  clientApp: ClientApp;
  enabled: boolean;
  fcmToken: string;
  userId: string;
}): Promise<{ alarmIds: string[]; enabled: boolean; syncedAt: string }> {
  const device = await prisma.fcmDevice.findFirst({
    select: { id: true },
    where: {
      clientApp: params.clientApp,
      token: params.fcmToken,
      userId: params.userId,
    },
  });

  
  if (!device) {
    throw new GoalAlarmServiceError(
      "FCM_DEVICE_NOT_FOUND",
      "Register this device for notifications before enabling goal alarms",
      404,
    );
  }

  const manifest = params.enabled
    ? await getGoalAlarmManifest(params.userId)
    : { alarms: [] };
  const allowedIds = new Set(manifest.alarms.map((alarm) => alarm.id));
  const alarmIds = params.enabled
    ? [...new Set(params.alarmIds)].filter((id) => allowedIds.has(id))
    : [];
  const syncedAt = new Date();
  await prisma.fcmDevice.update({
    data: {
      goalAlarmIds: alarmIds,
      goalAlarmsEnabled: params.enabled,
      goalAlarmsSyncedAt: syncedAt,
    },
    where: { id: device?.id },
  });
  return {
    alarmIds,
    enabled: params.enabled,
    syncedAt: syncedAt.toISOString(),
  };
}
