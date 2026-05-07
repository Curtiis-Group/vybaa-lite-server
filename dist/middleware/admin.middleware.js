"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthMiddleware = adminAuthMiddleware;
/**
 * Simple admin auth using a shared secret phrase.
 *
 * - Reads ADMIN_SECRET from env
 * - Accepts the secret in either:
 *   - x-admin-secret header, or
 *   - ?admin_secret= query param
 */
function adminAuthMiddleware(req, res, next) {
    const secret = process.env.ADMIN_SECRET;
    if (!secret) {
        return res.status(500).json({ msg: "Admin secret not configured" });
    }
    const provided = req.headers["x-admin-secret"] ||
        req.query.admin_secret;
    if (!provided || provided !== secret) {
        return res.status(401).json({ msg: "Invalid admin secret" });
    }
    return next();
}
