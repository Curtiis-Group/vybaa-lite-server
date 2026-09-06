import {
  RewindChatMessageRole,
  RewindChatRunStatus,
  RewindChatTurnStatus,
  RewindChatType,
  RewindPartnerMindState,
} from "@prisma/client";
import { randomUUID } from "node:crypto";

import { prisma } from "../config/db.config";
import { publishRewindChatEvent } from "./rewind-chat-realtime.service";
import { RewindV2ChatError } from "./rewind-chat-v2.service";

const ACTIVE_RUN_STATUSES = [
  RewindChatRunStatus.QUEUED,
  RewindChatRunStatus.PLANNING,
  RewindChatRunStatus.GENERATING,
];
const ACTIVE_TURN_STATUSES = [
  RewindChatTurnStatus.PLANNED,
  RewindChatTurnStatus.GENERATING,
];

type CancelledTurn = {
  personaId: string;
  runId: string;
  turnId: string;
};

async function publishInvalidation(params: {
  chatId: string;
  runIds: string[];
  turns: CancelledTurn[];
  userId: string;
}): Promise<void> {
  await Promise.all([
    ...params.turns.map((turn) =>
      publishRewindChatEvent(params.userId, {
        chatId: params.chatId,
        personaId: turn.personaId,
        runId: turn.runId,
        turnId: turn.turnId,
        type: "typing_stopped",
      }),
    ),
    ...params.runIds.map((runId) =>
      publishRewindChatEvent(params.userId, {
        chatId: params.chatId,
        runId,
        status: RewindChatRunStatus.CANCELLED,
        type: "run_state",
      }),
    ),
  ]);
  await publishRewindChatEvent(params.userId, {
    chatId: params.chatId,
    runId: `management:${randomUUID()}`,
    type: "chat_invalidated",
  });
}

export async function renameRewindGroupChat(params: {
  chatId: string;
  title: string;
  userId: string;
}): Promise<{ title: string }> {
  const chat = await prisma.rewindChat.findFirst({
    select: { id: true, type: true },
    where: { id: params.chatId, userId: params.userId },
  });
  if (!chat) {
    throw new RewindV2ChatError("CHAT_NOT_FOUND", "Chat not found", 404);
  }
  if (chat.type !== RewindChatType.GROUP) {
    throw new RewindV2ChatError(
      "CHAT_TITLE_LOCKED",
      "Only the group chat name can be changed",
      400,
    );
  }
  const updated = await prisma.rewindChat.update({
    data: { title: params.title },
    select: { title: true },
    where: { id: chat.id },
  });
  await publishRewindChatEvent(params.userId, {
    chatId: chat.id,
    runId: `management:${randomUUID()}`,
    type: "chat_invalidated",
  });
  return updated;
}

export async function deleteRewindChatMessages(params: {
  chatId: string;
  messageId?: string;
  userId: string;
}): Promise<{ deletedCount: number }> {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const chat = await tx.rewindChat.findFirst({
      select: { id: true, lastReadAt: true },
      where: { id: params.chatId, userId: params.userId },
    });
    if (!chat) {
      throw new RewindV2ChatError("CHAT_NOT_FOUND", "Chat not found", 404);
    }

    if (params.messageId) {
      const message = await tx.rewindChatMessage.findFirst({
        select: { id: true },
        where: {
          chatId: chat.id,
          id: params.messageId,
          userId: params.userId,
        },
      });
      if (!message) {
        throw new RewindV2ChatError(
          "MESSAGE_NOT_FOUND",
          "Message not found",
          404,
        );
      }
    }

    const [activeRuns, activeTurns] = await Promise.all([
      tx.rewindChatRun.findMany({
        select: { id: true },
        where: { chatId: chat.id, status: { in: ACTIVE_RUN_STATUSES } },
      }),
      tx.rewindChatTurn.findMany({
        select: { id: true, personaId: true, runId: true },
        where: { chatId: chat.id, status: { in: ACTIVE_TURN_STATUSES } },
      }),
    ]);

    await tx.rewindChatTurn.updateMany({
      data: { cancelledAt: now, status: RewindChatTurnStatus.CANCELLED },
      where: { chatId: chat.id, status: { in: ACTIVE_TURN_STATUSES } },
    });
    await tx.rewindChatRun.updateMany({
      data: { cancelledAt: now, status: RewindChatRunStatus.CANCELLED },
      where: { chatId: chat.id, status: { in: ACTIVE_RUN_STATUSES } },
    });

    const deleted = await tx.rewindChatMessage.deleteMany({
      where: {
        chatId: chat.id,
        userId: params.userId,
        ...(params.messageId ? { id: params.messageId } : {}),
      },
    });
    const latestMessage = await tx.rewindChatMessage.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
      where: { chatId: chat.id },
    });
    const unreadCount = chat.lastReadAt
      ? await tx.rewindChatMessage.count({
          where: {
            chatId: chat.id,
            createdAt: { gt: chat.lastReadAt },
            role: RewindChatMessageRole.PARTNER,
          },
        })
      : await tx.rewindChatMessage.count({
          where: { chatId: chat.id, role: RewindChatMessageRole.PARTNER },
        });
    const updatedChat = await tx.rewindChat.update({
      data: {
        contextRevision: { increment: 1 },
        contextSummary: null,
        contextSummaryThroughMessageId: null,
        contextSummaryUpdatedAt: null,
        lastMessageAt: latestMessage?.createdAt ?? null,
        ...(params.messageId
          ? { unreadCount }
          : { lastReadAt: null, unreadCount: 0 }),
      },
      select: { contextRevision: true },
      where: { id: chat.id },
    });
    await tx.rewindPartnerMind.updateMany({
      data: {
        confidence: null,
        contextRevision: updatedChat.contextRevision,
        intentSummary: null,
        state: RewindPartnerMindState.WATCHING,
      },
      where: { chatId: chat.id, userId: params.userId },
    });

    return {
      deletedCount: deleted.count,
      runIds: activeRuns.map((run) => run.id),
      turns: activeTurns.map((turn) => ({
        personaId: turn.personaId,
        runId: turn.runId,
        turnId: turn.id,
      })),
    };
  });

  await publishInvalidation({
    chatId: params.chatId,
    runIds: result.runIds,
    turns: result.turns,
    userId: params.userId,
  });
  return { deletedCount: result.deletedCount };
}
