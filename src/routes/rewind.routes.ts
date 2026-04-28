import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as rewindController from "../controllers/rewind.controller";

const router = Router();

router.post("/live-token", authMiddleware, rewindController.createLiveToken);

export default router;
