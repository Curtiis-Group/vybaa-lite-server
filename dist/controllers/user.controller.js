"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfile = updateProfile;
exports.getProfile = getProfile;
exports.deleteAccount = deleteAccount;
exports.getPublicProfile = getPublicProfile;
exports.registerFCMToken = registerFCMToken;
exports.removeFCMToken = removeFCMToken;
exports.checkUsernameAvailability = checkUsernameAvailability;
const db_config_1 = require("../config/db.config");
const client_app_type_1 = require("../types/client-app.type");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const username_util_1 = require("../utils/username.util");
const rewind_routine_service_1 = require("../services/rewind-routine.service");
const auth_controller_1 = require("./auth.controller");
async function updateProfile(req, res) {
    try {
        const userId = req.userId;
        const { firstName, lastName, username, profileImageId, rewindPersona, timezone, } = req.body;
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
                        },
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
        if (rewindPersona !== undefined)
            updateData.rewindPersona = rewindPersona;
        if (timezone !== undefined) {
            if (typeof timezone !== "string" || !(0, rewind_routine_service_1.isValidRewindTimezone)(timezone)) {
                return res
                    .status(400)
                    .json({ msg: "A valid IANA timezone is required" });
            }
            updateData.timezone = timezone;
        }
        const user = await db_config_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });
        if (timezone !== undefined || rewindPersona !== undefined) {
            await (0, rewind_routine_service_1.refreshFutureRewindOccurrences)({ userId });
        }
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
async function deleteAccount(req, res) {
    try {
        const userId = req.userId;
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        await db_config_1.prisma.$transaction(async (tx) => {
            await tx.transaction.deleteMany({
                where: {
                    OR: [{ senderId: userId }, { recipientId: userId }],
                },
            });
            await tx.goal.updateMany({
                where: {
                    template: { createdBy: userId },
                },
                data: { templateId: null },
            });
            await tx.goalTemplate.deleteMany({
                where: { createdBy: userId },
            });
            await tx.goal.deleteMany({
                where: { userId },
            });
            await tx.user.delete({
                where: { id: userId },
            });
        });
        logger_util_1.default.info("Account deleted", { userId });
        res.json({ msg: "Account deleted successfully" });
    }
    catch (error) {
        logger_util_1.default.error("Delete account error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getPublicProfile(req, res) {
    try {
        const rawUsername = Array.isArray(req.params.username)
            ? req.params.username[0]
            : req.params.username;
        const username = (0, username_util_1.sanitizeUsername)(rawUsername);
        if (!username) {
            return res.status(400).json({ msg: "Valid username is required" });
        }
        const user = await db_config_1.prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                firstName: true,
                lastName: true,
                avatarUrl: true,
                currentMood: true,
                createdAt: true,
                points: true,
                _count: {
                    select: {
                        achievements: true,
                        communityMemberships: true,
                        goals: true,
                        journals: true,
                    },
                },
            },
        });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        res.json({
            msg: "Public profile retrieved",
            data: {
                id: user.id,
                username: user.username,
                firstName: user.firstName,
                lastName: user.lastName,
                avatarUrl: user.avatarUrl,
                currentMood: user.currentMood,
                joinedAt: user.createdAt.toISOString(),
                playPoints: Math.round(user.points ?? 0),
                stats: {
                    achievementCount: user._count.achievements,
                    communityCount: user._count.communityMemberships,
                    goalCount: user._count.goals,
                    journalCount: user._count.journals,
                },
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get public profile error:", {
            error,
            username: req.params.username,
            viewerId: req.userId,
        });
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
        const clientApp = (0, client_app_type_1.toPrismaClientApp)(req.clientApp);
        await db_config_1.prisma.fcmDevice.upsert({
            where: { clientApp_token: { clientApp, token: fcmToken } },
            create: { clientApp, token: fcmToken, userId },
            update: { userId },
        });
        logger_util_1.default.info("FCM token registered", {
            clientApp: req.clientApp,
            userId,
        });
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
        const clientApp = (0, client_app_type_1.toPrismaClientApp)(req.clientApp);
        await db_config_1.prisma.fcmDevice.deleteMany({
            where: { clientApp, token: fcmToken, userId },
        });
        if (req.clientApp === "vybaa") {
            const user = await db_config_1.prisma.user.findUnique({
                where: { id: userId },
                select: { fcmTokens: true },
            });
            if (user) {
                await db_config_1.prisma.user.update({
                    where: { id: userId },
                    data: {
                        fcmTokens: user.fcmTokens.filter((token) => token !== fcmToken),
                    },
                });
            }
        }
        logger_util_1.default.info("FCM token removed", {
            clientApp: req.clientApp,
            userId,
        });
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
        // Allow unauthenticated usage (e.g. signup flow) by returning defaults
        if (!userId) {
            return res.json({
                msg: "Username change availability checked",
                data: {
                    canChange: true,
                    daysRemaining: 0,
                    nextAvailableDate: new Date().toISOString(),
                },
            });
        }
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
        logger_util_1.default.error("Check username availability error:", {
            error,
            userId: req.userId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
