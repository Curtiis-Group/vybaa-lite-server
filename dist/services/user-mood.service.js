"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userMoodService = void 0;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const CURRENT_MOOD_REFRESH_WINDOW_MS = 24 * 60 * 60 * 1000;
function shouldReuseCurrentMood(currentMood, updatedAt) {
    if (!currentMood) {
        return false;
    }
    return Date.now() - updatedAt.getTime() < CURRENT_MOOD_REFRESH_WINDOW_MS;
}
function roundToWholePercent(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
}
function deriveMoodFromSignals(signals) {
    if (signals.recentActivityCount === 0 &&
        signals.rewindCompletedCount === 0 &&
        signals.recentCompletedChillCount === 0) {
        return "Quiet";
    }
    if (signals.averageGoalProgress >= 75 &&
        signals.recentCheckInCount >= 2 &&
        signals.rewindCompletedCount > 0) {
        return "Focused";
    }
    if (signals.completedGoalCount > 0 ||
        (signals.averageGoalProgress >= 60 && signals.recentActivityCount >= 3)) {
        return "Confident";
    }
    if (signals.rewindCompletedCount > 0 && signals.rewindResponseCount >= 3) {
        return "Reflective";
    }
    if (signals.recentCompletedChillCount > 0 && signals.recentJournalCount > 0) {
        return "Grounded";
    }
    if (signals.recentActivityCount >= 3 || signals.recentCheckInCount >= 1) {
        return "Steady";
    }
    if (signals.activeGoalCount > 0 && signals.averageGoalProgress < 35) {
        return "Recharging";
    }
    return "Present";
}
async function buildMoodSignalSnapshot(userId) {
    const now = new Date();
    const activityWindowStart = new Date(now.getTime() - CURRENT_MOOD_REFRESH_WINDOW_MS);
    const [goals, recentCheckInCount, recentCompletedChillCount, recentJournalCount, rewindSessions] = await Promise.all([
        db_config_1.prisma.goal.findMany({
            where: { userId },
            select: {
                currentDay: true,
                targetDays: true,
            },
        }),
        db_config_1.prisma.checkIn.count({
            where: {
                goal: { userId },
                createdAt: { gte: activityWindowStart },
            },
        }),
        db_config_1.prisma.chillSession.count({
            where: {
                userId,
                completed: true,
                completedAt: { gte: activityWindowStart },
            },
        }),
        db_config_1.prisma.journal.count({
            where: {
                userId,
                updatedAt: { gte: activityWindowStart },
            },
        }),
        db_config_1.prisma.rewindSession.findMany({
            where: {
                userId,
                updatedAt: { gte: activityWindowStart },
            },
            select: {
                completed: true,
                responses: true,
            },
        }),
    ]);
    const activeGoalCount = goals.length;
    const completedGoalCount = goals.filter((goal) => goal.currentDay >= goal.targetDays).length;
    let progressAccumulator = 0;
    for (const goal of goals) {
        if (!goal.targetDays) {
            continue;
        }
        progressAccumulator += Math.min(goal.currentDay / goal.targetDays, 1);
    }
    const averageGoalProgress = activeGoalCount > 0
        ? roundToWholePercent((progressAccumulator / activeGoalCount) * 100)
        : 0;
    let rewindCompletedCount = 0;
    let rewindResponseCount = 0;
    for (const session of rewindSessions) {
        if (session.completed) {
            rewindCompletedCount += 1;
        }
        if (session.responses && typeof session.responses === "object" && !Array.isArray(session.responses)) {
            rewindResponseCount += Object.keys(session.responses).length;
        }
    }
    const recentActivityCount = recentCheckInCount +
        recentCompletedChillCount +
        recentJournalCount +
        rewindCompletedCount;
    return {
        activeGoalCount,
        averageGoalProgress,
        completedGoalCount,
        recentActivityCount,
        recentCheckInCount,
        recentCompletedChillCount,
        recentJournalCount,
        rewindCompletedCount,
        rewindResponseCount,
    };
}
class UserMoodService {
    async refreshCurrentMoodIfNeeded(userId) {
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                currentMood: true,
                updatedAt: true,
            },
        });
        if (!user) {
            return null;
        }
        if (shouldReuseCurrentMood(user.currentMood, user.updatedAt)) {
            return user.currentMood;
        }
        const signals = await buildMoodSignalSnapshot(userId);
        const nextMood = deriveMoodFromSignals(signals);
        await db_config_1.prisma.user.update({
            where: { id: userId },
            data: { currentMood: nextMood },
        });
        logger_util_1.default.info("Refreshed generated current mood", {
            userId,
            mood: nextMood,
            signals,
        });
        return nextMood;
    }
}
exports.userMoodService = new UserMoodService();
