import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  checkInSchema,
  createGoalSchema,
  resetGoalSchema,
} from "../validators/goal.validators";
import * as goalController from "../controllers/goal.controller";

const router: Router = Router();

// GET /api/v1/goals - Get all user's goals
router.get("/", authMiddleware, goalController.getAllGoals);

// GET /api/v1/goals/current - Get user's current active goal
router.get("/current", authMiddleware, goalController.getCurrentGoal);

// GET /api/v1/goals/:goalId - Get a specific goal
router.get("/:goalId", authMiddleware, goalController.getGoalById);

// POST /api/v1/goals - Create/start a goal
router.post("/", authMiddleware, validate(createGoalSchema), goalController.createGoal);

// POST /api/v1/goals/check-in - Mark "I showed up today"
router.post("/check-in", authMiddleware, validate(checkInSchema), goalController.checkIn);

// POST /api/v1/goals/reset - Reset to Day 0
router.post("/reset", authMiddleware, validate(resetGoalSchema), goalController.resetGoal);

// DELETE /api/v1/goals/:goalId - Delete a goal
router.delete("/:goalId", authMiddleware, goalController.deleteGoal);

export default router;
