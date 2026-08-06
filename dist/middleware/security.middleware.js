"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityHeaders = securityHeaders;
exports.apiRateLimit = apiRateLimit;
exports.revenueCatWebhookRateLimit = revenueCatWebhookRateLimit;
const security_config_util_1 = require("../utils/security-config.util");
const requests = new Map();
const revenueCatWebhookRequests = new Map();
const REVENUECAT_WEBHOOK_RATE_LIMIT = 600;
const REVENUECAT_WEBHOOK_RATE_WINDOW_MS = 60000;
function securityHeaders(_req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.removeHeader("X-Powered-By");
    next();
}
function apiRateLimit(req, res, next) {
    if (req.path === "/api/v1/webhooks/revenuecat" ||
        req.path === "/mycove/v1/webhooks/revenuecat") {
        next();
        return;
    }
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const current = requests.get(key);
    const entry = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + security_config_util_1.securityConfig.httpRateWindowMs }
        : { ...current, count: current.count + 1 };
    requests.set(key, entry);
    res.setHeader("RateLimit-Limit", security_config_util_1.securityConfig.httpRateLimit);
    res.setHeader("RateLimit-Remaining", Math.max(0, security_config_util_1.securityConfig.httpRateLimit - entry.count));
    res.setHeader("RateLimit-Reset", Math.ceil(entry.resetAt / 1000));
    if (entry.count > security_config_util_1.securityConfig.httpRateLimit) {
        res.status(429).json({ msg: "Too many requests" });
        return;
    }
    next();
}
function revenueCatWebhookRateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const current = revenueCatWebhookRequests.get(key);
    const entry = !current || current.resetAt <= now
        ? { count: 1, resetAt: now + REVENUECAT_WEBHOOK_RATE_WINDOW_MS }
        : { ...current, count: current.count + 1 };
    revenueCatWebhookRequests.set(key, entry);
    if (entry.count > REVENUECAT_WEBHOOK_RATE_LIMIT) {
        res.status(429).json({ msg: "Too many webhook requests" });
        return;
    }
    next();
}
