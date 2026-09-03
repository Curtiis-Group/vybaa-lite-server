import {
  ActivitySignalSourceType,
  RewindChatMessageRole,
} from "@prisma/client";
import type { Response } from "express";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import { recordActivitySignal } from "../services/activity-signal.service";
import {
  DailyObservationError,
  dismissDailyObservation,
  getDailyObservation,
  listDailyObservations,
  serializeDailyObservation,
} from "../services/daily-observation.service";
import {
  ensureDefaultRewindChats,
  getRewindChatMessageIdempotencyKey,
  listRewindChatMessages,
  RewindChatError,
  sendRewindChatMessage,
  setRewindChatArchived,
} from "../services/rewind-chat.service";
import logger from "../utils/logger.util";

const CHAT_MESSAGES_PER_MINUTE = 12;

async function getUserTimezone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    select: { timezone: true },
    where: { id: userId },
  });
  return user?.timezone ?? "UTC";
}

function handleIntelligenceError(
  error: unknown,
  operation: string,
  req: AuthRequest,
  res: Response,
): void {
  if (error instanceof RewindChatError) {
    res.status(error.status).json({ code: error.code, msg: error.message });
    return;
  }
  if (error instanceof DailyObservationError) {
    res.status(error.status).json({ code: error.code, msg: error.message });
    return;
  }
  logger.error(`Rewind intelligence ${operation} error`, {
    errorName: error instanceof Error ? error.name : "UnknownError",
    userId: req.userId,
  });
  res.status(500).json({ msg: "Rewind is unavailable right now" });
}

export async function listObservations(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await getUserTimezone(userId);
    const result = await listDailyObservations({
      cursor:
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit: Number(req.query.limit ?? 20),
      timezone,
      userId,
    });
    res.json({ data: result, msg: "Rewind observations retrieved" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "list observations", req, res);
  }
}

export async function getObservation(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const observation = await getDailyObservation(
      req.userId!,
      String(req.params.observationId),
    );
    if (!observation) {
      res.status(404).json({ msg: "Observation not found" });
      return;
    }
    res.json({ data: observation, msg: "Rewind observation retrieved" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "get observation", req, res);
  }
}

export async function dismissObservation(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const dismissed = await dismissDailyObservation(
      req.userId!,
      String(req.params.observationId),
    );
    if (!dismissed) {
      res.status(404).json({ msg: "Observation not found" });
      return;
    }
    res.json({ msg: "Observation dismissed" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "dismiss observation", req, res);
  }
}

export async function getHomeGreeting(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      select: { rewindPersonalizationEnabled: true },
      where: { id: req.userId! },
    });
    if (!user?.rewindPersonalizationEnabled) {
      res.json({ data: null, msg: "Generic greeting preferred" });
      return;
    }
    const observation = await prisma.dailyObservation.findFirst({
      orderBy: { localDateKey: "desc" },
      where: {
        confidence: { gte: 0.45 },
        dismissedAt: null,
        userId: req.userId!,
      },
    });
    if (!observation) {
      res.json({ data: null, msg: "No contextual greeting available" });
      return;
    }
    const serialized = serializeDailyObservation(observation);
    res.json({
      data: {
        date: serialized.localDateKey,
        message: serialized.description.slice(0, 220),
        personaId: serialized.personaId,
        sourceTypes: serialized.sourceTypes,
        title: serialized.personaId
          ? `${serialized.personaId[0]?.toUpperCase()}${serialized.personaId.slice(1)} noticed`
          : "Something worth noticing",
      },
      msg: "Contextual greeting retrieved",
    });
  } catch (error: unknown) {
    handleIntelligenceError(error, "get home greeting", req, res);
  }
}

export async function listChats(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const chats = await ensureDefaultRewindChats(req.userId!);
    res.json({ data: { chats }, msg: "Rewind chats retrieved" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "list chats", req, res);
  }
}

export async function listChatMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await listRewindChatMessages({
      chatId: String(req.params.chatId),
      cursor:
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit: Number(req.query.limit ?? 30),
      userId: req.userId!,
    });
    res.json({ data: result, msg: "Rewind chat messages retrieved" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "list chat messages", req, res);
  }
}

export async function sendChatMessage(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const chatId = String(req.params.chatId);
    const idempotencyKey = String(req.body.idempotencyKey);
    const storedIdempotencyKey = getRewindChatMessageIdempotencyKey(
      userId,
      chatId,
      idempotencyKey,
    );
    const existingMessage = await prisma.rewindChatMessage.findFirst({
      select: { id: true },
      where: { idempotencyKey: storedIdempotencyKey, userId },
    });
    if (!existingMessage) {
      const recentMessageCount = await prisma.rewindChatMessage.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 60_000) },
          role: RewindChatMessageRole.USER,
          userId,
        },
      });
      if (recentMessageCount >= CHAT_MESSAGES_PER_MINUTE) {
        res.status(429).json({
          code: "REWIND_CHAT_RATE_LIMITED",
          msg: "Give your Rewind partners a moment before sending more",
        });
        return;
      }
    }
    const timezone = await getUserTimezone(userId);
   
    const result = await sendRewindChatMessage({
      chatId,
      content: String(req.body.content),
      idempotencyKey,
      timezone,
      userId,
    });
    res.status(201).json({ data: result, msg: "Rewind reply ready" });
  } catch (error: unknown) {
    console.log(error)
    handleIntelligenceError(error, "send chat message", req, res);
  }
}

export async function updateChat(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const updated = await setRewindChatArchived({
      archived: Boolean(req.body.archived),
      chatId: String(req.params.chatId),
      userId: req.userId!,
    });
    if (!updated) {
      res.status(404).json({ msg: "Chat not found" });
      return;
    }
    res.json({ msg: req.body.archived ? "Chat archived" : "Chat restored" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "update chat", req, res);
  }
}

export async function recordActivity(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const timezone = await getUserTimezone(userId);
    const happenedAt = req.body.happenedAt
      ? DateTime.fromISO(String(req.body.happenedAt)).toJSDate()
      : new Date();
    await recordActivitySignal({
      dedupeKey: `client:${req.body.eventType}:${req.body.sourceId}`,
      description: String(req.body.description),
      eventType: String(req.body.eventType),
      happenedAt,
      sourceId: String(req.body.sourceId),
      sourceType: ActivitySignalSourceType.FLEXX,
      timezone,
      userId,
    });
    res.status(202).json({ msg: "Activity recorded" });
  } catch (error: unknown) {
    handleIntelligenceError(error, "record activity", req, res);
  }
}
