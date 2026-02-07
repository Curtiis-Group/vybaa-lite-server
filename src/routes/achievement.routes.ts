import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as achievementController from "../controllers/achievement.controller";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all user achievements
router.get("/", achievementController.getAchievements);

// Get achievement stats
router.get("/stats", achievementController.getAchievementStats);

// Get all badge definitions
router.get("/definitions", achievementController.getBadgeDefinitions);

export default router;
