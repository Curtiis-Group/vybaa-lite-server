import { RewindChatRunStatus, RewindChatTurnStatus } from "@prisma/client";
import type { Response } from "express";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  enqueueRewindChatMessage,
  ensureRewindPartnerMinds,
  RewindV2ChatError,
  setUserRewindChatReaction,
} from "../services/rewind-chat-v2.service";
import {
  serializeRewindChatMessage,
  serializeRewindChatSummary,
} from "../services/rewind-chat-serialization.service";
import { ensureDefaultRewindChats } from "../services/rewind-chat.service";
import logger from "../utils/logger.util";

function getErrorDetails(error: unknown): {
  errorMessage: string;
  errorName: string;
  errorStack?: string;
} {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name,
      ...(error.stack ? { errorStack: error.stack } : {}),
    };
  }
  return {
    errorMessage: String(error),
    errorName: "UnknownError",
  };
}

function handleError(error: unknown, res: Response, req: AuthRequest): void {
  const details = getErrorDetails(error);
  const requestContext = {
    chatId:
      typeof req.params.chatId === "string" ? req.params.chatId : undefined,
    httpMethod: req.method,
    httpPath: req.originalUrl,
    userId: req.userId,
  };
  if (error instanceof RewindV2ChatError) {
    logger.warn("Rewind v2 chat request rejected", {
      ...details,
      ...requestContext,
      reasonCode: error.code,
      statusCode: error.status,
    });
    res.status(error.status).json({ code: error.code, msg: error.message });
    return;
  }
  logger.error("Rewind v2 chat request failed", {
    ...details,
    ...requestContext,
    statusCode: 500,
  });
  res.status(500).json({
    code: "REWIND_CHAT_FAILED",
    msg: "Rewind chat is unavailable right now",
  });
}

async function getOwnedChat(chatId: string, userId: string) {
  const chat = await prisma.rewindChat.findFirst({
    where: { id: chatId, userId },
  });
  if (!chat)
    throw new RewindV2ChatError("CHAT_NOT_FOUND", "Chat not found", 404);
  return chat;
}

export async function getUsage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.userId!;
    const [totals, entries] = await Promise.all([
      prisma.aiUsageLedger.aggregate({
        _sum: {
          estimatedCostUsd: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
        },
        where: { userId },
      }),
      prisma.aiUsageLedger.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        where: { userId },
      }),
    ]);
    res.json({
      data: {
        entries: entries.map((entry) => ({
          costUsd: entry.estimatedCostUsd,
          createdAt: entry.createdAt.toISOString(),
          id: entry.id,
          inputTokens: entry.inputTokens,
          model: entry.model,
          operation: entry.operation,
          outputTokens: entry.outputTokens,
          runId: entry.runId,
          totalTokens: entry.totalTokens,
          turnId: entry.turnId,
        })),
        totals: {
          estimatedCostUsd: totals._sum.estimatedCostUsd ?? 0,
          inputTokens: totals._sum.inputTokens ?? 0,
          outputTokens: totals._sum.outputTokens ?? 0,
          totalTokens: totals._sum.totalTokens ?? 0,
        },
      },
      msg: "AI usage retrieved",
    });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function listChats(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    await ensureDefaultRewindChats(req.userId!);
    const chats = await prisma.rewindChat.findMany({
      include: {
        messages: {
          include: { reactions: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
        },
        turns: {
          where: { status: RewindChatTurnStatus.GENERATING },
          select: { personaId: true },
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "asc" }],
      where: { archivedAt: null, userId: req.userId! },
    });
    await Promise.all(
      chats.map((chat) =>
        ensureRewindPartnerMinds(
          chat.id,
          req.userId!,
          chat.type,
          chat.personaId,
        ),
      ),
    );
    res.json({
      data: {
        chats: chats.map(serializeRewindChatSummary),
      },
      msg: "Rewind chats retrieved",
    });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function listMessages(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const chat = await getOwnedChat(String(req.params.chatId), req.userId!);
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 30)));
    const rows = await prisma.rewindChatMessage.findMany({
      include: { reactions: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
      where: { chatId: chat.id, userId: req.userId! },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const activeTurns = await prisma.rewindChatTurn.findMany({
      select: { id: true, personaId: true, runId: true, status: true },
      where: {
        chatId: chat.id,
        status: {
          in: [RewindChatTurnStatus.PLANNED, RewindChatTurnStatus.GENERATING],
        },
      },
    });
    res.json({
      data: {
        activeTurns,
        chat: {
          contextRevision: chat.contextRevision,
          id: chat.id,
          proactiveMuted: chat.proactiveMuted,
          unreadCount: chat.unreadCount,
        },
        items: [...page].reverse().map(serializeRewindChatMessage),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      },
      msg: "Rewind chat messages retrieved",
    });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function enqueueMessage(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const userId = req.userId!;
    const user = await prisma.user.findUnique({
      select: { timezone: true },
      where: { id: userId },
    });
    const result = await enqueueRewindChatMessage({
      chatId: String(req.params.chatId),
      content: String(req.body.content),
      idempotencyKey: String(req.body.idempotencyKey),
      replyToMessageId:
        typeof req.body.replyToMessageId === "string"
          ? req.body.replyToMessageId
          : null,
      timezone: user?.timezone ?? "UTC",
      userId,
    });
    res.status(202).json({ data: result, msg: "Message queued" });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function markRead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const chat = await getOwnedChat(String(req.params.chatId), req.userId!);
    const message = await prisma.rewindChatMessage.findFirst({
      where: {
        chatId: chat.id,
        id: String(req.body.throughMessageId),
        userId: req.userId!,
      },
    });
    if (!message)
      throw new RewindV2ChatError(
        "MESSAGE_NOT_FOUND",
        "Message not found",
        404,
      );
    await prisma.rewindChat.update({
      data: { lastReadAt: message.createdAt, unreadCount: 0 },
      where: { id: chat.id },
    });
    res.json({
      data: { lastReadAt: message.createdAt.toISOString(), unreadCount: 0 },
      msg: "Chat marked as read",
    });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function updateReaction(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const reactions = await setUserRewindChatReaction({
      chatId: String(req.params.chatId),
      kind: req.body.reaction,
      messageId: String(req.params.messageId),
      userId: req.userId!,
    });
    res.json({ data: { reactions }, msg: "Reaction updated" });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function updatePreferences(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const chat = await getOwnedChat(String(req.params.chatId), req.userId!);
    const updated = await prisma.rewindChat.update({
      data: { proactiveMuted: Boolean(req.body.proactiveMuted) },
      where: { id: chat.id },
    });
    res.json({
      data: { proactiveMuted: updated.proactiveMuted },
      msg: "Chat preferences updated",
    });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}

export async function getLiveState(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const chat = await getOwnedChat(String(req.params.chatId), req.userId!);
    const runs = await prisma.rewindChatRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      where: {
        chatId: chat.id,
        status: {
          in: [
            RewindChatRunStatus.QUEUED,
            RewindChatRunStatus.PLANNING,
            RewindChatRunStatus.GENERATING,
          ],
        },
      },
      include: {
        turns: {
          where: {
            status: {
              in: [
                RewindChatTurnStatus.PLANNED,
                RewindChatTurnStatus.GENERATING,
              ],
            },
          },
          select: { id: true, personaId: true, runId: true, status: true },
        },
      },
    });
    res.json({ data: { runs }, msg: "Rewind chat live state retrieved" });
  } catch (error: unknown) {
    handleError(error, res, req);
  }
}
