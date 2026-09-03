"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRewindPersonalContext = loadRewindPersonalContext;
exports.formatRewindPersonalContext = formatRewindPersonalContext;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const PARTNER_NAMES = {
    ariel: "Ariel",
    ella: "Ella",
    jake: "Jake",
    lyra: "Lyra",
};
function getProgressPercentage(goal) {
    const target = goal.targetValue ?? 0;
    if (!target)
        return 0;
    const progress = goal.targetType === "QUANTITY"
        ? goal.progressValue
        : goal.completedOccurrences;
    return Math.min(100, Math.max(0, (progress / target) * 100));
}
function getPendingPoints(awards) {
    let pending = 0;
    for (const award of awards) {
        if (award.status === "PENDING")
            pending += award.points;
    }
    return pending;
}
async function loadRewindPersonalContext(userId, timezone, sessionId) {
    const localToday = luxon_1.DateTime.now().setZone(timezone).toISODate();
    const today = luxon_1.DateTime.fromISO(localToday ?? luxon_1.DateTime.now().toISODate(), {
        zone: "UTC",
    }).toJSDate();
    const [user, goals, memories, conclusions, achievements, rewards, observations,] = await Promise.all([
        db_config_1.prisma.user.findUnique({
            select: {
                points: true,
                realPointsBalance: true,
                rewindPersonalizationEnabled: true,
            },
            where: { id: userId },
        }),
        db_config_1.prisma.goalV2.findMany({
            include: {
                occurrences: {
                    orderBy: { dueDate: "asc" },
                    take: 1,
                    where: {
                        dueDate: { lte: today },
                        status: {
                            in: [client_1.GoalOccurrenceStatus.GRACE, client_1.GoalOccurrenceStatus.PENDING],
                        },
                    },
                },
                rewardPlan: { include: { awards: true } },
            },
            orderBy: { updatedAt: "desc" },
            take: 8,
            where: {
                archivedAt: null,
                status: { in: [client_1.GoalV2Status.ACTIVE, client_1.GoalV2Status.PAUSED] },
                userId,
            },
        }),
        db_config_1.prisma.rewindSession.findMany({
            orderBy: { completedAt: "desc" },
            select: {
                emotionalInsight: true,
                comparisonInsight: true,
                personaId: true,
                sessionDateKey: true,
                summary: true,
            },
            take: 10,
            where: { completed: true, id: { not: sessionId }, userId },
        }),
        db_config_1.prisma.goalConclusion.findMany({
            include: { goal: { select: { title: true, userId: true } } },
            orderBy: { endedAt: "desc" },
            take: 5,
            where: { goal: { userId } },
        }),
        db_config_1.prisma.achievement.findMany({
            orderBy: { earnedAt: "desc" },
            select: { earnedAt: true, title: true },
            take: 5,
            where: { userId },
        }),
        db_config_1.prisma.transaction.findMany({
            orderBy: { createdAt: "desc" },
            select: { amount: true, createdAt: true, status: true },
            take: 5,
            where: {
                metadata: { contains: '"source":"goal_v2"' },
                recipientId: userId,
            },
        }),
        db_config_1.prisma.dailyObservation.findMany({
            orderBy: { localDateKey: "desc" },
            select: {
                description: true,
                localDateKey: true,
                personaId: true,
            },
            take: 5,
            where: { dismissedAt: null, userId },
        }),
    ]);
    return {
        achievements: achievements.map((achievement) => ({
            earnedAt: achievement.earnedAt.toISOString(),
            title: achievement.title,
        })),
        balances: {
            playPoints: user?.points ?? 0,
            realPoints: user?.realPointsBalance ?? 0,
        },
        goalConclusions: conclusions.map((conclusion) => ({
            adherenceRate: conclusion.adherenceRate,
            endedAt: conclusion.endedAt.toISOString(),
            outcome: conclusion.outcome,
            title: conclusion.goal.title,
        })),
        goals: goals.map((goal) => {
            const dueOccurrence = goal.occurrences[0];
            return {
                adherenceRate: goal.completedOccurrences + goal.missedOccurrences
                    ? (goal.completedOccurrences /
                        (goal.completedOccurrences + goal.missedOccurrences)) *
                        100
                    : 100,
                completedOccurrences: goal.completedOccurrences,
                currentStreak: goal.currentStreak,
                dueOccurrence: dueOccurrence
                    ? {
                        closesAt: dueOccurrence.closesAt.toISOString(),
                        id: dueOccurrence.id,
                        status: dueOccurrence.status,
                    }
                    : null,
                id: goal.id,
                pendingPoints: getPendingPoints(goal.rewardPlan?.awards ?? []),
                progressPercentage: getProgressPercentage(goal),
                status: goal.status,
                targetType: goal.targetType,
                targetValue: goal.targetValue,
                title: goal.title,
                unit: goal.unit,
            };
        }),
        memories: memories
            .filter((memory) => Boolean(memory.summary?.trim()))
            .map((memory) => ({
            comparisonInsight: memory.comparisonInsight,
            dateKey: memory.sessionDateKey ?? "previous Rewind",
            emotionalInsight: memory.emotionalInsight,
            partner: PARTNER_NAMES[memory.personaId] ?? memory.personaId,
            summary: memory.summary?.trim().slice(0, 1200) ?? "",
        })),
        observations: observations.map((observation) => ({
            dateKey: observation.localDateKey,
            description: observation.description,
            personaId: observation.personaId,
        })),
        personalizationEnabled: user?.rewindPersonalizationEnabled ?? true,
        recentRewards: rewards.map((reward) => ({
            amount: reward.amount,
            createdAt: reward.createdAt.toISOString(),
            state: reward.status,
        })),
    };
}
function formatRewindPersonalContext(context) {
    if (!context.personalizationEnabled)
        return "";
    const observationContext = context.observations
        .map((observation) => {
        const partner = observation.personaId
            ? (PARTNER_NAMES[observation.personaId] ?? observation.personaId)
            : "Vybaa activity";
        return `- ${partner}, ${observation.dateKey}: ${observation.description}`;
    })
        .join("\n");
    return (`Account context (private, current, and never recited as a report):\n` +
        `- Play Points: ${context.balances.playPoints.toFixed(2)}\n` +
        `- Real-points balance: ${context.balances.realPoints}\n` +
        `- Current goals: ${JSON.stringify(context.goals)}\n` +
        `- Recent goal conclusions: ${JSON.stringify(context.goalConclusions)}\n` +
        `- Recent reward events: ${JSON.stringify(context.recentRewards)}\n` +
        `- Recent achievements: ${JSON.stringify(context.achievements)}\n` +
        `Recent grounded observations. Credit a named partner and date whenever one is used:\n${observationContext}\n` +
        `Cross-partner memories. When using one, credit the named partner and date naturally:\n` +
        context.memories
            .map((memory) => `- ${memory.partner}, ${memory.dateKey}: ${memory.summary}${memory.emotionalInsight ? ` Insight: ${memory.emotionalInsight}` : ""}${memory.comparisonInsight ? ` Pattern: ${memory.comparisonInsight}` : ""}`)
            .join("\n")).slice(0, 14000);
}
