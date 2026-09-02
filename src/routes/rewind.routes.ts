import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as rewindController from "../controllers/rewind.controller";
import * as rewindRoutineController from "../controllers/rewind-routine.controller";

const router = Router();

router.get("/routine", authMiddleware, rewindRoutineController.getRewindRoutine);
router.put("/routine", authMiddleware, rewindRoutineController.updateRewindRoutine);
router.get("/sessions", authMiddleware, rewindController.getPaginatedRewindSessions);
router.get("/insights", authMiddleware, rewindController.getRewindInsights);
router.post(
  "/sessions/:sessionId/add-to-journal",
  authMiddleware,
  rewindController.addRewindSessionToJournal,
);
router.post(
  "/sessions/:sessionId/recommendations/:recommendationId/accept",
  authMiddleware,
  rewindController.acceptRecommendation,
);
router.post(
  "/sessions/:sessionId/recommendations/:recommendationId/dismiss",
  authMiddleware,
  rewindController.dismissRecommendation,
);
router.get("/sessions/:sessionId", authMiddleware, rewindController.getRewindSession);
router.post("/live-token", authMiddleware, rewindController.createLiveToken);

export default router;
