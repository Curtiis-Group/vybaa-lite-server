"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityConfig = void 0;
exports.getJwtSecret = getJwtSecret;
exports.validateSecurityEnvironment = validateSecurityEnvironment;
function getPositiveInteger(name, fallback) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer`);
    }
    return value;
}
function getRequiredSecret(name) {
    const value = process.env[name]?.trim();
    if (!value || value === "your-secret-key-change-in-production") {
        throw new Error(`${name} must be configured with a secure value`);
    }
    return value;
}
function getAllowedOrigins() {
    const allowedOriginsFromEnv = (process.env.CORS_ALLOWED_ORIGINS ?? "http://localhost:5173")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
    return [
        ...allowedOriginsFromEnv,
        "capacitor://localhost",
        "http://127.0.0.1:3005",
        "http://127.0.0.1:3001",
        "http://localhost",
        "http://localhost:3005",
        "http://localhost:3001",
        "ionic://localhost"
    ];
}
exports.securityConfig = {
    allowedOrigins: getAllowedOrigins(),
    apiBodyLimit: process.env.API_BODY_LIMIT ?? "256kb",
    uploadBodyLimit: process.env.UPLOAD_BODY_LIMIT ?? "10mb",
    httpRateLimit: getPositiveInteger("HTTP_RATE_LIMIT", 300),
    httpRateWindowMs: getPositiveInteger("HTTP_RATE_WINDOW_MS", 60000),
    rewindMaxConnectionsPerUser: getPositiveInteger("REWIND_MAX_CONNECTIONS_PER_USER", 3),
    rewindMaxMessageBytes: getPositiveInteger("REWIND_MAX_MESSAGE_BYTES", 65536),
    rewindMessageRateLimit: getPositiveInteger("REWIND_MESSAGE_RATE_LIMIT", 100),
    rewindMessageRateWindowMs: getPositiveInteger("REWIND_MESSAGE_RATE_WINDOW_MS", 10000),
};
function getJwtSecret() {
    return getRequiredSecret("JWT_SECRET");
}
function validateSecurityEnvironment() {
    getJwtSecret();
    getRequiredSecret("JWT_REFRESH_SECRET");
}
