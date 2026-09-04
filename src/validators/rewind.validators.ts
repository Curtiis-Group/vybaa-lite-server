import { z } from "zod";

export const createLiveTokenSchema = z.object({
  personaId: z.enum(["ella", "lyra", "jake", "ariel"]),
});

export const rewindChatIdSchema = z.object({
  chatId: z.string().trim().min(1).max(128),
});

export const rewindObservationIdSchema = z.object({
  observationId: z.string().trim().min(1).max(128),
});

export const listRewindRecordsSchema = z.object({
  cursor: z.string().trim().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const sendRewindChatMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  idempotencyKey: z.string().trim().min(8).max(160),
});

export const updateRewindChatSchema = z.object({
  archived: z.boolean(),
});

export const rewindV2ChatPreferencesSchema = z.object({
  proactiveMuted: z.boolean(),
});

export const rewindV2ReadChatSchema = z.object({
  throughMessageId: z.string().trim().min(1).max(128),
});

export const recordRewindActivitySchema = z.object({
  description: z.string().trim().min(1).max(500),
  eventType: z.enum(["FLEXX_CREATED", "FLEXX_SHARED"]),
  happenedAt: z.string().datetime().optional(),
  sourceId: z.string().trim().min(1).max(128),
});
