import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as insightsController from "../controllers/insights.controller";

const router: Router = Router();

// GET /api/v1/insights - Get user's insights and analytics
router.get("/", authMiddleware, insightsController.getInsights);

export default router;
