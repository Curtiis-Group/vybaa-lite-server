"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSocialDraftSchema = exports.socialMentionIdParamSchema = exports.socialDraftIdParamSchema = exports.generateSocialPostDraftSchema = exports.updateSocialPreferencesSchema = exports.xOAuthStartSchema = void 0;
const zod_1 = require("zod");
const textListSchema = zod_1.z.array(zod_1.z.string().trim().min(1).max(100)).max(20);
exports.xOAuthStartSchema = zod_1.z
    .object({
    disclosureAccepted: zod_1.z.literal(true),
    returnUrl: zod_1.z.string().trim().min(1).max(500),
})
    .strict();
exports.updateSocialPreferencesSchema = zod_1.z
    .object({
    audience: zod_1.z.string().trim().max(1000).nullable(),
    avoidTopics: textListSchema,
    scheduleDayOfWeek: zod_1.z.number().int().min(1).max(7),
    scheduleEnabled: zod_1.z.boolean(),
    scheduleFrequency: zod_1.z.enum(["DAILY", "WEEKLY"]),
    scheduleTime: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    tone: zod_1.z.string().trim().max(1000).nullable(),
    topics: textListSchema,
    voiceNotes: zod_1.z.string().trim().max(2000).nullable(),
})
    .strict();
exports.generateSocialPostDraftSchema = zod_1.z
    .object({
    brief: zod_1.z.string().trim().min(1).max(1000).optional(),
    type: zod_1.z.enum(["POST", "THREAD"]),
})
    .strict();
exports.socialDraftIdParamSchema = zod_1.z.object({
    draftId: zod_1.z.string().trim().min(1).max(128),
});
exports.socialMentionIdParamSchema = zod_1.z.object({
    mentionId: zod_1.z.string().trim().min(1).max(128),
});
exports.updateSocialDraftSchema = zod_1.z
    .object({
    segments: zod_1.z.array(zod_1.z.string().trim().min(1).max(280)).min(1).max(6),
})
    .strict();
