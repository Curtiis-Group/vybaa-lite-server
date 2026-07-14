import type { Response } from "express";

import type { AuthRequest } from "../middleware/auth.middleware";
import {
  getRevenueCatConfig,
  getRevenueCatSubscriptionStatus,
} from "../services/revenuecat.service";

export async function getSubscriptionConfig(
  _req: AuthRequest,
  res: Response,
): Promise<void> {
  res.status(200).json({
    msg: "Subscription config retrieved",
    data: getRevenueCatConfig(),
  });
}

export async function getSubscriptionStatus(
  req: AuthRequest,
  res: Response,
): Promise<Response | void> {
  if (!req.userId) {
    return res.status(401).json({ msg: "Authentication required" });
  }

  const status = await getRevenueCatSubscriptionStatus(req.userId);

  res.status(200).json({
    msg: "Subscription status retrieved",
    data: status,
  });
}
