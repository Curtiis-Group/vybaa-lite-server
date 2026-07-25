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
const security_config_util_1 = require("./security-config.util");
function getRefreshSecret() {
    const value = process.env.JWT_REFRESH_SECRET?.trim();
    if (!value || value === "your-refresh-secret-key-change-in-production") {
        throw new Error("JWT_REFRESH_SECRET must be configured with a secure value");
    }
    return value;
}
function getGoogleClientId(clientApp) {
    if (clientApp === "mycove") {
        return (process.env.MYCOVE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "");
    }
    return process.env.GOOGLE_CLIENT_ID || "";
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isGoogleIdToken(token) {
    return token.split(".").length === 3;
}
function getGoogleUserFromProfile(profile) {
    if (!isRecord(profile))
        return null;
    if (typeof profile.email !== "string" || typeof profile.id !== "string") {
        return null;
    }
    return {
        email: profile.email,
        name: typeof profile.name === "string" ? profile.name : "",
        picture: typeof profile.picture === "string" ? profile.picture : undefined,
        sub: profile.id,
    };
}
function generateAccessToken(userId) {
    return jsonwebtoken_1.default.sign({ userId }, (0, security_config_util_1.getJwtSecret)(), { expiresIn: "24h" });
}
function generateRefreshToken(userId) {
    return jsonwebtoken_1.default.sign({ userId }, getRefreshSecret(), { expiresIn: "7d" });
}
function verifyAccessToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, (0, security_config_util_1.getJwtSecret)());
        if (!isRecord(decoded) || typeof decoded.userId !== "string")
            return null;
        return { userId: decoded.userId };
    }
    catch {
        return null;
    }
}
function verifyRefreshToken(token) {
    try {
        const decoded = jsonwebtoken_1.default.verify(token, getRefreshSecret());
        if (!isRecord(decoded) || typeof decoded.userId !== "string")
            return null;
        return { userId: decoded.userId };
    }
    catch {
        return null;
    }
}
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 10);
}
async function comparePassword(password, hashedPassword) {
    return bcryptjs_1.default.compare(password, hashedPassword);
}
async function verifyGoogleToken(token, clientApp = "vybaa") {
    try {
        const clientId = getGoogleClientId(clientApp);
        if (!clientId) {
            throw new Error(`${clientApp === "mycove" ? "MYCOVE_" : ""}GOOGLE_CLIENT_ID is not configured`);
        }
        if (isGoogleIdToken(token)) {
            const ticket = await new google_auth_library_1.OAuth2Client(clientId).verifyIdToken({
                audience: clientId,
                idToken: token,
            });
            const payload = ticket.getPayload();
            if (!payload?.email || !payload.sub)
                return null;
            return {
                email: payload.email,
                name: payload.name || "",
                picture: payload.picture,
                sub: payload.sub,
            };
        }
        const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok)
            return null;
        return getGoogleUserFromProfile(await response.json());
    }
    catch (error) {
        logger_util_1.default.error("Google token verification error", {
            clientApp,
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        return null;
    }
}
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
function isOTPExpired(expiresAt) {
    return !expiresAt || new Date() > expiresAt;
}
