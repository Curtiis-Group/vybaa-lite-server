import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as chillController from "../controllers/chill.controller";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Create chill session and get AI suggestions
router.post("/sessions", chillController.createChillSession);

// Update session duration
router.patch("/sessions/:sessionId/duration", chillController.updateSessionDuration);

// Complete chill session
router.patch("/sessions/:sessionId/complete", chillController.completeChillSession);

// Get user's chill sessions
router.get("/sessions", chillController.getChillSessions);

// Get chill stats
router.get("/stats", chillController.getChillStats);

export default router;
