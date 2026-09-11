import { z } from "zod";

export const moderationReasonSchema = z.enum([
  "harassment",
  "hate",
  "sexual",
  "violence",
  "spam",
  "other",
]);

export const moderationEvidenceSchema = z.object({
  details: z.string().trim().max(1_000).optional(),
  reason: moderationReasonSchema.default("other"),
  targetId: z.string().trim().min(1).max(128),
  targetType: z.enum(["activity", "comment", "user"]),
});

export const blockUserSchema = moderationEvidenceSchema
  .partial()
  .extend({
    details: z.string().trim().max(1_000).optional(),
    reason: moderationReasonSchema.default("other"),
    targetId: z.string().trim().min(1).max(128).optional(),
    targetType: z.enum(["activity", "comment", "user"]).optional(),
  })
  .refine(
    (value) => Boolean(value.targetType) === Boolean(value.targetId),
    "Both target type and target ID are required for block evidence",
  );

export const blockUserParamsSchema = z.object({
  userId: z.string().trim().min(1).max(128),
});
