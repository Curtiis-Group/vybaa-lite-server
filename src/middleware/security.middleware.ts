import type { NextFunction, Request, Response } from "express";
import { securityConfig } from "../utils/security-config.util";

type RateEntry = { count: number; resetAt: number };
const requests = new Map<string, RateEntry>();

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.removeHeader("X-Powered-By");
  next();
}

export function apiRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const current = requests.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + securityConfig.httpRateWindowMs }
    : { ...current, count: current.count + 1 };
  requests.set(key, entry);

  res.setHeader("RateLimit-Limit", securityConfig.httpRateLimit);
  res.setHeader("RateLimit-Remaining", Math.max(0, securityConfig.httpRateLimit - entry.count));
  res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
  if (entry.count > securityConfig.httpRateLimit) {
    res.status(429).json({ msg: "Too many requests" });
    return;
  }
  next();
}
