"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleGoalV2Reminders = scheduleGoalV2Reminders;
exports.refreshGoalV2RemindersForUser = refreshGoalV2RemindersForUser;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const goal_alarm_service_1 = require("./goal-alarm.service");
const notification_service_1 = require("./notification.service");
async function scheduleGoalV2Reminders(now = new Date(), userId) {
    const upperBound = luxon_1.DateTime.fromJSDate(now).plus({ days: 2 }).toJSDate();
    const occurrences = await db_config_1.prisma.goalOccurrence.findMany({
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
                status: client_1.GoalV2Status.ACTIVE,
                ...(userId ? { userId } : {}),
            },
            status: {
                in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
            },
        },
    });
    let scheduled = 0;
    for (const occurrence of occurrences) {
        const dueDateKey = occurrence.dueDate.toISOString().slice(0, 10);
        const timezone = occurrence.goal.user.timezone || "UTC";
        for (const reminderTime of occurrence.goal.reminderTimes) {
            const alarmId = (0, goal_alarm_service_1.getGoalAlarmId)(occurrence.id, reminderTime);
            const scheduledFor = luxon_1.DateTime.fromISO(`${dueDateKey}T${reminderTime}:00`, { zone: timezone });
            if (!scheduledFor.isValid || scheduledFor.toJSDate() <= now)
                continue;
            const preferredName = occurrence.goal.user.firstName ??
                occurrence.goal.user.username ??
                "there";
            const notification = await notification_service_1.notificationService.createNotification({
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
            if (notification)
                scheduled += 1;
        }
    }
    return scheduled;
}
async function refreshGoalV2RemindersForUser(userId, now = new Date()) {
    await db_config_1.prisma.notification.deleteMany({
        where: {
            scheduledFor: { gt: now },
            sentAt: null,
            type: "goal_v2_reminder",
            userId,
        },
    });
    return scheduleGoalV2Reminders(now, userId);
}
