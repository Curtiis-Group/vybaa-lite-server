import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as goalController from "../controllers/legacy-goal.controller";

const router: Router = Router();

// GET /api/v1/goals - Get all user's goals
router.get("/", authMiddleware, goalController.listLegacyGoals);

// GET /api/v1/goals/current - Get user's current active goal
router.get("/current", authMiddleware, goalController.getCurrentLegacyGoal);

// GET /api/v1/goals/:goalId - Get a specific goal
router.get("/:goalId", authMiddleware, goalController.getLegacyGoal);

function requireGoalV2(_req: unknown, res: import("express").Response): void {
  res.status(426).json({
    code: "GOAL_V2_REQUIRED",
    msg: "Goal changes now require the standardized v2 goal experience",
  });
}

router.post("/", authMiddleware, requireGoalV2);
router.put("/:goalId", authMiddleware, requireGoalV2);
router.post("/check-in", authMiddleware, requireGoalV2);
router.post("/reset", authMiddleware, requireGoalV2);
router.post("/bulk-delete", authMiddleware, requireGoalV2);
router.delete("/:goalId", authMiddleware, requireGoalV2);

export default router;
