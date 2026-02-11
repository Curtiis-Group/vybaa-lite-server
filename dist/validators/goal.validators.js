"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalIdParamSchema = exports.updateGoalSchema = exports.resetGoalSchema = exports.checkInSchema = exports.createGoalSchema = void 0;
const zod_1 = require("zod");
// Goal creation schema
exports.createGoalSchema = zod_1.z.object({
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
});
// Check-in schema (goalId optional for backward compatibility)
exports.checkInSchema = zod_1.z.object({
    goalId: zod_1.z.string().min(1, "Goal ID is required").optional(),
});
// Reset schema (goalId optional for backward compatibility)
exports.resetGoalSchema = zod_1.z.object({
    goalId: zod_1.z.string().min(1, "Goal ID is required").optional(),
});
// Goal update schema
exports.updateGoalSchema = zod_1.z.object({
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
});
// Goal ID param schema
exports.goalIdParamSchema = zod_1.z.object({
    goalId: zod_1.z.string().min(1, "Goal ID is required"),
});
