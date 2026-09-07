"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalAlarmServiceError = exports.GOAL_ALARM_SNOOZE_MINUTES = exports.GOAL_ALARM_WINDOW_DAYS = exports.GOAL_ALARM_LIMIT = void 0;
exports.getGoalAlarmId = getGoalAlarmId;
exports.buildGoalAlarmManifest = buildGoalAlarmManifest;
exports.getGoalAlarmManifest = getGoalAlarmManifest;
exports.updateGoalAlarmRegistration = updateGoalAlarmRegistration;
const node_crypto_1 = require("node:crypto");
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const goal_reminder_util_1 = require("../utils/goal-reminder.util");
const rewind_notification_personalization_util_1 = require("../utils/rewind-notification-personalization.util");
exports.GOAL_ALARM_LIMIT = 64;
exports.GOAL_ALARM_WINDOW_DAYS = 30;
exports.GOAL_ALARM_SNOOZE_MINUTES = 10;
class GoalAlarmServiceError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
exports.GoalAlarmServiceError = GoalAlarmServiceError;
function getGoalAlarmId(occurrenceId, reminderTime) {
    return `goal_v2:${occurrenceId}:${reminderTime}`;
}
function buildGoalAlarmManifest(sources, now, limit = exports.GOAL_ALARM_LIMIT) {
    const upperBound = luxon_1.DateTime.fromJSDate(now)
        .plus({ days: exports.GOAL_ALARM_WINDOW_DAYS })
        .toJSDate();
    const alarms = [];
    for (const source of sources) {
        const dueDateKey = source.dueDate.toISOString().slice(0, 10);
        const preferredName = source.goal.user.firstName ?? source.goal.user.username ?? "there";
        for (const reminderTime of source.goal.reminderTimes) {
            const scheduledFor = luxon_1.DateTime.fromISO(`${dueDateKey}T${reminderTime}:00`, { zone: source.goal.user.timezone || "UTC" });
            if (!scheduledFor.isValid)
                continue;
            const fireAt = scheduledFor.toUTC().toJSDate();
            if (fireAt <= now || fireAt > upperBound)
                continue;
            const id = getGoalAlarmId(source.id, reminderTime);
            const copy = (0, goal_reminder_util_1.buildGoalReminderCopy)({
                goalTitle: source.goal.title,
                preferredName,
                seed: id,
            });
            const presentation = (0, rewind_notification_personalization_util_1.personalizeRewindNotification)({
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
                snoozeMinutes: exports.GOAL_ALARM_SNOOZE_MINUTES,
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
    const revision = (0, node_crypto_1.createHash)("sha256")
        .update(JSON.stringify(selectedAlarms))
        .digest("hex");
    return { alarms: selectedAlarms, revision };
}
async function getGoalAlarmManifest(userId, now = new Date()) {
    const upperBound = luxon_1.DateTime.fromJSDate(now)
        .plus({ days: exports.GOAL_ALARM_WINDOW_DAYS + 1 })
        .toJSDate();
    const sources = await db_config_1.prisma.goalOccurrence.findMany({
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
                status: client_1.GoalV2Status.ACTIVE,
                userId,
            },
            status: {
                in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
            },
        },
    });
    return buildGoalAlarmManifest(sources, now);
}
async function updateGoalAlarmRegistration(params) {
    const device = await db_config_1.prisma.fcmDevice.findFirst({
        select: { id: true },
        where: {
            clientApp: params.clientApp,
            token: params.fcmToken,
            userId: params.userId,
        },
    });
    if (!device) {
        throw new GoalAlarmServiceError("FCM_DEVICE_NOT_FOUND", "Register this device for notifications before enabling goal alarms", 404);
    }
    const manifest = params.enabled
        ? await getGoalAlarmManifest(params.userId)
        : { alarms: [] };
    const allowedIds = new Set(manifest.alarms.map((alarm) => alarm.id));
    const alarmIds = params.enabled
        ? [...new Set(params.alarmIds)].filter((id) => allowedIds.has(id))
        : [];
    const syncedAt = new Date();
    await db_config_1.prisma.fcmDevice.update({
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
