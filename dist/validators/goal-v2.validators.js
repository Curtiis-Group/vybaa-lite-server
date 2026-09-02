"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listGoalOccurrencesQuerySchema = exports.listGoalsV2QuerySchema = exports.conclusionReviewSchema = exports.resumeGoalSchema = exports.rescheduleOccurrenceSchema = exports.recordGoalProgressSchema = exports.occurrenceIdParamSchema = exports.goalV2IdParamSchema = exports.updateGoalV2Schema = exports.createGoalV2Schema = exports.goalMissPolicySchema = exports.goalScheduleSchema = exports.goalTargetSchema = void 0;
const zod_1 = require("zod");
const dateSchema = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");
const reminderTimeSchema = zod_1.z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Reminder must use HH:MM");
const attachmentsSchema = zod_1.z
    .array(zod_1.z.object({
    name: zod_1.z.string().max(200).optional(),
    publicId: zod_1.z.string().max(300).optional(),
    type: zod_1.z.enum(["audio", "image"]),
    url: zod_1.z.string().url(),
}))
    .max(5);
exports.goalTargetSchema = zod_1.z.discriminatedUnion("type", [
    zod_1.z.object({
        count: zod_1.z.number().int().min(1).max(365),
        type: zod_1.z.literal("CHECK_IN_COUNT"),
    }),
    zod_1.z.object({
        amount: zod_1.z.number().positive().finite(),
        type: zod_1.z.literal("QUANTITY"),
        unit: zod_1.z.string().trim().min(1).max(30),
    }),
    zod_1.z.object({
        endDate: dateSchema,
        type: zod_1.z.literal("UNTIL_DATE"),
    }),
]);
exports.goalScheduleSchema = zod_1.z.discriminatedUnion("type", [
    zod_1.z.object({
        date: dateSchema,
        type: zod_1.z.literal("ONE_TIME"),
    }),
    zod_1.z.object({
        endDate: dateSchema.optional(),
        startDate: dateSchema,
        type: zod_1.z.literal("DAILY"),
    }),
    zod_1.z.object({
        endDate: dateSchema.optional(),
        startDate: dateSchema,
        type: zod_1.z.literal("WEEKLY"),
        weekday: zod_1.z.number().int().min(1).max(7),
    }),
    zod_1.z.object({
        endDate: dateSchema.optional(),
        startDate: dateSchema,
        type: zod_1.z.literal("SELECTED_WEEKDAYS"),
        weekdays: zod_1.z.array(zod_1.z.number().int().min(1).max(7)).min(1).max(7),
    }),
]);
exports.goalMissPolicySchema = zod_1.z.object({
    breakStreakOnMiss: zod_1.z.boolean().optional(),
    forfeitPendingOnMiss: zod_1.z.boolean().optional(),
    graceHours: zod_1.z.number().int().min(0).max(48).optional(),
    maxConsecutiveMisses: zod_1.z.number().int().min(1).max(365).nullable().optional(),
    mode: zod_1.z.enum(["FLEXIBLE", "NO_STREAK", "STRICT"]),
});
exports.createGoalV2Schema = zod_1.z.object({
    communityId: zod_1.z.string().min(1).optional(),
    description: zod_1.z.string().trim().max(2000).optional(),
    hardStopDate: dateSchema.optional(),
    missPolicy: exports.goalMissPolicySchema.default({ mode: "STRICT" }),
    reminderTimes: zod_1.z
        .array(reminderTimeSchema)
        .max(3)
        .refine((times) => new Set(times).size === times.length, {
        message: "Reminder times must be unique",
    })
        .default([]),
    rewardReleasePolicy: zod_1.z
        .enum(["IMMEDIATE", "ON_COMPLETION"])
        .default("ON_COMPLETION"),
    sourceRecommendationId: zod_1.z.string().min(1).max(128).optional(),
    schedule: exports.goalScheduleSchema,
    target: exports.goalTargetSchema,
    templateId: zod_1.z.string().min(1).optional(),
    title: zod_1.z.string().trim().min(1).max(500),
});
exports.updateGoalV2Schema = zod_1.z
    .object({
    description: zod_1.z.string().trim().max(2000).nullable().optional(),
    missPolicy: exports.goalMissPolicySchema.optional(),
    reminderTimes: zod_1.z
        .array(reminderTimeSchema)
        .max(3)
        .refine((times) => new Set(times).size === times.length, {
        message: "Reminder times must be unique",
    })
        .optional(),
    title: zod_1.z.string().trim().min(1).max(500).optional(),
})
    .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
});
exports.goalV2IdParamSchema = zod_1.z.object({
    goalId: zod_1.z.string().min(1).max(128),
});
exports.occurrenceIdParamSchema = exports.goalV2IdParamSchema.extend({
    occurrenceId: zod_1.z.string().min(1).max(128),
});
exports.recordGoalProgressSchema = zod_1.z.object({
    amount: zod_1.z.number().positive().finite().optional(),
    attachments: attachmentsSchema.optional(),
    notes: zod_1.z.string().trim().max(2000).optional(),
});
exports.rescheduleOccurrenceSchema = zod_1.z.object({
    dueDate: dateSchema,
});
exports.resumeGoalSchema = zod_1.z.object({
    deadlinePolicy: zod_1.z.enum(["KEEP_DEADLINE", "SHIFT_DEADLINE"]),
});
exports.conclusionReviewSchema = zod_1.z.object({
    attachments: attachmentsSchema.optional(),
    nextStep: zod_1.z.string().trim().max(2000).nullable().optional(),
    rating: zod_1.z.number().int().min(1).max(5).nullable().optional(),
    reflection: zod_1.z.string().trim().max(5000).nullable().optional(),
});
exports.listGoalsV2QuerySchema = zod_1.z.object({
    cursor: zod_1.z.string().max(512).optional(),
    filter: zod_1.z
        .enum([
        "ACTIVE",
        "ARCHIVED",
        "DUE",
        "ENDED",
        "OVERDUE",
        "PAUSED",
    ])
        .default("ACTIVE"),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(20),
});
exports.listGoalOccurrencesQuerySchema = zod_1.z.object({
    cursor: zod_1.z.string().max(512).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(20),
});
