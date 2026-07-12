import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as rewindController from "../controllers/rewind.controller";

const router = Router();

router.get("/sessions", authMiddleware, rewindController.getPaginatedRewindSessions);
router.get("/sessions/:sessionId", authMiddleware, rewindController.getRewindSession);
router.post("/live-token", authMiddleware, rewindController.createLiveToken);

export default router;
