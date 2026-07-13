"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.joinByCodeSchema = exports.inviteCodeParamSchema = exports.createInviteSchema = exports.commentIdParamSchema = exports.activityIdParamSchema = exports.createCommentSchema = exports.updateMemberRoleSchema = exports.joinCommunitySchema = exports.startGoalFromTemplateSchema = exports.templateIdParamSchema = exports.updateTemplateSchema = exports.createTemplateSchema = exports.communityIdParamSchema = exports.updateCommunitySchema = exports.createCommunitySchema = void 0;
const zod_1 = require("zod");
const communityCoverImageSchema = zod_1.z
    .string()
    .refine((value) => value.startsWith("illustration:") || zod_1.z.string().url().safeParse(value).success, "Cover image must be a valid URL or illustration token");
// Community creation schema
exports.createCommunitySchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .min(1, "Community name is required")
        .max(100, "Community name must be less than 100 characters"),
    description: zod_1.z
        .string()
        .max(1000, "Description must be less than 1000 characters")
        .optional(),
    coverImage: communityCoverImageSchema.optional(),
    isPublic: zod_1.z.boolean().default(true),
    category: zod_1.z.string().max(50, "Category must be less than 50 characters").optional(),
});
// Community update schema
exports.updateCommunitySchema = zod_1.z.object({
    name: zod_1.z
        .string()
        .min(1, "Community name is required")
        .max(100, "Community name must be less than 100 characters")
        .optional(),
    description: zod_1.z
        .string()
        .max(1000, "Description must be less than 1000 characters")
        .optional(),
    coverImage: communityCoverImageSchema.nullable().optional(),
    isPublic: zod_1.z.boolean().optional(),
    category: zod_1.z.string().max(50, "Category must be less than 50 characters").nullable().optional(),
});
// Community ID param schema
exports.communityIdParamSchema = zod_1.z.object({
    communityId: zod_1.z.string().min(1, "Community ID is required"),
});
const milestoneSchema = zod_1.z.object({
    id: zod_1.z.string().optional(), // Present when updating existing milestones
    name: zod_1.z
        .string()
        .min(1, "Milestone name is required")
        .max(100, "Milestone name must be less than 100 characters"),
    description: zod_1.z
        .string()
        .max(500, "Description must be less than 500 characters")
        .optional(),
    triggerType: zod_1.z.enum(["DAY", "PERCENTAGE", "SEQUENCE"]),
    triggerValue: zod_1.z
        .number()
        .int("Trigger value must be an integer")
        .min(1, "Trigger value must be at least 1")
        .max(365, "Trigger value cannot exceed 365"),
    points: zod_1.z
        .number()
        .min(0, "Points cannot be negative"),
    sequenceBonusPoints: zod_1.z
        .number()
        .min(0, "Sequence bonus points cannot be negative")
        .optional(),
    order: zod_1.z
        .number()
        .int("Order must be an integer")
        .min(0, "Order cannot be negative")
        .optional(),
});
// Goal template creation schema (aligned with goal creation)
exports.createTemplateSchema = zod_1.z.object({
    goalText: zod_1.z
        .string()
        .min(1, "Goal text is required")
        .max(500, "Goal text must be less than 500 characters"),
    targetDays: zod_1.z
        .number()
        .int("Target days must be an integer")
        .min(1, "Target days must be at least 1")
        .max(365, "Target days cannot exceed 365"),
    reminderTime: zod_1.z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Reminder time must be in HH:MM format (24-hour)")
        .optional(),
    milestones: zod_1.z.array(milestoneSchema).optional(),
});
// Goal template update schema (aligned with goal update)
exports.updateTemplateSchema = zod_1.z.object({
    goalText: zod_1.z
        .string()
        .min(1, "Goal text is required")
        .max(500, "Goal text must be less than 500 characters")
        .optional(),
    targetDays: zod_1.z
        .number()
        .int("Target days must be an integer")
        .min(1, "Target days must be at least 1")
        .max(365, "Target days cannot exceed 365")
        .optional(),
    reminderTime: zod_1.z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Reminder time must be in HH:MM format (24-hour)")
        .nullable()
        .optional(),
    milestones: zod_1.z.array(milestoneSchema).optional(),
});
// Template ID param schema
exports.templateIdParamSchema = zod_1.z.object({
    templateId: zod_1.z.string().min(1, "Template ID is required"),
});
// Start goal from template schema
exports.startGoalFromTemplateSchema = zod_1.z.object({
    reminderTime: zod_1.z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Reminder time must be in HH:MM format (24-hour)")
        .optional(),
});
// Join community schema
exports.joinCommunitySchema = zod_1.z.object({
    communityId: zod_1.z.string().min(1, "Community ID is required"),
});
// Update member role schema
exports.updateMemberRoleSchema = zod_1.z.object({
    userId: zod_1.z.string().min(1, "User ID is required"),
    role: zod_1.z.enum(["OWNER", "MOD", "MEMBER"], {
        errorMap: () => ({ message: "Role must be OWNER, MOD, or MEMBER" }),
    }),
});
// Activity comment schema
exports.createCommentSchema = zod_1.z.object({
    text: zod_1.z
        .string()
        .min(1, "Comment text is required")
        .max(1000, "Comment must be less than 1000 characters"),
});
// Activity ID param schema
exports.activityIdParamSchema = zod_1.z.object({
    activityId: zod_1.z.string().min(1, "Activity ID is required"),
});
// Comment ID param schema
exports.commentIdParamSchema = zod_1.z.object({
    commentId: zod_1.z.string().min(1, "Comment ID is required"),
});
// ==================== Invite schemas ====================
// Create invite schema
exports.createInviteSchema = zod_1.z.object({
    inviteeUsername: zod_1.z.string().trim().min(1).max(20).optional(),
    inviteeEmail: zod_1.z.string().trim().email("Must be a valid email").optional(),
    maxUses: zod_1.z.number().int().min(-1).default(-1).optional(), // -1 = unlimited
    expiresInDays: zod_1.z.number().int().min(1).max(30).optional(), // optional expiry
}).refine((data) => !(data.inviteeUsername && data.inviteeEmail), {
    message: "Invite by username or email, not both",
});
// Invite code param schema
exports.inviteCodeParamSchema = zod_1.z.object({
    code: zod_1.z.string().min(1, "Invite code is required"),
});
// Join by code schema
exports.joinByCodeSchema = zod_1.z.object({
    code: zod_1.z.string().min(1, "Invite code is required"),
});
