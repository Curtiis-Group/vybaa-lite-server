import type { NextFunction, Response } from "express";
import type { AuthRequest } from "./auth.middleware";

/**
 * Simple admin auth using a shared secret phrase.
 *
 * - Reads ADMIN_SECRET from env
 * - Accepts the secret in either:
 *   - x-admin-secret header, or
 *   - ?admin_secret= query param
 */
export function adminAuthMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    return res.status(500).json({ msg: "Admin secret not configured" });
  }

  const provided =
    (req.headers["x-admin-secret"] as string | undefined) ||
    (req.query.admin_secret as string | undefined);

  if (!provided || provided !== secret) {
    return res.status(401).json({ msg: "Invalid admin secret" });
  }

  return next();
}

