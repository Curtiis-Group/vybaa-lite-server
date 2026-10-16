import { z } from "zod";

const textListSchema = z.array(z.string().trim().min(1).max(100)).max(20);

export const xOAuthStartSchema = z
  .object({
    disclosureAccepted: z.literal(true),
    returnUrl: z.string().trim().min(1).max(500),
  })
  .strict();

export const updateSocialPreferencesSchema = z
  .object({
    audience: z.string().trim().max(1_000).nullable(),
    avoidTopics: textListSchema,
    scheduleDayOfWeek: z.number().int().min(1).max(7),
    scheduleEnabled: z.boolean(),
    scheduleFrequency: z.enum(["DAILY", "WEEKLY"]),
    scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    tone: z.string().trim().max(1_000).nullable(),
    topics: textListSchema,
    voiceNotes: z.string().trim().max(2_000).nullable(),
  })
  .strict();

export const socialActivityConsentSchema = z
  .object({ accepted: z.boolean() })
  .strict();

export const socialSuggestionRefreshSchema = z
  .object({ force: z.boolean().default(false) })
  .strict();

export const generateSocialPostDraftSchema = z
  .object({
    brief: z.string().trim().min(1).max(1_000).optional(),
    type: z.enum(["POST", "THREAD"]),
  })
  .strict();

export const socialDraftIdParamSchema = z.object({
  draftId: z.string().trim().min(1).max(128),
});

export const socialMentionIdParamSchema = z.object({
  mentionId: z.string().trim().min(1).max(128),
});

export const updateSocialDraftSchema = z
  .object({
    segments: z.array(z.string().trim().min(1).max(280)).min(1).max(6),
  })
  .strict();
