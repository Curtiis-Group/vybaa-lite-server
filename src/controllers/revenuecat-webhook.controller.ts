import type { Request, Response } from "express";

import {
  isRevenueCatWebhookConfigured,
  parseRevenueCatWebhook,
  processRevenueCatWebhookEvent,
  registerRevenueCatWebhook,
  verifyRevenueCatWebhookSignature,
} from "../services/revenuecat-webhook.service";
import logger from "../utils/logger.util";

export async function handleRevenueCatWebhook(
  req: Request,
  res: Response,
): Promise<Response> {
  if (!isRevenueCatWebhookConfigured(req.clientApp)) {
    return res.status(503).json({ msg: "RevenueCat webhook is not configured" });
  }

  const signature = req.header("x-revenuecat-webhook-signature");
  if (!signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ msg: "Invalid webhook request" });
  }

  if (
    !verifyRevenueCatWebhookSignature({
      clientApp: req.clientApp,
      rawBody: req.body,
      signature,
    })
  ) {
    return res.status(401).json({ msg: "Invalid webhook signature" });
  }

  const rawPayload = req.body.toString("utf8");
  const envelope = parseRevenueCatWebhook(rawPayload);
  if (!envelope) {
    return res.status(400).json({ msg: "Invalid webhook payload" });
  }

  try {
    const registration = await registerRevenueCatWebhook({
      clientApp: req.clientApp,
      envelope,
      rawPayload,
    });

    setImmediate(() => {
      void processRevenueCatWebhookEvent(registration.eventId).catch(
        (error: unknown) => {
          logger.error("RevenueCat webhook dispatch failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            eventId: registration.eventId,
          });
        },
      );
    });

    return res.status(200).json({
      duplicate: registration.duplicate,
      msg: "Webhook accepted",
    });
  } catch (error: unknown) {
    logger.error("RevenueCat webhook registration failed", {
      clientApp: req.clientApp,
      errorName: error instanceof Error ? error.name : "UnknownError",
      eventId: envelope.event.id,
    });
    return res.status(500).json({ msg: "Webhook could not be recorded" });
  }
}
