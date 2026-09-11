import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  blockUserParamsSchema,
  blockUserSchema,
  moderationEvidenceSchema,
} from "../validators/moderation.validators";
import * as moderationController from "../controllers/moderation.controller";

const router = Router();
router.post(
  "/reports",
  authMiddleware,
  validate(moderationEvidenceSchema),
  moderationController.reportContent,
);
router.post(
  "/blocks/:userId",
  authMiddleware,
  validate(blockUserParamsSchema, "params"),
  validate(blockUserSchema),
  moderationController.blockUser,
);
router.delete(
  "/blocks/:userId",
  authMiddleware,
  validate(blockUserParamsSchema, "params"),
  moderationController.unblockUser,
);

export default router;
