import { Router } from "express";

import { createRealtimeToken } from "../controllers/realtime.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

router.post("/token", authMiddleware, createRealtimeToken);

export default router;
