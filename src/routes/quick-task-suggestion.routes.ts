import { Router } from "express";
import type { Response } from "express";

import type { AuthRequest } from "../middleware/auth.middleware";
import { listQuickTaskSuggestions } from "../services/quick-task-suggestion.service";
import logger from "../utils/logger.util";

const router = Router();

router.get("/", async (req: AuthRequest, res: Response): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.userId) {
    res.status(401).json({ msg: "Sign in required" });
    return;
  }
  try {
    res.json({ data: await listQuickTaskSuggestions(req.userId) });
  } catch (error: unknown) {
    logger.error("Quick task suggestions unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    res
      .status(503)
      .json({ msg: "Suggestions are unavailable. You can still add a task." });
  }
});

export default router;
