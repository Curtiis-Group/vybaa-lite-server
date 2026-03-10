"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = updateProfile;
exports.getProfile = getProfile;
exports.registerFCMToken = registerFCMToken;
exports.removeFCMToken = removeFCMToken;
exports.checkUsernameAvailability = checkUsernameAvailability;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const username_util_1 = require("../utils/username.util");
const auth_controller_1 = require("./auth.controller");
async function updateProfile(req, res) {
    try {
        const userId = req.userId;
        const { firstName, lastName, username, profileImageId, currentMood, lifeGoal } = req.body;
        const updateData = {};
        // Handle username change with 7-day cooldown
        if (username !== undefined) {
            // Get current user to check last username change
            const currentUser = await db_config_1.prisma.user.findUnique({
                where: { id: userId },
                select: { username: true, lastUsernameChangeAt: true },
            });
            if (!currentUser) {
                return res.status(404).json({ msg: "User not found" });
            }
            // Check if username is actually changing
            if (username !== currentUser.username) {
                // Sanitize and force lowercase
                const sanitizedUsername = (0, username_util_1.sanitizeUsername)(username);
                // Validate username format
                const validation = (0, username_util_1.validateUsername)(sanitizedUsername);
                if (!validation.valid) {
                    return res.status(400).json({ msg: validation.error });
                }
                // Check 7-day cooldown
                const cooldownCheck = (0, username_util_1.canChangeUsername)(currentUser.lastUsernameChangeAt);
                if (!cooldownCheck.canChange) {
                    return res.status(400).json({
                        msg: `You can change your username again in ${cooldownCheck.daysRemaining} day(s)`,
                        data: {
                            canChange: false,
                            daysRemaining: cooldownCheck.daysRemaining,
                            nextAvailableDate: cooldownCheck.nextAvailableDate.toISOString(),
                        }
                    });
                }
                // Username is valid and cooldown passed
                updateData.username = sanitizedUsername;
                updateData.lastUsernameChangeAt = new Date();
            }
        }
        if (firstName !== undefined)
            updateData.firstName = firstName;
        if (lastName !== undefined)
            updateData.lastName = lastName;
        if (profileImageId !== undefined) {
            // If you have an image storage system, map profileImageId to avatarUrl
            // For now, we'll just store it as avatarUrl
            updateData.avatarUrl = profileImageId;
        }
        if (currentMood !== undefined)
            updateData.currentMood = currentMood;
        if (lifeGoal !== undefined)
            updateData.lifeGoal = lifeGoal;
        const user = await db_config_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });
        res.json({
            msg: "Profile updated successfully",
            data: (0, auth_controller_1.formatUserResponse)(user),
        });
    }
    catch (error) {
        logger_util_1.default.error("Update profile error:", { error, userId: req.userId });
        if (error.code === "P2002") {
            return res.status(400).json({ msg: "Username already taken" });
        }
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getProfile(req, res) {
    try {
        const userId = req.userId;
        const user = await db_config_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        res.json({
            msg: "User retrieved",
            data: (0, auth_controller_1.formatUserResponse)(user),
        });
    }
    catch (error) {
        logger_util_1.default.error("Get user error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Register or update FCM token for push notifications
 */
async function registerFCMToken(req, res) {
    try {
        const userId = req.userId;
        const { fcmToken } = req.body;
        if (!fcmToken || typeof fcmToken !== "string") {
            return res.status(400).json({ msg: "Valid FCM token is required" });
        }
        // Get current user
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { fcmTokens: true },
        });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        // Add token if it doesn't exist
        const tokens = user.fcmTokens || [];
        if (!tokens.includes(fcmToken)) {
            await db_config_1.prisma.user.update({
                where: { id: userId },
                data: {
                    fcmTokens: [...tokens, fcmToken],
                },
            });
            logger_util_1.default.info("FCM token registered", { userId, token: fcmToken.substring(0, 20) + "..." });
        }
        else {
            logger_util_1.default.debug("FCM token already registered", { userId });
        }
        res.json({
            msg: "FCM token registered successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Register FCM token error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Remove FCM token (e.g., on logout)
 */
async function removeFCMToken(req, res) {
    try {
        const userId = req.userId;
        const { fcmToken } = req.body;
        if (!fcmToken || typeof fcmToken !== "string") {
            return res.status(400).json({ msg: "Valid FCM token is required" });
        }
        // Get current user
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { fcmTokens: true },
        });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        // Remove token
        const tokens = user.fcmTokens || [];
        const updatedTokens = tokens.filter((t) => t !== fcmToken);
        await db_config_1.prisma.user.update({
            where: { id: userId },
            data: {
                fcmTokens: updatedTokens,
            },
        });
        logger_util_1.default.info("FCM token removed", { userId, token: fcmToken.substring(0, 20) + "..." });
        res.json({
            msg: "FCM token removed successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Remove FCM token error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Check if user can change username (7-day cooldown check)
 */
async function checkUsernameAvailability(req, res) {
    try {
        const userId = req.userId;
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { lastUsernameChangeAt: true, username: true },
        });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        const cooldownCheck = (0, username_util_1.canChangeUsername)(user.lastUsernameChangeAt);
        res.json({
            msg: "Username change availability checked",
            data: {
                canChange: cooldownCheck.canChange,
                daysRemaining: cooldownCheck.daysRemaining,
                nextAvailableDate: cooldownCheck.nextAvailableDate.toISOString(),
                currentUsername: user.username,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Check username availability error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
