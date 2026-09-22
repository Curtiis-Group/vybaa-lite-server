import type { NextFunction, Response } from "express";

import {
  assertCanUseRewindChats,
  handleSubscriptionAccessError,
} from "../services/subscription-access.service";
import type { AuthRequest } from "./auth.middleware";

export async function requireRewindChatProAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await assertCanUseRewindChats(req.userId!, req.clientApp);
    next();
  } catch (error: unknown) {
    if (handleSubscriptionAccessError(error, res)) return;
    next(error);
  }
}
