import { Router } from "express";

import * as controller from "../controllers/rewind-chat-v2.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { requireRewindChatProAccess } from "../middleware/subscription-access.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  listRewindRecordsSchema,
  rewindChatIdSchema,
  rewindChatMessageIdSchema,
  rewindV2ChatPreferencesSchema,
  rewindV2ChatTitleSchema,
  rewindV2ReactionSchema,
  rewindV2ReadChatSchema,
  sendRewindChatMessageSchema,
} from "../validators/rewind.validators";

const router = Router();

router.use(authMiddleware, requireRewindChatProAccess);

router.get(
  "/chats/:chatId/preferences",
  validate(rewindChatIdSchema, "params"),
  controller.getPreferences,
);

router.get("/usage", controller.getUsage);
router.get("/chats", controller.listChats);
router.get(
  "/chats/:chatId/messages",
  validate(rewindChatIdSchema, "params"),
  validate(listRewindRecordsSchema, "query"),
  controller.listMessages,
);
router.get(
  "/chats/:chatId/live-state",
  validate(rewindChatIdSchema, "params"),
  controller.getLiveState,
);
router.post(
  "/chats/:chatId/messages",
  validate(rewindChatIdSchema, "params"),
  validate(sendRewindChatMessageSchema),
  controller.enqueueMessage,
);
router.delete(
  "/chats/:chatId/messages/:messageId",
  validate(rewindChatMessageIdSchema, "params"),
  controller.deleteMessage,
);
router.delete(
  "/chats/:chatId/messages",
  validate(rewindChatIdSchema, "params"),
  controller.clearChat,
);
router.put(
  "/chats/:chatId/messages/:messageId/reaction",
  validate(rewindChatMessageIdSchema, "params"),
  validate(rewindV2ReactionSchema),
  controller.updateReaction,
);
router.post(
  "/chats/:chatId/read",
  validate(rewindChatIdSchema, "params"),
  validate(rewindV2ReadChatSchema),
  controller.markRead,
);
router.patch(
  "/chats/:chatId/preferences",
  validate(rewindChatIdSchema, "params"),
  validate(rewindV2ChatPreferencesSchema),
  controller.updatePreferences,
);
router.patch(
  "/chats/:chatId",
  validate(rewindChatIdSchema, "params"),
  validate(rewindV2ChatTitleSchema),
  controller.renameChat,
);

export default router;
