"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasSubstantiveUserTurn = hasSubstantiveUserTurn;
exports.finalizeRewindSession = finalizeRewindSession;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const rewind_reflection_service_1 = require("./rewind-reflection.service");
const notification_service_1 = require("./notification.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function isRewindPersonaId(value) {
    return value === "ella" || value === "lyra" || value === "jake" || value === "ariel";
}
function getPersonaName(personaId) {
    return personaId.charAt(0).toUpperCase() + personaId.slice(1);
}
function toLocalDateKey(date, timezone) {
    const localDate = luxon_1.DateTime.fromJSDate(date, {
        zone: timezone && luxon_1.DateTime.now().setZone(timezone).isValid ? timezone : "UTC",
    });
    return localDate.toFormat("yyyy-LL-dd");
}
function normalizeSignals(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const source = value;
    const keys = [
        "emotionalSteadiness",
        "energy",
        "clarity",
        "connection",
        "agency",
    ];
    const signals = {};
    for (const key of keys) {
        const numericValue = source[key];
        if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
            return null;
        }
        signals[key] = Math.round(Math.max(0, Math.min(100, numericValue)));
    }
    return signals;
}
function hasSubstantiveUserTurn(turns) {
    return turns.some((turn) => turn.role === client_1.RewindTurnRole.USER &&
        turn.content.trim().replace(/\s+/g, " ").length >= 12);
}
async function loadReflectionContext(params) {
    const [previousSessions, journals, turns, routine] = await Promise.all([
        db_config_1.prisma.rewindSession.findMany({
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
        db_config_1.prisma.journal.findMany({
            where: { content: { not: "" }, userId: params.userId },
            orderBy: { date: "desc" },
            select: { content: true, date: true },
            take: 7,
        }),
        db_config_1.prisma.rewindTurn.findMany({
            where: { sessionId: params.sessionId },
            orderBy: { sequence: "asc" },
            select: { content: true, role: true },
        }),
        db_config_1.prisma.rewindRoutine.findUnique({
            where: { userId: params.userId },
            select: { customIntent: true, intent: true },
        }),
    ]);
    const intent = routine?.intent === "UNDERSTAND_EMOTIONS"
        ? "Understand my emotions"
        : routine?.intent === "SPOT_PATTERNS"
            ? "Spot patterns in my days"
            : routine?.intent === "BUILD_SMALL_CHANGES"
                ? "Turn reflection into small changes"
                : routine?.customIntent ?? null;
    return {
        intent,
        journalEntries: journals
            .map((journal) => ({
            content: journal.content.trim().slice(0, 2400),
            dateKey: toLocalDateKey(journal.date, params.timezone),
        }))
            .filter((journal) => journal.content.length > 0),
        previousSummaries: previousSessions
            .map((session) => ({
            dateKey: session.sessionDateKey ??
                toLocalDateKey(session.createdAt, params.timezone),
            summary: session.summary?.trim() ?? "",
        }))
            .filter((session) => session.summary.length > 0),
        turns,
    };
}
async function markMissed(sessionId) {
    await db_config_1.prisma.$transaction([
        db_config_1.prisma.rewindRecommendation.deleteMany({ where: { sessionId } }),
        db_config_1.prisma.rewindSession.update({
            data: {
                completed: false,
                completionSource: null,
                status: client_1.RewindSessionStatus.MISSED,
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
async function finalizeRewindSession(params) {
    const session = await db_config_1.prisma.rewindSession.findUnique({
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
    if (session.completed || session.status === client_1.RewindSessionStatus.COMPLETED) {
        return {
            emotionalInsight: session.emotionalInsight,
            sessionId: session.id,
            status: "already_completed",
            summary: session.summary,
            wellbeingSignals: normalizeSignals(session.wellbeingSignals),
        };
    }
    if (session.status === client_1.RewindSessionStatus.MISSED) {
        return {
            emotionalInsight: null,
            sessionId: session.id,
            status: "missed",
            summary: null,
            wellbeingSignals: null,
        };
    }
    const claim = await db_config_1.prisma.rewindSession.updateMany({
        where: {
            id: session.id,
            OR: [
                { status: client_1.RewindSessionStatus.IN_PROGRESS },
                { status: client_1.RewindSessionStatus.LEGACY, completed: false },
            ],
        },
        data: { status: client_1.RewindSessionStatus.FINALIZING },
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
        const reflection = await (0, rewind_reflection_service_1.generateRewindReflection)({
            intent: context.intent,
            journalEntries: context.journalEntries,
            personaName: getPersonaName(session.personaId),
            previousSummaries: context.previousSummaries,
            transcript: context.turns.map((turn) => ({
                content: turn.content,
                role: turn.role === client_1.RewindTurnRole.USER ? "user" : "partner",
            })),
        });
        params.onStage?.("saving_reflection");
        const completedAt = new Date();
        await db_config_1.prisma.$transaction([
            db_config_1.prisma.rewindSession.update({
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
                    status: client_1.RewindSessionStatus.COMPLETED,
                    summary: reflection.summary,
                    transcriptAvailable: context.turns.length > 0,
                    wellbeingSignals: reflection.wellbeingSignals,
                },
            }),
            db_config_1.prisma.user.update({
                where: { id: session.userId },
                data: {
                    currentMood: reflection.currentMood,
                    emotionSummary: reflection.emotionalInsight,
                },
            }),
        ]);
        try {
            await notification_service_1.notificationService.createNotification({
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
        }
        catch (notificationError) {
            logger_util_1.default.error("Unable to send Rewind summary notification", {
                errorName: notificationError instanceof Error
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
    }
    catch (error) {
        await db_config_1.prisma.rewindSession.updateMany({
            where: { id: session.id, status: client_1.RewindSessionStatus.FINALIZING },
            data: { status: client_1.RewindSessionStatus.IN_PROGRESS },
        });
        throw error;
    }
}
