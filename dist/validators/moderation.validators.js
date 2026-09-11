"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blockUserParamsSchema = exports.blockUserSchema = exports.moderationEvidenceSchema = exports.moderationReasonSchema = void 0;
const zod_1 = require("zod");
exports.moderationReasonSchema = zod_1.z.enum([
    "harassment",
    "hate",
    "sexual",
    "violence",
    "spam",
    "other",
]);
exports.moderationEvidenceSchema = zod_1.z.object({
    details: zod_1.z.string().trim().max(1000).optional(),
    reason: exports.moderationReasonSchema.default("other"),
    targetId: zod_1.z.string().trim().min(1).max(128),
    targetType: zod_1.z.enum(["activity", "comment", "user"]),
});
exports.blockUserSchema = exports.moderationEvidenceSchema
    .partial()
    .extend({
    details: zod_1.z.string().trim().max(1000).optional(),
    reason: exports.moderationReasonSchema.default("other"),
    targetId: zod_1.z.string().trim().min(1).max(128).optional(),
    targetType: zod_1.z.enum(["activity", "comment", "user"]).optional(),
})
    .refine((value) => Boolean(value.targetType) === Boolean(value.targetId), "Both target type and target ID are required for block evidence");
exports.blockUserParamsSchema = zod_1.z.object({
    userId: zod_1.z.string().trim().min(1).max(128),
});
