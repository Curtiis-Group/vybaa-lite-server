import { GoalOccurrenceStatus, GoalV2Status } from "@prisma/client";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";

export interface RewindPersonalContext {
  achievements: Array<{ earnedAt: string; title: string }>;
  balances: { playPoints: number; realPoints: number };
  goalConclusions: Array<{
    adherenceRate: number;
    endedAt: string;
    outcome: string;
    title: string;
  }>;
  goals: Array<{
    adherenceRate: number;
    completedOccurrences: number;
    currentStreak: number;
    dueOccurrence: null | {
      closesAt: string;
      id: string;
      status: string;
    };
    id: string;
    pendingPoints: number;
    progressPercentage: number;
    status: string;
    targetType: string;
    targetValue: number | null;
    title: string;
    unit: string | null;
  }>;
  memories: Array<{
    comparisonInsight: string | null;
    dateKey: string;
    emotionalInsight: string | null;
    partner: string;
    summary: string;
  }>;
  observations: Array<{
    dateKey: string;
    description: string;
    personaId: string | null;
  }>;
  partnerContinuity: RewindPartnerContinuityContext | null;
  personalizationEnabled: boolean;
  recentRewards: Array<{
    amount: number;
    createdAt: string;
    state: string;
  }>;
}

export interface RewindPartnerContinuityContext {
  directChat: string[];
  directChatSummary: string | null;
  groupChat: string[];
  groupChatSummary: string | null;
  partner: string;
  personaId: string;
  relationship: {
    anger: number;
    hate: number;
    jealousy: number;
    love: number;
    malice: number;
    memorySummary: string | null;
  } | null;
}

const PARTNER_NAMES: Record<string, string> = {
  ariel: "Ariel",
  ella: "Ella",
  jake: "Jake",
  lyra: "Lyra",
};

function getProgressPercentage(goal: {
  completedOccurrences: number;
  progressValue: number;
  targetType: string;
  targetValue: number | null;
}): number {
  const target = goal.targetValue ?? 0;
  if (!target) return 0;
  const progress =
    goal.targetType === "QUANTITY"
      ? goal.progressValue
      : goal.completedOccurrences;
  return Math.min(100, Math.max(0, (progress / target) * 100));
}

function getPendingPoints(
  awards: Array<{ points: number; status: string }>,
): number {
  let pending = 0;
  for (const award of awards) {
    if (award.status === "PENDING") pending += award.points;
  }
  return pending;
}

function formatContinuityMessages(
  messages: Array<{
    content: string;
    personaId: string | null;
    role: string;
  }>,
): string[] {
  return [...messages].reverse().map((message) => {
    let speaker = "User";
    if (message.role !== "USER") {
      speaker = message.personaId
        ? (PARTNER_NAMES[message.personaId] ?? message.personaId)
        : "Partner";
    }
    return `${speaker}: ${message.content.replace(/\s+/g, " ").trim().slice(0, 360)}`;
  });
}

export async function loadRewindPartnerContinuityContext(
  userId: string,
  personaId: string,
): Promise<RewindPartnerContinuityContext> {
  const [relationship, chats] = await Promise.all([
    prisma.rewindPartnerRelationship.findUnique({
      where: { userId_personaId: { personaId, userId } },
    }),
    prisma.rewindChat.findMany({
      include: {
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { content: true, personaId: true, role: true },
          take: 18,
        },
      },
      where: {
        threadKey: { in: [`partner:${personaId}`, "group"] },
        userId,
      },
    }),
  ]);
  const directChat = chats.find(
    (chat) => chat.threadKey === `partner:${personaId}`,
  );
  const groupChat = chats.find((chat) => chat.threadKey === "group");

  return {
    directChat: formatContinuityMessages(directChat?.messages ?? []),
    directChatSummary: directChat?.contextSummary ?? null,
    groupChat: formatContinuityMessages(groupChat?.messages ?? []),
    groupChatSummary: groupChat?.contextSummary ?? null,
    partner: PARTNER_NAMES[personaId] ?? personaId,
    personaId,
    relationship: relationship
      ? {
          anger: relationship.anger,
          hate: relationship.hate,
          jealousy: relationship.jealousy,
          love: relationship.love,
          malice: relationship.malice,
          memorySummary: relationship.memorySummary,
        }
      : null,
  };
}

export function formatRewindPartnerContinuityContext(
  context: RewindPartnerContinuityContext,
): string {
  const relationship = context.relationship
    ? `Private relationship state: love ${context.relationship.love}, anger ${context.relationship.anger}, hate ${context.relationship.hate}, jealousy ${context.relationship.jealousy}, malice ${context.relationship.malice}. Unresolved memory: ${context.relationship.memorySummary ?? "none"}.`
    : "Private relationship state: no established history yet.";
  const directChat = context.directChat.length
    ? context.directChat.join("\n")
    : "No recent direct messages.";
  const groupChat = context.groupChat.length
    ? context.groupChat.join("\n")
    : "No recent group messages.";

  return (
    `${context.partner}'s private continuity across text chat, greetings, and Live Rewind. ` +
    `This belongs only to ${context.partner}. Do not inherit another partner's private feelings or claim another partner's direct memories. ` +
    `Group messages are shared facts only and retain their speaker attribution. Never recite memory storage or relationship scores.\n` +
    `${relationship}\n` +
    (context.directChatSummary
      ? `Earlier direct-chat memory: ${context.directChatSummary}\n`
      : "") +
    `Recent direct chat:\n${directChat}\n` +
    (context.groupChatSummary
      ? `Earlier shared group context: ${context.groupChatSummary}\n`
      : "") +
    `Recent shared group chat:\n${groupChat}`
  ).slice(0, 8_000);
}

export async function loadRewindPersonalContext(
  userId: string,
  timezone: string,
  sessionId: string,
  personaId?: string,
): Promise<RewindPersonalContext> {
  const localToday = DateTime.now().setZone(timezone).toISODate();
  const today = DateTime.fromISO(localToday ?? DateTime.now().toISODate()!, {
    zone: "UTC",
  }).toJSDate();
  const [
    user,
    goals,
    memories,
    conclusions,
    achievements,
    rewards,
    observations,
    partnerContinuity,
  ] = await Promise.all([
    prisma.user.findUnique({
      select: {
        points: true,
        realPointsBalance: true,
        rewindPersonalizationEnabled: true,
      },
      where: { id: userId },
    }),
    prisma.goalV2.findMany({
      include: {
        occurrences: {
          orderBy: { dueDate: "asc" },
          take: 1,
          where: {
            dueDate: { lte: today },
            status: {
              in: [GoalOccurrenceStatus.GRACE, GoalOccurrenceStatus.PENDING],
            },
          },
        },
        rewardPlan: { include: { awards: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
      where: {
        archivedAt: null,
        status: { in: [GoalV2Status.ACTIVE, GoalV2Status.PAUSED] },
        userId,
      },
    }),
    prisma.rewindSession.findMany({
      orderBy: { completedAt: "desc" },
      select: {
        emotionalInsight: true,
        comparisonInsight: true,
        personaId: true,
        sessionDateKey: true,
        summary: true,
      },
      take: 10,
      where: {
        completed: true,
        id: { not: sessionId },
        personaId: personaId ?? "__no_partner__",
        userId,
      },
    }),
    prisma.goalConclusion.findMany({
      include: { goal: { select: { title: true, userId: true } } },
      orderBy: { endedAt: "desc" },
      take: 5,
      where: { goal: { userId } },
    }),
    prisma.achievement.findMany({
      orderBy: { earnedAt: "desc" },
      select: { earnedAt: true, title: true },
      take: 5,
      where: { userId },
    }),
    prisma.transaction.findMany({
      orderBy: { createdAt: "desc" },
      select: { amount: true, createdAt: true, status: true },
      take: 5,
      where: {
        metadata: { contains: '"source":"goal_v2"' },
        recipientId: userId,
      },
    }),
    prisma.dailyObservation.findMany({
      orderBy: { localDateKey: "desc" },
      select: {
        description: true,
        localDateKey: true,
        personaId: true,
      },
      take: 5,
      where: { dismissedAt: null, userId },
    }),
    personaId
      ? loadRewindPartnerContinuityContext(userId, personaId)
      : Promise.resolve(null),
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
        adherenceRate:
          goal.completedOccurrences + goal.missedOccurrences
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
        summary: memory.summary?.trim().slice(0, 1_200) ?? "",
      })),
    observations: observations.map((observation) => ({
      dateKey: observation.localDateKey,
      description: observation.description,
      personaId: observation.personaId,
    })),
    partnerContinuity,
    personalizationEnabled: user?.rewindPersonalizationEnabled ?? true,
    recentRewards: rewards.map((reward) => ({
      amount: reward.amount,
      createdAt: reward.createdAt.toISOString(),
      state: reward.status,
    })),
  };
}

export function formatRewindPersonalContext(
  context: RewindPersonalContext,
): string {
  if (!context.personalizationEnabled) return "";
  const observationContext = context.observations
    .map((observation) => {
      const partner = observation.personaId
        ? (PARTNER_NAMES[observation.personaId] ?? observation.personaId)
        : "Vybaa activity";
      return `- ${partner}, ${observation.dateKey}: ${observation.description}`;
    })
    .join("\n");
  const partnerContinuityContext = context.partnerContinuity
    ? `${formatRewindPartnerContinuityContext(context.partnerContinuity)}\n`
    : "";
  const memoryContext = context.memories.length
    ? `This partner's own prior completed Rewinds:\n${context.memories
        .map(
          (memory) =>
            `- ${memory.partner}, ${memory.dateKey}: ${memory.summary}${memory.emotionalInsight ? ` Insight: ${memory.emotionalInsight}` : ""}${memory.comparisonInsight ? ` Pattern: ${memory.comparisonInsight}` : ""}`,
        )
        .join("\n")}\n`
    : "";
  return (
    partnerContinuityContext +
    memoryContext +
    `Account context (private, current, and never recited as a report):\n` +
    `- Play Points: ${context.balances.playPoints.toFixed(2)}\n` +
    `- Real-points balance: ${context.balances.realPoints}\n` +
    `- Current goals: ${JSON.stringify(context.goals)}\n` +
    `- Recent goal conclusions: ${JSON.stringify(context.goalConclusions)}\n` +
    `- Recent reward events: ${JSON.stringify(context.recentRewards)}\n` +
    `- Recent achievements: ${JSON.stringify(context.achievements)}\n` +
    `Recent grounded observations. These are shared factual context; credit a named partner and date whenever one is used:\n${observationContext}\n`
  ).slice(0, 14_000);
}
