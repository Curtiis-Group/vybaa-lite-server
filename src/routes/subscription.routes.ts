import { Router } from "express";

import {
  getSubscriptionConfig,
  getSubscriptionStatus,
} from "../controllers/subscription.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/config", getSubscriptionConfig);
router.get("/status", authMiddleware, getSubscriptionStatus);

export default router;
