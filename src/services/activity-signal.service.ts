import {
  ActivitySignalSourceType,
  GoalOccurrenceStatus,
  GoalV2Status,
  Prisma,
  RewindChatMessageRole,
  RewindSessionStatus,
  RewindPartnerMindState,
  TransactionType,
} from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";

type DatabaseClient = Prisma.TransactionClient | typeof prisma;

export interface RecordActivitySignalInput {
  dedupeKey: string;
  description: string;
  eventType: string;
  happenedAt?: Date;
  localDateKey?: string;
  metadata?: Prisma.InputJsonValue;
  personaId?: string | null;
  privacyEligible?: boolean;
  sourceId: string;
  sourceType: ActivitySignalSourceType;
  timezone: string;
  userId: string;
}

interface LocalDayRange {
  end: Date;
  start: Date;
}

function getLocalDayRange(
  localDateKey: string,
  timezone: string,
): LocalDayRange {
  const localDate = DateTime.fromISO(localDateKey, { zone: timezone });
  if (!localDate.isValid) {
    throw new Error("Invalid activity signal date or timezone");
  }
  return {
    end: localDate.endOf("day").toUTC().toJSDate(),
    start: localDate.startOf("day").toUTC().toJSDate(),
  };
}

function getLocalDateKey(happenedAt: Date, timezone: string): string {
  const localDateKey = DateTime.fromJSDate(happenedAt, {
    zone: timezone,
  }).toISODate();
  if (!localDateKey) {
    throw new Error("Unable to resolve activity signal local date");
  }
  return localDateKey;
}

function truncateDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim().slice(0, 2_400);
}

export async function recordActivitySignal(
  input: RecordActivitySignalInput,
  client: DatabaseClient = prisma,
): Promise<void> {
  try {
    const user = await client.user.findUnique({
      select: { rewindPersonalizationEnabled: true },
      where: { id: input.userId },
    });
    if (!user?.rewindPersonalizationEnabled) return;

    const happenedAt = input.happenedAt ?? new Date();
    const localDateKey =
      input.localDateKey ?? getLocalDateKey(happenedAt, input.timezone);
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
    if (Env.REWIND_ASYNC_CHAT_ENABLED === "true") {
      await client.rewindPartnerMind.updateMany({
        data: {
          nextConsiderAt: new Date(),
          state: RewindPartnerMindState.WATCHING,
        },
        where: {
          userId: input.userId,
          state: { not: RewindPartnerMindState.DORMANT },
        },
      });
    }
  } catch (error: unknown) {
    logger.warn("Unable to record Rewind activity signal", {
      dedupeKey: input.dedupeKey,
      errorName: error instanceof Error ? error.name : "UnknownError",
      sourceType: input.sourceType,
      userId: input.userId,
    });
  }
}

export async function syncDerivedActivitySignals(
  userId: string,
  localDateKey: string,
  timezone: string,
): Promise<number> {
  const user = await prisma.user.findUnique({
    select: { rewindPersonalizationEnabled: true },
    where: { id: userId },
  });
  if (!user?.rewindPersonalizationEnabled) return 0;

  const range = getLocalDayRange(localDateKey, timezone);
  const dueDate = DateTime.fromISO(localDateKey, { zone: "UTC" }).toJSDate();
  const [journals, occurrences, sessions, chatMessages, achievements, rewards] =
    await Promise.all([
      prisma.journal.findMany({
        where: { userId, updatedAt: { gte: range.start, lte: range.end } },
      }),
      prisma.goalOccurrence.findMany({
        include: { goal: { select: { title: true, userId: true } } },
        where: {
          dueDate,
          goal: { userId },
          status: {
            in: [GoalOccurrenceStatus.COMPLETED, GoalOccurrenceStatus.MISSED],
          },
        },
      }),
      prisma.rewindSession.findMany({
        where: {
          OR: [
            { completedAt: { gte: range.start, lte: range.end } },
            { sessionDateKey: localDateKey },
          ],
          status: {
            in: [RewindSessionStatus.COMPLETED, RewindSessionStatus.MISSED],
          },
          userId,
        },
      }),
      prisma.rewindChatMessage.findMany({
        where: {
          localDateKey,
          role: RewindChatMessageRole.USER,
          userId,
        },
      }),
      prisma.achievement.findMany({
        where: { earnedAt: { gte: range.start, lte: range.end }, userId },
      }),
      prisma.transaction.findMany({
        where: {
          createdAt: { gte: range.start, lte: range.end },
          recipientId: userId,
          type: TransactionType.REWARD_POINTS,
        },
      }),
    ]);

  const signals: Prisma.ActivitySignalCreateManyInput[] = [];
  for (const journal of journals) {
    const content = truncateDescription(journal.content);
    if (!content) continue;
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
      sourceType: ActivitySignalSourceType.JOURNAL,
      userId,
    });
  }

  for (const occurrence of occurrences) {
    const completed = occurrence.status === GoalOccurrenceStatus.COMPLETED;
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
      sourceType: ActivitySignalSourceType.GOAL,
      userId,
    });
  }

  for (const session of sessions) {
    const completed = session.status === RewindSessionStatus.COMPLETED;
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
      sourceType: ActivitySignalSourceType.REWIND_VOICE,
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
      sourceType: ActivitySignalSourceType.REWIND_ROUTINE,
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
      sourceType: ActivitySignalSourceType.REWIND_CHAT,
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
      sourceType: ActivitySignalSourceType.ACHIEVEMENT,
      userId,
    });
  }

  for (const reward of rewards) {
    let description = `Released ${reward.amount.toFixed(2)} Play Points.`;
    let eventType = "REWARD_RELEASED";
    if (reward.status === "PENDING") {
      description = `Earned ${reward.amount.toFixed(2)} Play Points, pending goal completion.`;
      eventType = "REWARD_PENDING";
    } else if (reward.status === "FAILED") {
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
      sourceType: ActivitySignalSourceType.REWARD,
      userId,
    });
  }

  if (!signals.length) return 0;
  const result = await prisma.activitySignal.createMany({
    data: signals,
    skipDuplicates: true,
  });
  return result.count;
}

export async function recordGoalLifecycleSignal(params: {
  eventType: string;
  goalId: string;
  status: GoalV2Status;
  timezone: string;
  title: string;
  userId: string;
}): Promise<void> {
  await recordActivitySignal({
    dedupeKey: `goal:${params.goalId}:${params.eventType}`,
    description: `${params.eventType.replace(/_/g, " ").toLowerCase()}: “${params.title}”.`,
    eventType: params.eventType,
    metadata: { status: params.status },
    sourceId: params.goalId,
    sourceType: ActivitySignalSourceType.GOAL,
    timezone: params.timezone,
    userId: params.userId,
  });
}
