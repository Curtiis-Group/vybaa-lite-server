import { z } from "zod";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");
const reminderTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Reminder must use HH:MM");
const attachmentsSchema = z
  .array(
    z.object({
      name: z.string().max(200).optional(),
      publicId: z.string().max(300).optional(),
      type: z.enum(["audio", "image"]),
      url: z.string().url(),
    }),
  )
  .max(5);

export const goalTargetSchema = z.discriminatedUnion("type", [
  z.object({
    count: z.number().int().min(1).max(365),
    type: z.literal("CHECK_IN_COUNT"),
  }),
  z.object({
    amount: z.number().positive().finite(),
    type: z.literal("QUANTITY"),
    unit: z.string().trim().min(1).max(30),
  }),
  z.object({
    endDate: dateSchema,
    type: z.literal("UNTIL_DATE"),
  }),
]);

export const goalScheduleSchema = z.discriminatedUnion("type", [
  z.object({
    date: dateSchema,
    type: z.literal("ONE_TIME"),
  }),
  z.object({
    endDate: dateSchema.optional(),
    startDate: dateSchema,
    type: z.literal("DAILY"),
  }),
  z.object({
    endDate: dateSchema.optional(),
    startDate: dateSchema,
    type: z.literal("WEEKLY"),
    weekday: z.number().int().min(1).max(7),
  }),
  z.object({
    endDate: dateSchema.optional(),
    startDate: dateSchema,
    type: z.literal("SELECTED_WEEKDAYS"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  }),
]);

export const goalMissPolicySchema = z.object({
  breakStreakOnMiss: z.boolean().optional(),
  forfeitPendingOnMiss: z.boolean().optional(),
  graceHours: z.number().int().min(0).max(48).optional(),
  maxConsecutiveMisses: z.number().int().min(1).max(365).nullable().optional(),
  mode: z.enum(["FLEXIBLE", "NO_STREAK", "STRICT"]),
});

export const createGoalV2Schema = z.object({
  communityId: z.string().min(1).optional(),
  description: z.string().trim().max(2_000).optional(),
  hardStopDate: dateSchema.optional(),
  missPolicy: goalMissPolicySchema.default({ mode: "STRICT" }),
  reminderTimes: z
    .array(reminderTimeSchema)
    .max(3)
    .refine((times) => new Set(times).size === times.length, {
      message: "Reminder times must be unique",
    })
    .default([]),
  rewardReleasePolicy: z
    .enum(["IMMEDIATE", "ON_COMPLETION"])
    .default("ON_COMPLETION"),
  sourceRecommendationId: z.string().min(1).max(128).optional(),
  schedule: goalScheduleSchema,
  target: goalTargetSchema,
  templateId: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(500),
});

const quickGoalSetupAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(1_000),
    question: z.string().trim().min(3).max(240),
  })
  .strict();

export const quickGoalSetupResponseSchema = z.object({
  description: z.string().trim().max(2_000).optional(),
  reminderTimes: z
    .array(reminderTimeSchema)
    .max(3)
    .refine((times) => new Set(times).size === times.length, {
      message: "Reminder times must be unique",
    })
    .default([]),
  schedule: goalScheduleSchema,
  target: goalTargetSchema,
  title: z.string().trim().min(1).max(500),
});

export const quickGoalSetupSchema = z
  .object({
    answers: z.array(quickGoalSetupAnswerSchema).min(1).max(2).optional(),
    edit: z
      .object({
        draft: quickGoalSetupResponseSchema,
        instruction: z.string().trim().min(3).max(1_000),
      })
      .strict()
      .optional(),
    prompt: z.string().trim().min(3).max(1_000),
  })
  .strict();

const quickGoalSetupQuestionSchema = z
  .object({
    question: z.string().trim().min(3).max(240),
  })
  .strict();

export const quickGoalSetupDecisionSchema = z.union([
  z
    .object({
      kind: z.literal("DRAFT"),
      draft: quickGoalSetupResponseSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("QUESTIONS"),
      questions: z.array(quickGoalSetupQuestionSchema).min(1).max(2),
    })
    .strict(),
]);

export const updateGoalV2Schema = z
  .object({
    description: z.string().trim().max(2_000).nullable().optional(),
    missPolicy: goalMissPolicySchema.optional(),
    reminderTimes: z
      .array(reminderTimeSchema)
      .max(3)
      .refine((times) => new Set(times).size === times.length, {
        message: "Reminder times must be unique",
      })
      .optional(),
    title: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const goalV2IdParamSchema = z.object({
  goalId: z.string().min(1).max(128),
});

export const occurrenceIdParamSchema = goalV2IdParamSchema.extend({
  occurrenceId: z.string().min(1).max(128),
});

export const recordGoalProgressSchema = z.object({
  amount: z.number().positive().finite().optional(),
  attachments: attachmentsSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
});

export const rescheduleOccurrenceSchema = z.object({
  dueDate: dateSchema,
});

export const resumeGoalSchema = z.object({
  deadlinePolicy: z.enum(["KEEP_DEADLINE", "SHIFT_DEADLINE"]),
});

export const conclusionReviewSchema = z.object({
  attachments: attachmentsSchema.optional(),
  nextStep: z.string().trim().max(2_000).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  reflection: z.string().trim().max(5_000).nullable().optional(),
});

export const listGoalsV2QuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  filter: z
    .enum(["ACTIVE", "ARCHIVED", "DUE", "ENDED", "OVERDUE", "PAUSED"])
    .default("ACTIVE"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const listGoalOccurrencesQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateGoalV2Input = z.infer<typeof createGoalV2Schema>;
export type QuickGoalSetupInput = z.infer<typeof quickGoalSetupSchema>;
export type QuickGoalSetupDraft = z.infer<typeof quickGoalSetupResponseSchema>;
export type QuickGoalSetupResponse = z.infer<
  typeof quickGoalSetupDecisionSchema
>;
export type GoalMissPolicyInput = z.infer<typeof goalMissPolicySchema>;
export type GoalScheduleInput = z.infer<typeof goalScheduleSchema>;
export type GoalTargetInput = z.infer<typeof goalTargetSchema>;
