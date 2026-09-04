import { Router } from "express";

import * as controller from "../controllers/rewind-chat-v2.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  listRewindRecordsSchema,
  rewindChatIdSchema,
  rewindV2ChatPreferencesSchema,
  rewindV2ReadChatSchema,
  sendRewindChatMessageSchema,
} from "../validators/rewind.validators";

const router = Router();

router.get("/usage", authMiddleware, controller.getUsage);
router.get("/chats", authMiddleware, controller.listChats);
router.get(
  "/chats/:chatId/messages",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(listRewindRecordsSchema, "query"),
  controller.listMessages,
);
router.get(
  "/chats/:chatId/live-state",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  controller.getLiveState,
);
router.post(
  "/chats/:chatId/messages",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(sendRewindChatMessageSchema),
  controller.enqueueMessage,
);
router.post(
  "/chats/:chatId/read",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(rewindV2ReadChatSchema),
  controller.markRead,
);
router.patch(
  "/chats/:chatId/preferences",
  authMiddleware,
  validate(rewindChatIdSchema, "params"),
  validate(rewindV2ChatPreferencesSchema),
  controller.updatePreferences,
);

export default router;
