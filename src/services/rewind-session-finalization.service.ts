import {
  ActivitySignalSourceType,
  RewindCompletionSource,
  RewindSessionStatus,
  RewindTurnRole,
} from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../config/db.config";
import { recordActivitySignal } from "./activity-signal.service";
import {
  generateRewindReflection,
  type RewindWellbeingSignals,
} from "./rewind-reflection.service";
import { notificationService } from "./notification.service";
import logger from "../utils/logger.util";

type RewindPersonaId = "ella" | "lyra" | "jake" | "ariel" | "tobi" | "neeja";

export type RewindFinalizationResult = {
  emotionalInsight: string | null;
  sessionId: string;
  status:
    | "already_completed"
    | "completed"
    | "finalizing"
    | "needs_more_reflection"
    | "missing"
    | "missed";
  summary: string | null;
  wellbeingSignals: RewindWellbeingSignals | null;
};

export type RewindFinalizationStage = "noticing_patterns" | "saving_reflection";

function isRewindPersonaId(value: string): value is RewindPersonaId {
  return (
    value === "ella" ||
    value === "lyra" ||
    value === "jake" ||
    value === "ariel" ||
    value === "tobi" ||
    value === "neeja"
  );
}

function getPersonaName(personaId: string): string {
  return personaId.charAt(0).toUpperCase() + personaId.slice(1);
}

function toLocalDateKey(date: Date, timezone: string | null): string {
  const localDate = DateTime.fromJSDate(date, {
    zone:
      timezone && DateTime.now().setZone(timezone).isValid ? timezone : "UTC",
  });
  return localDate.toFormat("yyyy-LL-dd");
}

function normalizeSignals(value: unknown): RewindWellbeingSignals | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  const keys = [
    "emotionalSteadiness",
    "energy",
    "clarity",
    "connection",
    "agency",
  ] as const;
  const signals = {} as RewindWellbeingSignals;

  for (const key of keys) {
    const numericValue = source[key];
    if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
      return null;
    }
    signals[key] = Math.round(Math.max(0, Math.min(100, numericValue)));
  }

  return signals;
}

export function hasSubstantiveUserTurn(
  turns: Array<{ content: string; role: RewindTurnRole }>,
): boolean {
  return turns.some(
    (turn) =>
      turn.role === RewindTurnRole.USER &&
      turn.content.trim().replace(/\s+/g, " ").length >= 12,
  );
}

async function loadReflectionContext(params: {
  personaId: RewindPersonaId;
  sessionDateKey: string | null;
  sessionId: string;
  timezone: string | null;
  userId: string;
}) {
  const [
    previousSessions,
    journals,
    turns,
    routine,
    user,
    activitySignals,
    dailyObservation,
  ] = await Promise.all([
    prisma.rewindSession.findMany({
      where: {
        userId: params.userId,
        personaId: params.personaId,
        completed: true,
        NOT: { id: params.sessionId },
      },
      orderBy: { completedAt: "desc" },
      select: {
        createdAt: true,
        sessionDateKey: true,
        summary: true,
      },
      take: 7,
    }),
    prisma.journal.findMany({
      where: { content: { not: "" }, userId: params.userId },
      orderBy: { date: "desc" },
      select: { content: true, date: true },
      take: 7,
    }),
    prisma.rewindTurn.findMany({
      where: { sessionId: params.sessionId },
      orderBy: { sequence: "asc" },
      select: { content: true, role: true },
    }),
    prisma.rewindRoutine.findUnique({
      where: { userId: params.userId },
      select: { customIntent: true, intent: true },
    }),
    prisma.user.findUnique({
      select: { rewindPersonalizationEnabled: true },
      where: { id: params.userId },
    }),
    params.sessionDateKey
      ? prisma.activitySignal.findMany({
          orderBy: { happenedAt: "desc" },
          select: { description: true, sourceType: true },
          take: 24,
          where: {
            localDateKey: params.sessionDateKey,
            privacyEligible: true,
            userId: params.userId,
          },
        })
      : Promise.resolve([]),
    params.sessionDateKey
      ? prisma.dailyObservation.findUnique({
          select: { description: true },
          where: {
            userId_localDateKey: {
              localDateKey: params.sessionDateKey,
              userId: params.userId,
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const intent = !user?.rewindPersonalizationEnabled
    ? null
    : routine?.intent === "UNDERSTAND_EMOTIONS"
      ? "Understand my emotions"
      : routine?.intent === "SPOT_PATTERNS"
        ? "Spot patterns in my days"
        : routine?.intent === "BUILD_SMALL_CHANGES"
          ? "Turn reflection into small changes"
          : (routine?.customIntent ?? null);

  return {
    activityObservations: user?.rewindPersonalizationEnabled
      ? [
          ...(dailyObservation
            ? [
                {
                  description: dailyObservation.description,
                  sourceType: "DAILY_OBSERVATION",
                },
              ]
            : []),
          ...activitySignals.map((signal) => ({
            description: signal.description,
            sourceType: signal.sourceType,
          })),
        ]
      : [],
    intent,
    journalEntries: (user?.rewindPersonalizationEnabled ? journals : [])
      .map((journal) => ({
        content: journal.content.trim().slice(0, 2_400),
        dateKey: toLocalDateKey(journal.date, params.timezone),
      }))
      .filter((journal) => journal.content.length > 0),
    previousSummaries: (user?.rewindPersonalizationEnabled
      ? previousSessions
      : []
    )
      .map((session) => ({
        dateKey:
          session.sessionDateKey ??
          toLocalDateKey(session.createdAt, params.timezone),
        summary: session.summary?.trim() ?? "",
      }))
      .filter((session) => session.summary.length > 0),
    turns,
  };
}

async function markMissed(
  sessionId: string,
): Promise<RewindFinalizationResult> {
  await prisma.$transaction([
    prisma.rewindRecommendation.deleteMany({ where: { sessionId } }),
    prisma.rewindSession.update({
      data: {
        completed: false,
        completionSource: null,
        status: RewindSessionStatus.MISSED,
      },
      where: { id: sessionId },
    }),
  ]);
  return {
    emotionalInsight: null,
    sessionId,
    status: "missed",
    summary: null,
    wellbeingSignals: null,
  };
}

/**
 * Finalizes one Rewind occurrence. Its status transition is the cross-process
 * lock: a WebSocket, scheduler, and retry cannot all generate a reflection.
 */
export async function finalizeRewindSession(params: {
  onStage?: (stage: RewindFinalizationStage) => void;
  sessionId: string;
  source: RewindCompletionSource;
}): Promise<RewindFinalizationResult> {
  const session = await prisma.rewindSession.findUnique({
    where: { id: params.sessionId },
    select: {
      completed: true,
      emotionalInsight: true,
      id: true,
      personaId: true,
      sessionDateKey: true,
      status: true,
      summary: true,
      timezone: true,
      userId: true,
      wellbeingSignals: true,
    },
  });
  if (!session) {
    return {
      emotionalInsight: null,
      sessionId: params.sessionId,
      status: "missing",
      summary: null,
      wellbeingSignals: null,
    };
  }
  if (session.completed || session.status === RewindSessionStatus.COMPLETED) {
    return {
      emotionalInsight: session.emotionalInsight,
      sessionId: session.id,
      status: "already_completed",
      summary: session.summary,
      wellbeingSignals: normalizeSignals(session.wellbeingSignals),
    };
  }
  if (session.status === RewindSessionStatus.MISSED) {
    return {
      emotionalInsight: null,
      sessionId: session.id,
      status: "missed",
      summary: null,
      wellbeingSignals: null,
    };
  }

  const claim = await prisma.rewindSession.updateMany({
    where: {
      id: session.id,
      OR: [
        { status: RewindSessionStatus.IN_PROGRESS },
        { status: RewindSessionStatus.LEGACY, completed: false },
      ],
    },
    data: { status: RewindSessionStatus.FINALIZING },
  });
  if (claim.count === 0) {
    return {
      emotionalInsight: null,
      sessionId: session.id,
      status: "finalizing",
      summary: null,
      wellbeingSignals: null,
    };
  }

  if (!isRewindPersonaId(session.personaId)) {
    await markMissed(session.id);
    return {
      emotionalInsight: null,
      sessionId: session.id,
      status: "missed",
      summary: null,
      wellbeingSignals: null,
    };
  }

  try {
    const context = await loadReflectionContext({
      personaId: session.personaId,
      sessionDateKey: session.sessionDateKey,
      sessionId: session.id,
      timezone: session.timezone,
      userId: session.userId,
    });

    if (!hasSubstantiveUserTurn(context.turns)) {
      return markMissed(session.id);
    }

    params.onStage?.("noticing_patterns");
    const reflection = await generateRewindReflection({
      activityObservations: context.activityObservations,
      intent: context.intent,
      journalEntries: context.journalEntries,
      personaName: getPersonaName(session.personaId),
      previousSummaries: context.previousSummaries,
      transcript: context.turns.map((turn) => ({
        content: turn.content,
        role: turn.role === RewindTurnRole.USER ? "user" : "partner",
      })),
    });
    params.onStage?.("saving_reflection");
    const completedAt = new Date();
    await prisma.$transaction([
      prisma.rewindSession.update({
        where: { id: session.id },
        data: {
          checkInAt: completedAt,
          completed: true,
          completedAt,
          completionSource: params.source,
          comparisonInsight: reflection.comparisonInsight,
          emotionalInsight: reflection.emotionalInsight,
          emotionalTags: reflection.emotionalTags,
          journalDraft: reflection.journalDraft,
          nextStepNote: reflection.nextStepNote,
          status: RewindSessionStatus.COMPLETED,
          summary: reflection.summary,
          transcriptAvailable: context.turns.length > 0,
          wellbeingSignals: reflection.wellbeingSignals,
        },
      }),
      prisma.user.update({
        where: { id: session.userId },
        data: {
          currentMood: reflection.currentMood,
          emotionSummary: reflection.emotionalInsight,
        },
      }),
    ]);

    await recordActivitySignal({
      dedupeKey: `rewind-voice:${session.id}:completed`,
      description: `Completed a voice Rewind with ${getPersonaName(session.personaId)}: ${reflection.emotionalInsight}`,
      eventType: "REWIND_COMPLETED",
      happenedAt: completedAt,
      localDateKey:
        session.sessionDateKey ?? toLocalDateKey(completedAt, session.timezone),
      metadata: { emotionalTags: reflection.emotionalTags },
      personaId: session.personaId,
      sourceId: session.id,
      sourceType: ActivitySignalSourceType.REWIND_VOICE,
      timezone: session.timezone ?? "UTC",
      userId: session.userId,
    });

    try {
      await notificationService.createNotification({
        userId: session.userId,
        type: "system",
        title: "Your Rewind summary is ready",
        message: "Your reflection is ready whenever you are.",
        data: {
          rewindSessionId: session.id,
          route: `/app/r/${session.id}`,
          type: "rewind_summary_ready",
        },
        dedupeKey: `rewind_summary_ready:${session.id}`,
      });
    } catch (notificationError) {
      logger.error("Unable to send Rewind summary notification", {
        errorName:
          notificationError instanceof Error
            ? notificationError.name
            : "UnknownError",
        sessionId: session.id,
      });
    }

    return {
      emotionalInsight: reflection.emotionalInsight,
      sessionId: session.id,
      status: "completed",
      summary: reflection.summary,
      wellbeingSignals: reflection.wellbeingSignals,
    };
  } catch (error) {
    await prisma.rewindSession.updateMany({
      where: { id: session.id, status: RewindSessionStatus.FINALIZING },
      data: { status: RewindSessionStatus.IN_PROGRESS },
    });
    throw error;
  }
}
