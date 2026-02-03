import { z } from "zod";

// Goal creation schema
export const createGoalSchema = z.object({
  goalText: z
    .string()
    .min(1, "Goal text is required")
    .max(500, "Goal text must be less than 500 characters"),
  targetDays: z
    .number()
    .int("Target days must be an integer")
    .min(1, "Target days must be at least 1")
    .max(365, "Target days cannot exceed 365"),
});

// Check-in schema (goalId optional for backward compatibility)
export const checkInSchema = z.object({
  goalId: z.string().min(1, "Goal ID is required").optional(),
});

// Reset schema (goalId optional for backward compatibility)
export const resetGoalSchema = z.object({
  goalId: z.string().min(1, "Goal ID is required").optional(),
});

// Goal ID param schema
export const goalIdParamSchema = z.object({
  goalId: z.string().min(1, "Goal ID is required"),
});
