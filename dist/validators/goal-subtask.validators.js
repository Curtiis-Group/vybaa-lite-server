"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSubtaskSchema = exports.createSubtaskSchema = exports.subtaskParamsSchema = void 0;
const zod_1 = require("zod");
exports.subtaskParamsSchema = zod_1.z
    .object({
    goalId: zod_1.z.string().trim().min(1).max(128),
    subtaskId: zod_1.z.string().uuid(),
})
    .strict();
exports.createSubtaskSchema = zod_1.z
    .object({
    id: zod_1.z.string().uuid(),
    title: zod_1.z.string().trim().min(1).max(500),
})
    .strict();
exports.updateSubtaskSchema = zod_1.z
    .object({
    revision: zod_1.z.number().int().nonnegative(),
    title: zod_1.z.string().trim().min(1).max(500).optional(),
    completed: zod_1.z.boolean().optional(),
    deleted: zod_1.z.boolean().optional(),
})
    .strict()
    .refine((value) => value.title !== undefined ||
    value.completed !== undefined ||
    value.deleted !== undefined, { message: "Choose a subtask change" });
