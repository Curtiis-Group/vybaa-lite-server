import { Router } from "express";
import * as webhookController from "../controllers/webhook.controller";

const router: Router = Router();

// For Polar and other JSON webhooks (no special raw body needs)
router.post("/polar", webhookController.handlePolarWebhook);

export default router;


