import { z } from "zod";

export const subtaskParamsSchema = z
  .object({
    goalId: z.string().trim().min(1).max(128),
    subtaskId: z.string().uuid(),
  })
  .strict();

export const createSubtaskSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
  })
  .strict();

export const updateSubtaskSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(500).optional(),
    completed: z.boolean().optional(),
    deleted: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.completed !== undefined ||
      value.deleted !== undefined,
    { message: "Choose a subtask change" },
  );

export type CreateSubtaskInput = Required<z.infer<typeof createSubtaskSchema>>;
export type UpdateSubtaskInput = Omit<
  z.infer<typeof updateSubtaskSchema>,
  "revision"
> & { revision: number };
