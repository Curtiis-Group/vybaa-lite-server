import { z } from "zod";

const communityCoverImageSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("illustration:") || z.string().url().safeParse(value).success,
    "Cover image must be a valid URL or illustration token",
  );

// Community creation schema
export const createCommunitySchema = z.object({
  name: z
    .string()
    .min(1, "Community name is required")
    .max(100, "Community name must be less than 100 characters"),
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional(),
  coverImage: communityCoverImageSchema.optional(),
  isPublic: z.boolean().default(true),
  category: z.string().max(50, "Category must be less than 50 characters").optional(),
});

// Community update schema
export const updateCommunitySchema = z.object({
  name: z
    .string()
    .min(1, "Community name is required")
    .max(100, "Community name must be less than 100 characters")
    .optional(),
  description: z
    .string()
    .max(1000, "Description must be less than 1000 characters")
    .optional(),
  coverImage: communityCoverImageSchema.nullable().optional(),
  isPublic: z.boolean().optional(),
  category: z.string().max(50, "Category must be less than 50 characters").nullable().optional(),
});

// Community ID param schema
export const communityIdParamSchema = z.object({
  communityId: z.string().min(1, "Community ID is required"),
});

const milestoneSchema = z.object({
  id: z.string().optional(), // Present when updating existing milestones
  name: z
    .string()
    .min(1, "Milestone name is required")
    .max(100, "Milestone name must be less than 100 characters"),
  description: z
    .string()
    .max(500, "Description must be less than 500 characters")
    .optional(),
  triggerType: z.enum(["DAY", "PERCENTAGE"]),
  triggerValue: z
    .number()
    .int("Trigger value must be an integer")
    .min(1, "Trigger value must be at least 1")
    .max(365, "Trigger value cannot exceed 365"),
  points: z
    .number()
    .int("Points must be an integer")
    .min(0, "Points cannot be negative"),
  order: z
    .number()
    .int("Order must be an integer")
    .min(0, "Order cannot be negative")
    .optional(),
});

// Goal template creation schema (aligned with goal creation)
export const createTemplateSchema = z.object({
  goalText: z
    .string()
    .min(1, "Goal text is required")
    .max(500, "Goal text must be less than 500 characters"),
  targetDays: z
    .number()
    .int("Target days must be an integer")
    .min(1, "Target days must be at least 1")
    .max(365, "Target days cannot exceed 365"),
  reminderTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Reminder time must be in HH:MM format (24-hour)")
    .optional(),
  milestones: z.array(milestoneSchema).optional(),
});

// Goal template update schema (aligned with goal update)
export const updateTemplateSchema = z.object({
  goalText: z
    .string()
    .min(1, "Goal text is required")
    .max(500, "Goal text must be less than 500 characters")
    .optional(),
  targetDays: z
    .number()
    .int("Target days must be an integer")
    .min(1, "Target days must be at least 1")
    .max(365, "Target days cannot exceed 365")
    .optional(),
  reminderTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Reminder time must be in HH:MM format (24-hour)")
    .nullable()
    .optional(),
  milestones: z.array(milestoneSchema).optional(),
});

// Template ID param schema
export const templateIdParamSchema = z.object({
  templateId: z.string().min(1, "Template ID is required"),
});

// Start goal from template schema
export const startGoalFromTemplateSchema = z.object({
  reminderTime: z
    .string()
    .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Reminder time must be in HH:MM format (24-hour)")
    .optional(),
});

// Join community schema
export const joinCommunitySchema = z.object({
  communityId: z.string().min(1, "Community ID is required"),
});

// Update member role schema
export const updateMemberRoleSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  role: z.enum(["OWNER", "MOD", "MEMBER"], {
    errorMap: () => ({ message: "Role must be OWNER, MOD, or MEMBER" }),
  }),
});

// Activity comment schema
export const createCommentSchema = z.object({
  text: z
    .string()
    .min(1, "Comment text is required")
    .max(1000, "Comment must be less than 1000 characters"),
});

// Activity ID param schema
export const activityIdParamSchema = z.object({
  activityId: z.string().min(1, "Activity ID is required"),
});

// Comment ID param schema
export const commentIdParamSchema = z.object({
  commentId: z.string().min(1, "Comment ID is required"),
});

// ==================== Invite schemas ====================

// Create invite schema
export const createInviteSchema = z.object({
  inviteeUsername: z.string().trim().min(1).max(20).optional(),
  inviteeEmail: z.string().trim().email("Must be a valid email").optional(),
  maxUses: z.number().int().min(-1).default(-1).optional(), // -1 = unlimited
  expiresInDays: z.number().int().min(1).max(30).optional(), // optional expiry
}).refine((data) => !(data.inviteeUsername && data.inviteeEmail), {
  message: "Invite by username or email, not both",
});

// Invite code param schema
export const inviteCodeParamSchema = z.object({
  code: z.string().min(1, "Invite code is required"),
});

// Join by code schema
export const joinByCodeSchema = z.object({
  code: z.string().min(1, "Invite code is required"),
});
