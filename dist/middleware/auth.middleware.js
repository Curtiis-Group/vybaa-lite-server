"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
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
