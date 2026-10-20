import { Router } from "express";
import { ZodError } from "zod";
import type { Response } from "express";

import type { AuthRequest } from "../middleware/auth.middleware";
import {
  createSubtask,
  listSubtasks,
  SubtaskError,
  updateSubtask,
} from "../services/goal-subtask.service";
import logger from "../utils/logger.util";
import {
  createSubtaskSchema,
  subtaskParamsSchema,
  updateSubtaskSchema,
} from "../validators/goal-subtask.validators";

const router = Router({ mergeParams: true });
const parentParams = subtaskParamsSchema.pick({ goalId: true });

function handleError(error: unknown, res: Response): void {
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ msg: error.issues[0]?.message ?? "Invalid subtask" });
    return;
  }
  if (error instanceof SubtaskError) {
    res.status(error.status).json({ msg: error.message });
    return;
  }
  logger.error("Subtask request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  res.status(500).json({ msg: "Could not save subtasks. Please try again." });
}

router.get("/", async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    res.status(401).json({ msg: "Sign in required" });
    return;
  }
  try {
    const { goalId } = parentParams.parse(req.params);
    res.json({ data: await listSubtasks(req.userId, goalId) });
  } catch (error: unknown) {
    handleError(error, res);
  }
});
router.post("/", async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    res.status(401).json({ msg: "Sign in required" });
    return;
  }
  try {
    const { goalId } = parentParams.parse(req.params);
    const parsed = createSubtaskSchema.parse(req.body);
    if (!parsed.id || !parsed.title)
      throw new SubtaskError(400, "A title and request ID are required");
    const input = { id: parsed.id, title: parsed.title };
    res
      .status(201)
      .json({ data: await createSubtask(req.userId, goalId, input) });
  } catch (error: unknown) {
    handleError(error, res);
  }
});
router.patch("/:subtaskId", async (req: AuthRequest, res: Response) => {
  if (!req.userId) {
    res.status(401).json({ msg: "Sign in required" });
    return;
  }
  try {
    const { goalId, subtaskId } = subtaskParamsSchema.parse(req.params);
    const parsed = updateSubtaskSchema.parse(req.body);
    if (parsed.revision === undefined)
      throw new SubtaskError(400, "A subtask revision is required");
    const input = { ...parsed, revision: parsed.revision };
    res.json({
      data: await updateSubtask(req.userId, goalId, subtaskId, input),
    });
  } catch (error: unknown) {
    handleError(error, res);
  }
});
export default router;
