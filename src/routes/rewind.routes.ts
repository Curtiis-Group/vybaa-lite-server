import { Router } from "express";
import * as rewindIntelligenceController from "../controllers/rewind-intelligence.controller";
import * as rewindController from "../controllers/rewind.controller";
import * as rewindRoutineController from "../controllers/rewind-routine.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  listRewindRecordsSchema,
  recordRewindActivitySchema,
  rewindChatIdSchema,
  rewindObservationIdSchema,
  sendRewindChatMessageSchema,
  updateRewindChatSchema,
} from "../validators/rewind.validators";

const router = Router();

router.get(
  "/routine",
  authMiddleware,
  rewindRoutineController.getRewindRoutine,
);
router.put(
  "/routine",
  authMiddleware,
  rewindRoutineController.updateRewindRoutine,
);
router.get(
  "/home-greeting",
  authMiddleware,
  rewindIntelligenceController.getHomeGreeting,
);
router.get(
  "/observations",
  authMiddleware,
  validate(listRewindRecordsSchema, "query"),
  rewindIntelligenceController.listObservations,
);
router.get(
  "/observations/:observationId",
  authMiddleware,
  validate(rewindObservationIdSchema, "params"),
  rewindIntelligenceController.getObservation,
);
router.delete(
  "/observations/:observationId",
  authMiddleware,
  validate(rewindObservationIdSchema, "params"),
  rewindIntelligenceController.dismissObservation,
);
router.get("/chats", authMiddleware, rewindIntelligenceController.listChats);
router.get(
  "/chats/:chatId/messages",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(listRewindRecordsSchema, "query"),
  rewindIntelligenceController.listChatMessages,
);
router.post(
  "/chats/:chatId/messages",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(sendRewindChatMessageSchema),
  rewindIntelligenceController.sendChatMessage,
);
router.patch(
  "/chats/:chatId",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(updateRewindChatSchema),
  rewindIntelligenceController.updateChat,
);
router.post(
  "/activity",
  authMiddleware,
  validate(recordRewindActivitySchema),
  rewindIntelligenceController.recordActivity,
);
router.get(
  "/sessions",
  authMiddleware,
  rewindController.getPaginatedRewindSessions,
);
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
router.get(
  "/sessions/:sessionId",
  authMiddleware,
  rewindController.getRewindSession,
);
router.post("/live-token", authMiddleware, rewindController.createLiveToken);

export default router;
