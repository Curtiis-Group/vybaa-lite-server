import {
  Prisma,
  RevenueCatWebhookStatus,
  type RevenueCatWebhookEvent,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";

import { prisma } from "../config/db.config";
import {
  fromPrismaClientApp,
  type ClientApp,
  toPrismaClientApp,
} from "../types/client-app.type";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";
import { getRevenueCatSubscriptionStatus } from "./revenuecat.service";

const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
const WEBHOOK_BATCH_SIZE = 25;
const WEBHOOK_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const WEBHOOK_MAX_RETRY_DELAY_MS = 60 * 60 * 1000;

type RevenueCatEventPayload = {
  aliases: string[];
  appUserId: string | null;
  id: string;
  transferredFrom: string[];
  transferredTo: string[];
  type: string;
};

export type RevenueCatWebhookEnvelope = {
  event: RevenueCatEventPayload;
};

export type RevenueCatWebhookRegistration = {
  duplicate: boolean;
  eventId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function getWebhookSecret(clientApp: ClientApp): string {
  return (
    clientApp === "mycove"
      ? Env.MYCOVE_REVENUECAT_WEBHOOK_SECRET
      : Env.REVENUECAT_WEBHOOK_SECRET
  )?.trim() ?? "";
}

export function isRevenueCatWebhookConfigured(clientApp: ClientApp): boolean {
  return Boolean(getWebhookSecret(clientApp));
}

function getSignatureParts(
  signature: string,
): { timestamp: number; value: string } | null {
  const parts = new Map<string, string>();
  for (const part of signature.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key && value) parts.set(key, value);
  }

  const timestampValue = parts.get("t");
  const value = parts.get("v1");
  if (!timestampValue || !value || !/^[a-f\d]{64}$/i.test(value)) return null;

  const timestamp = Number(timestampValue);
  if (!Number.isInteger(timestamp)) return null;
  return { timestamp, value };
}

export function parseRevenueCatWebhook(
  rawPayload: string,
): RevenueCatWebhookEnvelope | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawPayload);
  } catch {
    return null;
  }

  if (!isRecord(payload) || !isRecord(payload.event)) return null;
  const event = payload.event;
  if (typeof event.id !== "string" || typeof event.type !== "string") {
    return null;
  }

  return {
    event: {
      aliases: getStringArray(event.aliases),
      appUserId:
        typeof event.app_user_id === "string" ? event.app_user_id : null,
      id: event.id,
      transferredFrom: getStringArray(event.transferred_from),
      transferredTo: getStringArray(event.transferred_to),
      type: event.type,
    },
  };
}

export function getRevenueCatWebhookUserCandidates(
  event: RevenueCatEventPayload,
): string[] {
  const candidates = [
    event.appUserId,
    ...event.aliases,
    ...event.transferredFrom,
    ...event.transferredTo,
  ].filter(
    (value): value is string =>
      Boolean(value) && !value.startsWith("$RCAnonymousID:"),
  );

  return [...new Set(candidates)];
}

export function verifyRevenueCatWebhookSignature(params: {
  clientApp: ClientApp;
  now?: Date;
  rawBody: Buffer;
  signature: string;
}): boolean {
  const secret = getWebhookSecret(params.clientApp);
  if (!secret) return false;

  const signatureParts = getSignatureParts(params.signature);
  if (!signatureParts) return false;

  const nowSeconds = Math.floor((params.now ?? new Date()).getTime() / 1000);
  if (
    Math.abs(nowSeconds - signatureParts.timestamp) >
    WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
  ) {
    return false;
  }

  const expected = createHmac("sha256", secret)
    .update(Buffer.from(`${signatureParts.timestamp}.`))
    .update(params.rawBody)
    .digest();
  const received = Buffer.from(signatureParts.value, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function registerRevenueCatWebhook(params: {
  clientApp: ClientApp;
  envelope: RevenueCatWebhookEnvelope;
  rawPayload: string;
}): Promise<RevenueCatWebhookRegistration> {
  try {
    const event = await prisma.revenueCatWebhookEvent.create({
      data: {
        appUserId: params.envelope.event.appUserId,
        clientApp: toPrismaClientApp(params.clientApp),
        eventType: params.envelope.event.type,
        externalEventId: params.envelope.event.id,
        rawPayload: params.rawPayload,
      },
      select: { id: true },
    });
    return { duplicate: false, eventId: event.id };
  } catch (error: unknown) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }

    const existing = await prisma.revenueCatWebhookEvent.findUniqueOrThrow({
      where: {
        clientApp_externalEventId: {
          clientApp: toPrismaClientApp(params.clientApp),
          externalEventId: params.envelope.event.id,
        },
      },
      select: { id: true },
    });
    return { duplicate: true, eventId: existing.id };
  }
}

async function findWebhookUserId(
  webhookEvent: RevenueCatWebhookEvent,
): Promise<string | null> {
  const envelope = parseRevenueCatWebhook(webhookEvent.rawPayload);
  if (!envelope) return null;

  const candidates = getRevenueCatWebhookUserCandidates(envelope.event);
  if (!candidates.length) return null;

  const user = await prisma.user.findFirst({
    where: { id: { in: candidates } },
    select: { id: true },
  });
  return user?.id ?? null;
}

function getRetryTime(attemptCount: number, now: Date): Date {
  const delay = Math.min(
    2 ** Math.max(0, attemptCount - 1) * 60_000,
    WEBHOOK_MAX_RETRY_DELAY_MS,
  );
  return new Date(now.getTime() + delay);
}

export async function processRevenueCatWebhookEvent(
  eventId: string,
  now: Date = new Date(),
): Promise<void> {
  const claim = await prisma.revenueCatWebhookEvent.updateMany({
    where: {
      id: eventId,
      status: {
        in: [
          RevenueCatWebhookStatus.RECEIVED,
          RevenueCatWebhookStatus.FAILED,
        ],
      },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      attemptCount: { increment: 1 },
      lastError: null,
      status: RevenueCatWebhookStatus.PROCESSING,
    },
  });
  if (!claim.count) return;

  const webhookEvent = await prisma.revenueCatWebhookEvent.findUniqueOrThrow({
    where: { id: eventId },
  });

  try {
    const userId = await findWebhookUserId(webhookEvent);
    if (userId) {
      await getRevenueCatSubscriptionStatus(
        userId,
        fromPrismaClientApp(webhookEvent.clientApp),
        { forceRefresh: true, now },
      );
    }

    await prisma.revenueCatWebhookEvent.update({
      where: { id: eventId },
      data: {
        nextAttemptAt: null,
        processedAt: now,
        rawPayload: "{}",
        status: RevenueCatWebhookStatus.COMPLETED,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Unknown error";
    await prisma.revenueCatWebhookEvent.update({
      where: { id: eventId },
      data: {
        lastError: message,
        nextAttemptAt: getRetryTime(webhookEvent.attemptCount, now),
        status: RevenueCatWebhookStatus.FAILED,
      },
    });
    logger.warn("RevenueCat webhook processing will retry", {
      eventId,
      eventType: webhookEvent.eventType,
    });
  }
}

export async function processPendingRevenueCatWebhooks(
  now: Date = new Date(),
): Promise<number> {
  await prisma.revenueCatWebhookEvent.updateMany({
    where: {
      status: RevenueCatWebhookStatus.PROCESSING,
      updatedAt: {
        lt: new Date(now.getTime() - WEBHOOK_PROCESSING_TIMEOUT_MS),
      },
    },
    data: {
      nextAttemptAt: now,
      status: RevenueCatWebhookStatus.FAILED,
    },
  });

  const pending = await prisma.revenueCatWebhookEvent.findMany({
    where: {
      status: {
        in: [
          RevenueCatWebhookStatus.RECEIVED,
          RevenueCatWebhookStatus.FAILED,
        ],
      },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { receivedAt: "asc" },
    select: { id: true },
    take: WEBHOOK_BATCH_SIZE,
  });

  await Promise.all(
    pending.map((event) => processRevenueCatWebhookEvent(event.id, now)),
  );
  return pending.length;
}
