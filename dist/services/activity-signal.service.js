"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordActivitySignal = recordActivitySignal;
exports.syncDerivedActivitySignals = syncDerivedActivitySignals;
exports.recordGoalLifecycleSignal = recordGoalLifecycleSignal;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function getLocalDayRange(localDateKey, timezone) {
    const localDate = luxon_1.DateTime.fromISO(localDateKey, { zone: timezone });
    if (!localDate.isValid) {
        throw new Error("Invalid activity signal date or timezone");
    }
    return {
        end: localDate.endOf("day").toUTC().toJSDate(),
        start: localDate.startOf("day").toUTC().toJSDate(),
    };
}
function getLocalDateKey(happenedAt, timezone) {
    const localDateKey = luxon_1.DateTime.fromJSDate(happenedAt, {
        zone: timezone,
    }).toISODate();
    if (!localDateKey) {
        throw new Error("Unable to resolve activity signal local date");
    }
    return localDateKey;
}
function truncateDescription(description) {
    return description.replace(/\s+/g, " ").trim().slice(0, 2400);
}
async function recordActivitySignal(input, client = db_config_1.prisma) {
    try {
        const user = await client.user.findUnique({
            select: { rewindPersonalizationEnabled: true },
            where: { id: input.userId },
        });
        if (!user?.rewindPersonalizationEnabled)
            return;
        const happenedAt = input.happenedAt ?? new Date();
        const localDateKey = input.localDateKey ?? getLocalDateKey(happenedAt, input.timezone);
        await client.activitySignal.createMany({
            data: [
                {
                    dedupeKey: input.dedupeKey,
                    description: truncateDescription(input.description),
                    eventType: input.eventType,
                    happenedAt,
                    localDateKey,
                    metadata: input.metadata,
                    personaId: input.personaId,
                    privacyEligible: input.privacyEligible ?? true,
                    sourceId: input.sourceId,
                    sourceType: input.sourceType,
                    userId: input.userId,
                },
            ],
            skipDuplicates: true,
        });
        if (env_util_1.Env.REWIND_ASYNC_CHAT_ENABLED === "true") {
            await client.rewindPartnerMind.updateMany({
                data: {
                    nextConsiderAt: new Date(),
                    state: client_1.RewindPartnerMindState.WATCHING,
                },
                where: {
                    userId: input.userId,
                    state: { not: client_1.RewindPartnerMindState.DORMANT },
                },
            });
        }
    }
    catch (error) {
        logger_util_1.default.warn("Unable to record Rewind activity signal", {
            dedupeKey: input.dedupeKey,
            errorName: error instanceof Error ? error.name : "UnknownError",
            sourceType: input.sourceType,
            userId: input.userId,
        });
    }
}
async function syncDerivedActivitySignals(userId, localDateKey, timezone) {
    const user = await db_config_1.prisma.user.findUnique({
        select: { rewindPersonalizationEnabled: true },
        where: { id: userId },
    });
    if (!user?.rewindPersonalizationEnabled)
        return 0;
    const range = getLocalDayRange(localDateKey, timezone);
    const dueDate = luxon_1.DateTime.fromISO(localDateKey, { zone: "UTC" }).toJSDate();
    const [journals, occurrences, sessions, chatMessages, achievements, rewards] = await Promise.all([
        db_config_1.prisma.journal.findMany({
            where: { userId, updatedAt: { gte: range.start, lte: range.end } },
        }),
        db_config_1.prisma.goalOccurrence.findMany({
            include: { goal: { select: { title: true, userId: true } } },
            where: {
                dueDate,
                goal: { userId },
                status: {
                    in: [client_1.GoalOccurrenceStatus.COMPLETED, client_1.GoalOccurrenceStatus.MISSED],
                },
            },
        }),
        db_config_1.prisma.rewindSession.findMany({
            where: {
                OR: [
                    { completedAt: { gte: range.start, lte: range.end } },
                    { sessionDateKey: localDateKey },
                ],
                status: {
                    in: [client_1.RewindSessionStatus.COMPLETED, client_1.RewindSessionStatus.MISSED],
                },
                userId,
            },
        }),
        db_config_1.prisma.rewindChatMessage.findMany({
            where: {
                localDateKey,
                role: client_1.RewindChatMessageRole.USER,
                userId,
            },
        }),
        db_config_1.prisma.achievement.findMany({
            where: { earnedAt: { gte: range.start, lte: range.end }, userId },
        }),
        db_config_1.prisma.transaction.findMany({
            where: {
                createdAt: { gte: range.start, lte: range.end },
                recipientId: userId,
                type: client_1.TransactionType.REWARD_POINTS,
            },
        }),
    ]);
    const signals = [];
    for (const journal of journals) {
        const content = truncateDescription(journal.content);
        if (!content)
            continue;
        signals.push({
            dedupeKey: `derived:journal:${journal.id}:${journal.updatedAt.getTime()}`,
            description: journal.mood
                ? `Journal mood: ${journal.mood}. ${content}`
                : `Journal entry: ${content}`,
            eventType: "JOURNAL_WRITTEN",
            happenedAt: journal.updatedAt,
            localDateKey,
            metadata: { mood: journal.mood, tags: journal.tags },
            sourceId: journal.id,
            sourceType: client_1.ActivitySignalSourceType.JOURNAL,
            userId,
        });
    }
    for (const occurrence of occurrences) {
        const completed = occurrence.status === client_1.GoalOccurrenceStatus.COMPLETED;
        signals.push({
            dedupeKey: `derived:goal-occurrence:${occurrence.id}:${occurrence.status}`,
            description: completed
                ? `Completed the scheduled progress for “${occurrence.goal.title}”.`
                : `Missed the scheduled progress for “${occurrence.goal.title}”.`,
            eventType: completed ? "GOAL_PROGRESS_COMPLETED" : "GOAL_PROGRESS_MISSED",
            happenedAt: occurrence.completedAt ?? occurrence.updatedAt,
            localDateKey,
            metadata: { goalId: occurrence.goalId, status: occurrence.status },
            sourceId: occurrence.id,
            sourceType: client_1.ActivitySignalSourceType.GOAL,
            userId,
        });
    }
    for (const session of sessions) {
        const completed = session.status === client_1.RewindSessionStatus.COMPLETED;
        signals.push({
            dedupeKey: `derived:rewind-session:${session.id}:${session.status}`,
            description: completed
                ? `Voice Rewind with ${session.personaId}: ${truncateDescription(session.summary ?? "Completed a reflection.")}`
                : `Missed the scheduled voice Rewind with ${session.personaId}.`,
            eventType: completed ? "REWIND_COMPLETED" : "REWIND_MISSED",
            happenedAt: session.completedAt ?? session.updatedAt,
            localDateKey,
            metadata: session.emotionalTags.length
                ? { emotionalTags: session.emotionalTags }
                : undefined,
            personaId: session.personaId,
            sourceId: session.id,
            sourceType: client_1.ActivitySignalSourceType.REWIND_VOICE,
            userId,
        });
        signals.push({
            dedupeKey: `derived:rewind-routine:${session.id}:${session.status}`,
            description: completed
                ? `Attended the scheduled Rewind with ${session.personaId}.`
                : `Skipped the scheduled Rewind with ${session.personaId}.`,
            eventType: completed
                ? "REWIND_ROUTINE_ATTENDED"
                : "REWIND_ROUTINE_SKIPPED",
            happenedAt: session.completedAt ?? session.updatedAt,
            localDateKey,
            personaId: session.personaId,
            sourceId: session.id,
            sourceType: client_1.ActivitySignalSourceType.REWIND_ROUTINE,
            userId,
        });
    }
    for (const message of chatMessages) {
        signals.push({
            dedupeKey: `derived:rewind-chat:${message.id}`,
            description: `Text chat: ${truncateDescription(message.content)}`,
            eventType: "CHAT_MESSAGE",
            happenedAt: message.createdAt,
            localDateKey,
            metadata: { chatId: message.chatId, mentions: message.mentions },
            sourceId: message.id,
            sourceType: client_1.ActivitySignalSourceType.REWIND_CHAT,
            userId,
        });
    }
    for (const achievement of achievements) {
        signals.push({
            dedupeKey: `derived:achievement:${achievement.id}`,
            description: `Earned “${achievement.title}”: ${achievement.description}`,
            eventType: "ACHIEVEMENT_EARNED",
            happenedAt: achievement.earnedAt,
            localDateKey,
            metadata: { milestone: achievement.milestone, type: achievement.type },
            sourceId: achievement.id,
            sourceType: client_1.ActivitySignalSourceType.ACHIEVEMENT,
            userId,
        });
    }
    for (const reward of rewards) {
        let description = `Released ${reward.amount.toFixed(2)} Play Points.`;
        let eventType = "REWARD_RELEASED";
        if (reward.status === "PENDING") {
            description = `Earned ${reward.amount.toFixed(2)} Play Points, pending goal completion.`;
            eventType = "REWARD_PENDING";
        }
        else if (reward.status === "FAILED") {
            description = `Forfeited ${reward.amount.toFixed(2)} pending Play Points.`;
            eventType = "REWARD_FORFEITED";
        }
        signals.push({
            dedupeKey: `derived:reward:${reward.id}:${reward.status}`,
            description,
            eventType,
            happenedAt: reward.createdAt,
            localDateKey,
            metadata: { amount: reward.amount },
            sourceId: reward.id,
            sourceType: client_1.ActivitySignalSourceType.REWARD,
            userId,
        });
    }
    if (!signals.length)
        return 0;
    const result = await db_config_1.prisma.activitySignal.createMany({
        data: signals,
        skipDuplicates: true,
    });
    return result.count;
}
async function recordGoalLifecycleSignal(params) {
    await recordActivitySignal({
        dedupeKey: `goal:${params.goalId}:${params.eventType}`,
        description: `${params.eventType.replace(/_/g, " ").toLowerCase()}: “${params.title}”.`,
        eventType: params.eventType,
        metadata: { status: params.status },
        sourceId: params.goalId,
        sourceType: client_1.ActivitySignalSourceType.GOAL,
        timezone: params.timezone,
        userId: params.userId,
    });
}
