"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAccessToken = generateAccessToken;
exports.generateRefreshToken = generateRefreshToken;
exports.verifyAccessToken = verifyAccessToken;
exports.verifyRefreshToken = verifyRefreshToken;
exports.hashPassword = hashPassword;
exports.comparePassword = comparePassword;
exports.verifyGoogleToken = verifyGoogleToken;
exports.generateOTP = generateOTP;
exports.isOTPExpired = isOTPExpired;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const google_auth_library_1 = require("google-auth-library");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const logger_util_1 = __importDefault(require("./logger.util"));
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "your-refresh-secret-key-change-in-production";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
// JWT Token Generation
function generateAccessToken(userId) {
    return jsonwebtoken_1.default.sign({ userId }, JWT_SECRET, { expiresIn: "15m" });
}
function generateRefreshToken(userId) {
    return jsonwebtoken_1.default.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: "7d" });
}
function verifyAccessToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        return decoded;
    }
    catch (error) {
        return null;
    }
}
function verifyRefreshToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_REFRESH_SECRET);
        return decoded;
    }
    catch (error) {
        return null;
    }
}
// Password Hashing
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 10);
}
async function comparePassword(password, hashedPassword) {
    return bcryptjs_1.default.compare(password, hashedPassword);
}
// Google OAuth Verification
async function verifyGoogleToken(token) {
    try {
        const client = new google_auth_library_1.OAuth2Client(GOOGLE_CLIENT_ID);
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        const payload = await response.json();
        if (!payload)
            return null;
        return {
            email: payload.email,
            name: payload.name || "",
            picture: payload.picture || "",
            sub: payload.sub,
        };
    }
    catch (error) {
        logger_util_1.default.error("Google token verification error:", { error });
        return null;
    }
}
// OTP Generation
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function isOTPExpired(expiresAt) {
    if (!expiresAt)
        return true;
    return new Date() > expiresAt;
}
