import { GoalOccurrenceStatus, GoalV2Status } from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import { getGoalAlarmId } from "./goal-alarm.service";
import { notificationService } from "./notification.service";

export async function scheduleGoalV2Reminders(
  now = new Date(),
  userId?: string,
): Promise<number> {
  const upperBound = DateTime.fromJSDate(now).plus({ days: 2 }).toJSDate();
  const occurrences = await prisma.goalOccurrence.findMany({
    include: {
      goal: {
        include: {
          user: { select: { firstName: true, timezone: true, username: true } },
        },
      },
    },
    where: {
      dueDate: { lte: upperBound },
      goal: {
        reminderTimes: { isEmpty: false },
        status: GoalV2Status.ACTIVE,
        ...(userId ? { userId } : {}),
      },
      status: {
        in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
      },
    },
  });
  let scheduled = 0;
  for (const occurrence of occurrences) {
    const dueDateKey = occurrence.dueDate.toISOString().slice(0, 10);
    const timezone = occurrence.goal.user.timezone || "UTC";
    for (const reminderTime of occurrence.goal.reminderTimes) {
      const alarmId = getGoalAlarmId(occurrence.id, reminderTime);
      const scheduledFor = DateTime.fromISO(
        `${dueDateKey}T${reminderTime}:00`,
        { zone: timezone },
      );
      if (!scheduledFor.isValid || scheduledFor.toJSDate() <= now) continue;
      const preferredName =
        occurrence.goal.user.firstName ??
        occurrence.goal.user.username ??
        "there";
      const notification = await notificationService.createNotification({
        data: {
          alarmId,
          goalId: occurrence.goal.id,
          occurrenceId: occurrence.id,
          route: `/app/goal?goalId=${encodeURIComponent(occurrence.goal.id)}`,
        },
        dedupeKey: `goal_v2_reminder:${occurrence.id}:${reminderTime}`,
        goalId: occurrence.goal.id,
        message: `Hi ${preferredName}, ${occurrence.goal.title} is due today.`,
        scheduledFor: scheduledFor.toUTC().toJSDate(),
        title: `${occurrence.goal.title} check-in`,
        type: "goal_v2_reminder",
        userId: occurrence.goal.userId,
      });
      if (notification) scheduled += 1;
    }
  }
  return scheduled;
}

export async function refreshGoalV2RemindersForUser(
  userId: string,
  now = new Date(),
): Promise<number> {
  await prisma.notification.deleteMany({
    where: {
      scheduledFor: { gt: now },
      sentAt: null,
      type: "goal_v2_reminder",
      userId,
    },
  });
  return scheduleGoalV2Reminders(now, userId);
}
