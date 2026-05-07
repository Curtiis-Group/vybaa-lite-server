"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkUsernameExists = checkUsernameExists;
exports.checkUsernameChangeAvailability = checkUsernameChangeAvailability;
const db_config_1 = require("../config/db.config");
const username_util_1 = require("../utils/username.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Check if a username is available (not taken by another user)
 */
async function checkUsernameExists(req, res) {
    try {
        const { username } = req.query;
        if (!username || typeof username !== 'string') {
            return res.status(400).json({ msg: "Username parameter required" });
        }
        // Sanitize and force lowercase
        const sanitized = (0, username_util_1.sanitizeUsername)(username);
        // Validate format
        const validation = (0, username_util_1.validateUsername)(sanitized);
        if (!validation.valid) {
            return res.json({
                msg: "Username validation",
                data: {
                    available: false,
                    reason: validation.error,
                    exists: false,
                },
            });
        }
        // Check if username exists
        const existingUser = await db_config_1.prisma.user.findUnique({
            where: { username: sanitized },
            select: { id: true },
        });
        res.json({
            msg: "Username availability checked",
            data: {
                available: !existingUser,
                exists: !!existingUser,
                username: sanitized,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Check username exists error:", { error, username: req.query.username });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Check if authenticated user can change their username
 */
async function checkUsernameChangeAvailability(req, res) {
    try {
        const userId = req.userId;
        const { username } = req.query;
        // If checking availability of a specific username, allow unauthenticated usage
        if (username && typeof username === 'string') {
            // Sanitize and force lowercase
            const sanitized = (0, username_util_1.sanitizeUsername)(username);
            // If authed, prevent selecting current username
            if (userId) {
                const user = await db_config_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { username: true },
                });
                if (user && sanitized === user.username) {
                    return res.json({
                        msg: "This is your current username",
                        data: {
                            available: false,
                            reason: "This is already your username",
                            isCurrentUsername: true,
                        },
                    });
                }
            }
            // Validate format
            const validation = (0, username_util_1.validateUsername)(sanitized);
            if (!validation.valid) {
                return res.json({
                    msg: "Username validation",
                    data: {
                        available: false,
                        reason: validation.error,
                    },
                });
            }
            // Check if taken
            const existingUser = await db_config_1.prisma.user.findUnique({
                where: { username: sanitized },
                select: { id: true },
            });
            return res.json({
                msg: "Username availability checked",
                data: {
                    available: !existingUser,
                    exists: !!existingUser,
                    username: sanitized,
                },
            });
        }
        // Cooldown status requires authentication
        if (!userId) {
            return res.status(401).json({ msg: "Authentication required" });
        }
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, lastUsernameChangeAt: true },
        });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        // If checking availability of a specific username
        if (username && typeof username === 'string') {
            // Sanitize and force lowercase
            const sanitized = (0, username_util_1.sanitizeUsername)(username);
            // Check if it's their current username
            if (sanitized === user.username) {
                return res.json({
                    msg: "This is your current username",
                    data: {
                        available: false,
                        reason: "This is already your username",
                        isCurrentUsername: true,
                    },
                });
            }
            // Validate format
            const validation = (0, username_util_1.validateUsername)(sanitized);
            if (!validation.valid) {
                return res.json({
                    msg: "Username validation",
                    data: {
                        available: false,
                        reason: validation.error,
                    },
                });
            }
            // Check if taken
            const existingUser = await db_config_1.prisma.user.findUnique({
                where: { username: sanitized },
                select: { id: true },
            });
            return res.json({
                msg: "Username availability checked",
                data: {
                    available: !existingUser,
                    exists: !!existingUser,
                    username: sanitized,
                },
            });
        }
        // Just return cooldown status
        res.json({
            msg: "Username change availability",
            data: {
                currentUsername: user.username,
                lastChangeDate: user.lastUsernameChangeAt?.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Check username change availability error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
