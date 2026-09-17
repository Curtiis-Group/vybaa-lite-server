import type { NextFunction, Request, Response } from "express";
import { securityConfig } from "../utils/security-config.util";

type RateEntry = { count: number; resetAt: number };
const requests = new Map<string, RateEntry>();
const revenueCatWebhookRequests = new Map<string, RateEntry>();
const REVENUECAT_WEBHOOK_RATE_LIMIT = 600;
const REVENUECAT_WEBHOOK_RATE_WINDOW_MS = 60_000;
const PROBE_PATHS = new Set([
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.git/config",
  "/.git/HEAD",
  "/.git/index",
  "/wp-admin",
  "/wp-login.php",
  "/phpmyadmin",
]);

export function rejectCommonProbes(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (PROBE_PATHS.has(req.path) || req.path.startsWith("/.git/")) {
    res.status(404).end();
    return;
  }
  next();
}

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
  if (
    req.path === "/api/v1/webhooks/revenuecat" ||
    req.path === "/mycove/v1/webhooks/revenuecat"
  ) {
    next();
    return;
  }

  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const current = requests.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + securityConfig.httpRateWindowMs }
    : { ...current, count: current.count + 1 };
  requests.set(key, entry);

  // Keep this fallback limiter bounded when the service is exposed directly.
  if (requests.size > 10_000) {
    for (const [entryKey, entryValue] of requests) {
      if (entryValue.resetAt <= now) requests.delete(entryKey);
    }
  }

  res.setHeader("RateLimit-Limit", securityConfig.httpRateLimit);
  res.setHeader("RateLimit-Remaining", Math.max(0, securityConfig.httpRateLimit - entry.count));
  res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
  if (entry.count > securityConfig.httpRateLimit) {
    res.status(429).json({ msg: "Too many requests" });
    return;
  }
  next();
}

export function revenueCatWebhookRateLimit(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const now = Date.now();
  const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const current = revenueCatWebhookRequests.get(key);
  const entry =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + REVENUECAT_WEBHOOK_RATE_WINDOW_MS }
      : { ...current, count: current.count + 1 };
  revenueCatWebhookRequests.set(key, entry);

  if (entry.count > REVENUECAT_WEBHOOK_RATE_LIMIT) {
    res.status(429).json({ msg: "Too many webhook requests" });
    return;
  }
  next();
}
