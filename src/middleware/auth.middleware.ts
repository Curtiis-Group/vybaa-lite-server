import type { NextFunction, Request, Response } from "express";
import { prisma } from "../config/db.config";
import { verifyAccessToken } from "../utils/auth.util";

export interface AuthRequest extends Request {
  userId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<Response | void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ msg: "No token provided" });
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ msg: "Invalid or expired token" });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { suspendedAt: true },
    });
    if (!user || user.suspendedAt) {
      return res.status(403).json({
        code: "ACCOUNT_SUSPENDED",
        msg: "This account is unavailable.",
      });
    }
    req.userId = decoded.userId;
    return next();
  } catch (error) {
    return res.status(401).json({ msg: "Authentication failed" });
  }
}

/**
 * Optional auth middleware:
 * - If a valid Bearer token is provided, sets req.userId
 * - If no token (or invalid token), continues without blocking
 *
 * Useful for endpoints that should behave differently for authenticated vs anonymous users.
 */
export function optionalAuthMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.substring(7);
    const decoded = verifyAccessToken(token);
    if (decoded) {
      req.userId = decoded.userId;
    }
    return next();
  } catch (_error) {
    return next();
  }
}
