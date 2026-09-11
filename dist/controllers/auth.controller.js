"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatUserResponse = formatUserResponse;
exports.login = login;
exports.register = register;
exports.googleAuth = googleAuth;
exports.appleAuth = appleAuth;
exports.getSession = getSession;
exports.refreshToken = refreshToken;
exports.logout = logout;
exports.requestPasswordReset = requestPasswordReset;
exports.verifyRecoveryCode = verifyRecoveryCode;
exports.recoverAccount = recoverAccount;
exports.requestConfirmation = requestConfirmation;
exports.accountConfirmation = accountConfirmation;
exports.checkEmail = checkEmail;
exports.changePassword = changePassword;
exports.getSuggestions = getSuggestions;
exports.completeOnboarding = completeOnboarding;
const legal_constants_1 = require("../constants/legal.constants");
const db_config_1 = require("../config/db.config");
const email_service_1 = require("../services/email.service");
const rewind_partner_switch_service_1 = require("../services/rewind-partner-switch.service");
const user_mood_service_1 = require("../services/user-mood.service");
const auth_util_1 = require("../utils/auth.util");
const cloudinary_util_1 = require("../utils/cloudinary.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const username_util_1 = require("../utils/username.util");
// Helper function to format user response
function formatUserResponse(user) {
    const partnerSwitch = (0, rewind_partner_switch_service_1.getRewindPartnerSwitchAvailability)(user.rewindPersonaChangedAt, user.timezone);
    return {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        username: user.username || undefined,
        avatarUrl: user.avatarUrl || undefined,
        currentMood: user.currentMood || undefined,
        rewindPersona: user.rewindPersona || undefined,
        rewindPersonaCanChange: partnerSwitch.canChange,
        rewindPersonaNextChangeAt: partnerSwitch.nextAvailableAt?.toISOString() || undefined,
        rewindPersonalizationEnabled: user.rewindPersonalizationEnabled ?? true,
        rewindProactiveChatEnabled: user.rewindProactiveChatEnabled ?? true,
        rewindProactiveChatExplainedAt: user.rewindProactiveChatExplainedAt?.toISOString() || undefined,
        timezone: user.timezone || "UTC",
        isConfirmed: user.isConfirmed,
        isFirstTime: user.isFirstTime,
        lastUsernameChangeAt: user.lastUsernameChangeAt?.toISOString() || undefined,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
    };
}
async function login(req, res) {
    try {
        const { email, password } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (!user || !user.password || user.suspendedAt) {
            return res.status(401).json({ msg: "Invalid credentials" });
        }
        const isPasswordValid = await (0, auth_util_1.comparePassword)(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ msg: "Invalid credentials" });
        }
        await user_mood_service_1.userMoodService.refreshCurrentMoodIfNeeded(user.id);
        const refreshedUser = await db_config_1.prisma.user.findUnique({
            where: { id: user.id },
        });
        if (!refreshedUser) {
            return res.status(404).json({ msg: "User not found" });
        }
        const token = (0, auth_util_1.generateAccessToken)(refreshedUser.id);
        const refreshToken = (0, auth_util_1.generateRefreshToken)(refreshedUser.id);
        // Update refresh token
        await db_config_1.prisma.user.update({
            where: { id: refreshedUser.id },
            data: {
                refreshToken,
                termsAcceptedAt: new Date(),
                termsVersion: legal_constants_1.CURRENT_TERMS_VERSION,
            },
        });
        res.json({
            msg: "Login successful",
            data: {
                token,
                refreshToken,
                user: formatUserResponse(refreshedUser),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Login error:", { error, email: req.body.email });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function register(req, res) {
    try {
        const { email, password, firstName, lastName } = req.body;
        // Check if user already exists
        const existingUser = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ msg: "User already exists" });
        }
        const hashedPassword = await (0, auth_util_1.hashPassword)(password);
        // Generate unique username from first name or email
        const baseName = firstName || email.split("@")[0];
        const username = await (0, username_util_1.generateUniqueUsername)(baseName);
        const user = await db_config_1.prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                firstName,
                lastName,
                username,
                lastUsernameChangeAt: new Date(), // Set initial change date
                isConfirmed: false,
                isFirstTime: true,
                termsAcceptedAt: new Date(),
                termsVersion: legal_constants_1.CURRENT_TERMS_VERSION,
            },
        });
        // Generate tokens
        const token = (0, auth_util_1.generateAccessToken)(user.id);
        const refreshToken = (0, auth_util_1.generateRefreshToken)(user.id);
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: { refreshToken },
        });
        res.json({
            msg: "Registration successful. Please confirm your email.",
            data: {
                user: formatUserResponse(user),
                confirmationRequired: true,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Register error:", { error, email: req.body.email });
        if (error.code === "P2002") {
            return res.status(400).json({ msg: "User already exists" });
        }
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function googleAuth(req, res) {
    try {
        const { token } = req.body;
        // Verify Google token
        const googleUser = await (0, auth_util_1.verifyGoogleToken)(token, req.clientApp);
        if (!googleUser) {
            return res.status(401).json({ msg: "Invalid Google token" });
        }
        // Check if user exists
        let user = await db_config_1.prisma.user.findUnique({
            where: { email: googleUser.email },
        });
        if (user?.suspendedAt) {
            return res.status(403).json({
                code: "ACCOUNT_SUSPENDED",
                msg: "This account has been suspended for violating our community standards.",
            });
        }
        if (!user) {
            // Create new user
            const nameParts = googleUser.name?.split(" ") || [];
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";
            // Generate unique username
            const baseName = firstName || googleUser.email.split("@")[0] || "user";
            const username = await (0, username_util_1.generateUniqueUsername)(baseName);
            // Upload Google avatar to Cloudinary (async, non-blocking)
            let cloudinaryAvatarUrl = undefined;
            if (googleUser.picture) {
                try {
                    const uploadedUrl = await (0, cloudinary_util_1.uploadImageFromUrl)(googleUser.picture, googleUser.sub, // Use Google ID as temp ID
                    "google-avatars");
                    cloudinaryAvatarUrl = uploadedUrl || undefined;
                }
                catch (error) {
                    logger_util_1.default.warn("Failed to upload Google avatar to Cloudinary, using Google URL", {
                        email: googleUser.email,
                        error,
                    });
                    cloudinaryAvatarUrl = googleUser.picture || undefined;
                }
            }
            user = await db_config_1.prisma.user.create({
                data: {
                    email: googleUser.email,
                    firstName,
                    lastName,
                    username,
                    googleId: googleUser.sub,
                    avatarUrl: cloudinaryAvatarUrl,
                    isConfirmed: true, // Google users are pre-verified
                    isFirstTime: true,
                    lastUsernameChangeAt: new Date(), // Set initial change date
                },
            });
        }
        else {
            // Update existing user
            if (!user.googleId) {
                const nameParts = googleUser.name?.split(" ") || [];
                const firstName = nameParts[0] || "";
                const lastName = nameParts.slice(1).join(" ") || "";
                // Upload avatar to Cloudinary if available
                let cloudinaryAvatarUrl = user.avatarUrl || undefined;
                if (googleUser.picture && !user.avatarUrl) {
                    try {
                        const uploadedUrl = await (0, cloudinary_util_1.uploadImageFromUrl)(googleUser.picture, user.id, "google-avatars");
                        cloudinaryAvatarUrl =
                            uploadedUrl || googleUser.picture || undefined;
                    }
                    catch (error) {
                        logger_util_1.default.warn("Failed to upload Google avatar to Cloudinary", {
                            userId: user.id,
                            error,
                        });
                        cloudinaryAvatarUrl =
                            googleUser.picture || user.avatarUrl || undefined;
                    }
                }
                user = await db_config_1.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        googleId: googleUser.sub,
                        firstName: user.firstName || firstName || undefined,
                        lastName: user.lastName || lastName || undefined,
                        avatarUrl: cloudinaryAvatarUrl,
                    },
                });
            }
            else {
                // Update avatar if available and not already set
                if (googleUser.picture && !user.avatarUrl) {
                    try {
                        const uploadedUrl = await (0, cloudinary_util_1.uploadImageFromUrl)(googleUser.picture, user.id, "google-avatars");
                        const cloudinaryAvatarUrl = uploadedUrl || googleUser.picture;
                        user = await db_config_1.prisma.user.update({
                            where: { id: user.id },
                            data: {
                                avatarUrl: cloudinaryAvatarUrl,
                            },
                        });
                    }
                    catch (error) {
                        logger_util_1.default.warn("Failed to upload Google avatar to Cloudinary", {
                            userId: user.id,
                            error,
                        });
                        // Use Google URL as fallback
                        user = await db_config_1.prisma.user.update({
                            where: { id: user.id },
                            data: {
                                avatarUrl: googleUser.picture,
                            },
                        });
                    }
                }
            }
        }
        // Generate tokens
        await user_mood_service_1.userMoodService.refreshCurrentMoodIfNeeded(user.id);
        const refreshedUser = await db_config_1.prisma.user.findUnique({
            where: { id: user.id },
        });
        if (!refreshedUser) {
            return res.status(404).json({ msg: "User not found" });
        }
        const accessToken = (0, auth_util_1.generateAccessToken)(refreshedUser.id);
        const refreshToken = (0, auth_util_1.generateRefreshToken)(refreshedUser.id);
        await db_config_1.prisma.user.update({
            where: { id: refreshedUser.id },
            data: {
                refreshToken,
                termsAcceptedAt: new Date(),
                termsVersion: legal_constants_1.CURRENT_TERMS_VERSION,
            },
        });
        res.json({
            msg: "Google login successful",
            data: {
                token: accessToken,
                refreshToken,
                user: formatUserResponse(refreshedUser),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Google auth error:", { error });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function appleAuth(req, res) {
    try {
        const { familyName, firstName, token } = req.body;
        const appleUser = await (0, auth_util_1.verifyAppleToken)(token, req.clientApp);
        if (!appleUser) {
            return res.status(401).json({ msg: "Invalid Apple identity token" });
        }
        let user = await db_config_1.prisma.user.findUnique({
            where: { appleId: appleUser.sub },
        });
        // Apple may only return the email on the first authorization. Once the
        // stable subject is linked, subsequent logins do not need the email.
        if (!user && appleUser.email) {
            user = await db_config_1.prisma.user.findUnique({
                where: { email: appleUser.email },
            });
        }
        if (user?.suspendedAt) {
            return res.status(403).json({
                code: "ACCOUNT_SUSPENDED",
                msg: "This account has been suspended for violating our community standards.",
            });
        }
        if (!user && !appleUser.email) {
            return res.status(400).json({
                msg: "Apple did not provide an email address. Please try Apple sign-in again and allow email sharing.",
            });
        }
        if (!user) {
            const safeFirstName = firstName?.trim() || "";
            const safeLastName = familyName?.trim() || "";
            const email = appleUser.email;
            const baseName = safeFirstName || email.split("@")[0];
            const username = await (0, username_util_1.generateUniqueUsername)(baseName);
            user = await db_config_1.prisma.user.create({
                data: {
                    appleId: appleUser.sub,
                    email,
                    firstName: safeFirstName || undefined,
                    isConfirmed: true,
                    isFirstTime: true,
                    lastName: safeLastName || undefined,
                    lastUsernameChangeAt: new Date(),
                    username,
                },
            });
        }
        else if (user.appleId && user.appleId !== appleUser.sub) {
            // Never silently merge two different Apple identities solely because
            // their relay/email value happens to match.
            return res.status(409).json({
                msg: "This email is already linked to another Apple account.",
            });
        }
        else {
            user = await db_config_1.prisma.user.update({
                where: { id: user.id },
                data: {
                    appleId: appleUser.sub,
                    firstName: user.firstName || firstName?.trim() || undefined,
                    lastName: user.lastName || familyName?.trim() || undefined,
                },
            });
        }
        await user_mood_service_1.userMoodService.refreshCurrentMoodIfNeeded(user.id);
        const refreshedUser = await db_config_1.prisma.user.findUnique({
            where: { id: user.id },
        });
        if (!refreshedUser) {
            return res.status(404).json({ msg: "User not found" });
        }
        const accessToken = (0, auth_util_1.generateAccessToken)(refreshedUser.id);
        const refreshToken = (0, auth_util_1.generateRefreshToken)(refreshedUser.id);
        await db_config_1.prisma.user.update({
            where: { id: refreshedUser.id },
            data: {
                refreshToken,
                termsAcceptedAt: new Date(),
                termsVersion: legal_constants_1.CURRENT_TERMS_VERSION,
            },
        });
        return res.json({
            msg: "Apple login successful",
            data: {
                token: accessToken,
                refreshToken,
                user: formatUserResponse(refreshedUser),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Apple auth error:", { error });
        return res.status(500).json({ msg: "Internal server error" });
    }
}
async function getSession(req, res) {
    try {
        const userId = req.userId;
        await user_mood_service_1.userMoodService.refreshCurrentMoodIfNeeded(userId);
        const user = await db_config_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        res.json({
            msg: "Session retrieved",
            data: {
                isFirstTime: user.isFirstTime,
                user: formatUserResponse(user),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Session error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function refreshToken(req, res) {
    try {
        const { refreshToken } = req.body;
        const decoded = (0, auth_util_1.verifyRefreshToken)(refreshToken);
        if (!decoded) {
            return res.status(401).json({ msg: "Invalid refresh token" });
        }
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: decoded.userId },
        });
        if (!user || user.refreshToken !== refreshToken || user.suspendedAt) {
            return res.status(401).json({ msg: "Invalid refresh token" });
        }
        // Generate new tokens
        const newToken = (0, auth_util_1.generateAccessToken)(user.id);
        const newRefreshToken = (0, auth_util_1.generateRefreshToken)(user.id);
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: { refreshToken: newRefreshToken },
        });
        res.json({
            msg: "Token refreshed",
            data: {
                token: newToken,
                refreshToken: newRefreshToken,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Refresh token error:", { error });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function logout(req, res) {
    try {
        const userId = req.userId;
        // Clear refresh token
        await db_config_1.prisma.user.update({
            where: { id: userId },
            data: { refreshToken: null },
        });
        res.json({ msg: "Logout successful" });
    }
    catch (error) {
        logger_util_1.default.error("Logout error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function requestPasswordReset(req, res) {
    try {
        const { email } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        // Generate OTP
        const otpCode = (0, auth_util_1.generateOTP)();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: {
                otpCode,
                otpExpiresAt,
            },
        });
        // Send OTP via email
        await email_service_1.emailService.sendPasswordResetEmail({
            to: user.email,
            name: user.firstName || user.email,
            code: otpCode,
        });
        res.json({
            msg: "OTP sent to email",
            data: {
                user: {
                    requestedConfirmation: true,
                },
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Request validation error:", { error, email: req.body.email });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function verifyRecoveryCode(req, res) {
    try {
        const { email, otp } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (!user || !user.otpCode || user.otpCode !== otp.toString()) {
            return res.status(401).json({ msg: "Invalid OTP" });
        }
        if ((0, auth_util_1.isOTPExpired)(user.otpExpiresAt)) {
            return res.status(401).json({ msg: "OTP has expired" });
        }
        res.json({
            msg: "OTP verified",
            data: {
                isValid: true,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Verify recovery code error:", {
            error,
            email: req.body.email,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function recoverAccount(req, res) {
    try {
        const { email, otp, newPassword } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (!user || !user.otpCode || user.otpCode !== otp.toString()) {
            return res.status(400).json({ msg: "Invalid OTP" });
        }
        if ((0, auth_util_1.isOTPExpired)(user.otpExpiresAt)) {
            return res.status(400).json({ msg: "OTP has expired" });
        }
        const hashedPassword = await (0, auth_util_1.hashPassword)(newPassword);
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                otpCode: null,
                otpExpiresAt: null,
            },
        });
        res.json({
            msg: "Password reset successful",
            data: {
                user: {
                    isRecovered: true,
                },
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Recover account error:", { error, email: req.body.email });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function requestConfirmation(req, res) {
    try {
        const { email } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(404).json({ msg: "User not found" });
        }
        // Generate OTP
        const otpCode = (0, auth_util_1.generateOTP)();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: {
                otpCode,
                otpExpiresAt,
            },
        });
        // Send confirmation OTP via email
        await email_service_1.emailService.sendConfirmationEmail({
            to: user.email,
            name: user.firstName || user.email,
            code: otpCode,
        });
        res.json({
            msg: "Confirmation OTP sent",
            data: {
                user: {
                    requestedConfirmation: true,
                },
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Request confirmation error:", {
            error,
            email: req.body.email,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function accountConfirmation(req, res) {
    try {
        const { email, otp } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { email } });
        if (!user || !user.otpCode || user.otpCode !== otp.toString()) {
            return res.status(401).json({ msg: "Invalid OTP" });
        }
        if ((0, auth_util_1.isOTPExpired)(user.otpExpiresAt)) {
            return res.status(401).json({ msg: "OTP has expired" });
        }
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: {
                isConfirmed: true,
                otpCode: null,
                otpExpiresAt: null,
            },
        });
        res.json({
            msg: "Account confirmed successfully",
            data: {
                user: formatUserResponse(user),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Account confirmation error:", {
            error,
            email: req.body.email,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function checkEmail(req, res) {
    try {
        const { email } = req.params;
        const user = await db_config_1.prisma.user.findUnique({
            where: { email: String(email) },
        });
        res.json({
            msg: "Email check completed",
            data: {
                available: !user,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Email check error:", { error, email: req.params.email });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function changePassword(req, res) {
    try {
        const userId = req.userId;
        const { currentPassword, newPassword } = req.body;
        const user = await db_config_1.prisma.user.findUnique({ where: { id: userId } });
        if (!user || !user.password) {
            return res.status(404).json({ msg: "User not found or no password set" });
        }
        const isPasswordValid = await (0, auth_util_1.comparePassword)(currentPassword, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ msg: "Current password is incorrect" });
        }
        const hashedPassword = await (0, auth_util_1.hashPassword)(newPassword);
        await db_config_1.prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword },
        });
        res.json({ msg: "Password changed successfully" });
    }
    catch (error) {
        logger_util_1.default.error("Change password error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getSuggestions(req, res) {
    try {
        // TODO: Implement AI suggestions based on user answers
        // For now, return empty suggestions (removed task/journal references for simple lock-in app)
        res.json({
            msg: "Suggestions generated",
            data: {
                suggestedGoals: [],
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Suggestions error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function completeOnboarding(req, res) {
    try {
        const userId = req.userId;
        const { username } = req.body;
        const updateData = {
            isFirstTime: false,
        };
        if (username !== undefined)
            updateData.username = username;
        const user = await db_config_1.prisma.user.update({
            where: { id: userId },
            data: updateData,
        });
        res.json({
            msg: "Onboarding completed",
            data: {
                user: formatUserResponse(user),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Onboarding error:", { error, userId: req.userId });
        if (error.code === "P2002") {
            return res.status(400).json({ msg: "Username already taken" });
        }
        res.status(500).json({ msg: "Internal server error" });
    }
}
