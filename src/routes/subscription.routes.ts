import { Router } from "express";

import {
  getSubscriptionConfig,
  getSubscriptionStatus,
  syncSubscriptionStatus,
} from "../controllers/subscription.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/config", getSubscriptionConfig);
router.get("/status", authMiddleware, getSubscriptionStatus);
router.post("/sync", authMiddleware, syncSubscriptionStatus);

export default router;
