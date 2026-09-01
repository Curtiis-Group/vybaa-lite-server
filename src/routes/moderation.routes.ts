import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as moderationController from "../controllers/moderation.controller";

const router = Router();
router.post("/reports", authMiddleware, moderationController.reportContent);
router.post("/blocks/:userId", authMiddleware, moderationController.blockUser);
router.delete(
  "/blocks/:userId",
  authMiddleware,
  moderationController.unblockUser,
);

export default router;
