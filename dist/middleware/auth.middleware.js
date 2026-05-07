"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.optionalAuthMiddleware = optionalAuthMiddleware;
const auth_util_1 = require("../utils/auth.util");
function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ msg: "No token provided" });
        }
        const token = authHeader.substring(7); // Remove "Bearer " prefix
        const decoded = (0, auth_util_1.verifyAccessToken)(token);
        if (!decoded) {
            return res.status(401).json({ msg: "Invalid or expired token" });
        }
        req.userId = decoded.userId;
        next();
    }
    catch (error) {
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
function optionalAuthMiddleware(req, _res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return next();
        }
        const token = authHeader.substring(7);
        const decoded = (0, auth_util_1.verifyAccessToken)(token);
        if (decoded) {
            req.userId = decoded.userId;
        }
        return next();
    }
    catch (_error) {
        return next();
    }
}
