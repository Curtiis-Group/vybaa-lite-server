import { randomInt } from "node:crypto";

import { prisma } from "../config/db.config";
import logger from "../utils/logger.util";
import { publishRewindChatEvent } from "./rewind-chat-realtime.service";

export function createRewindReadSchedule(
  personas: readonly string[],
  now: Date,
): Record<string, string> {
  const schedule: Record<string, string> = {};
  let delay = randomInt(2_500, 6_001);
  // Shuffle who notices first, rather than always letting the same partner lead.
  const remaining = [...new Set(personas)];
  while (remaining.length) {
    const index = randomInt(remaining.length);
    const persona = remaining.splice(index, 1)[0];
    if (!persona) continue;
    schedule[persona] = new Date(now.getTime() + delay).toISOString();
    delay += randomInt(2_000, 7_001);
  }
  return schedule;
}

export function getRewindReadTimes(value: unknown): number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.values(value)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => Date.parse(entry))
    .filter(Number.isFinite);
}

export function getRewindPersonaReadTime(
  value: unknown,
  personaId: string,
): number | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = Object.entries(value).find(([key]) => key === personaId)?.[1];
  const time = typeof entry === "string" ? Date.parse(entry) : NaN;
  return Number.isFinite(time) ? time : null;
}

export async function processRewindChatReadReceipts(
  messageId?: string,
  userId?: string,
): Promise<void> {
  const now = new Date();
  const messages = await prisma.rewindChatMessage.findMany({
    select: {
      id: true,
      userId: true,
      chatId: true,
      runId: true,
      readDueAt: true,
    },
    where: {
      id: messageId,
      userId,
      role: "USER",
      seenAt: null,
      readDueAt: { lte: now },
    },
    orderBy: { readDueAt: "asc" },
    take: 100,
  });
  for (const message of messages) {
    if (!message.readDueAt) continue;
    const outboxId = await prisma.$transaction(async (tx) => {
      const updated = await tx.rewindChatMessage.updateMany({
        data: { seenAt: message.readDueAt },
        where: {
          id: message.id,
          userId: message.userId,
          seenAt: null,
          readDueAt: { lte: now },
        },
      });
      if (!updated.count) return null;
      const outbox = await tx.rewindChatOutbox.create({
        data: {
          chatId: message.chatId,
          userId: message.userId,
          dedupeKey: `user_message_seen:${message.id}`,
          eventType: "user_message_seen",
          payload: { messageId: message.id, runId: message.runId ?? "" },
        },
      });
      return outbox.id;
    });
    if (!outboxId) continue;
    const published = await publishRewindChatEvent(message.userId, {
      chatId: message.chatId,
      messageId: message.id,
      runId: message.runId ?? "",
      seenAt: message.readDueAt.toISOString(),
      type: "user_message_seen",
    });
    if (published) {
      await prisma.rewindChatOutbox.update({
        data: { publishedAt: new Date() },
        where: { id: outboxId },
      });
    }
  }
}

export async function deliverRewindReadReceiptLater(
  messageId: string,
  userId: string,
  dueAt: Date,
): Promise<void> {
  try {
    const delay = Math.max(0, dueAt.getTime() - Date.now());
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    await processRewindChatReadReceipts(messageId, userId);
  } catch (error: unknown) {
    logger.warn("Read receipt will retry in the chat worker", {
      messageId,
      userId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
