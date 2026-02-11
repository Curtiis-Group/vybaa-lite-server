"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const chalk_1 = __importDefault(require("chalk"));
function requestLogger(req, res, next) {
    const start = Date.now();
    const methodColor = (method) => {
        switch (method) {
            case "GET":
                return chalk_1.default.green(method);
            case "POST":
                return chalk_1.default.blue(method);
            case "PUT":
                return chalk_1.default.yellow(method);
            case "PATCH":
                return chalk_1.default.magenta(method);
            case "DELETE":
                return chalk_1.default.red(method);
            default:
                return chalk_1.default.white(method);
        }
    };
    const statusColor = (code) => {
        if (code >= 500)
            return chalk_1.default.red(code);
        if (code >= 400)
            return chalk_1.default.yellow(code);
        if (code >= 300)
            return chalk_1.default.cyan(code);
        return chalk_1.default.green(code);
    };
    const prettyQuery = Object.keys(req.query).length > 0
        ? chalk_1.default.gray(` query=${JSON.stringify(req.query)}`)
        : "";
    const body = shouldLogBody(req.method, req.path) && req.body
        ? chalk_1.default.gray(` body=${JSON.stringify(sanitizeBody(req.body))}`)
        : "";
    console.log(`${chalk_1.default.dim("→")} ${methodColor(req.method)} ${chalk_1.default.white(req.originalUrl)}${prettyQuery}${body}`);
    const originalSend = res.send;
    res.send = function (data) {
        const duration = Date.now() - start;
        console.log(`${chalk_1.default.dim("←")} ${methodColor(req.method)} ${chalk_1.default.white(req.originalUrl)} ${statusColor(res.statusCode)} ${chalk_1.default.gray(`${duration}ms`)} ${chalk_1.default.dim(req.ip)}`);
        return originalSend.call(this, data);
    };
    next();
}
// Determine if request body should be logged
function shouldLogBody(method, path) {
    // Don't log sensitive endpoints
    const sensitivePaths = ["/auth/login", "/auth/register", "/auth/google"];
    if (sensitivePaths.some((p) => path.includes(p))) {
        return false;
    }
    // Only log body for POST, PUT, PATCH
    return ["POST", "PUT", "PATCH"].includes(method);
}
// Sanitize request body to remove sensitive information
function sanitizeBody(body) {
    if (!body || typeof body !== "object") {
        return body;
    }
    const sensitiveFields = ["password", "currentPassword", "newPassword", "token", "refreshToken", "otp", "otpCode"];
    const sanitized = { ...body };
    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = "[REDACTED]";
        }
    }
    // Remove base64 image data from logs
    if (sanitized.image && typeof sanitized.image === 'string' && sanitized.image.startsWith('data:image/')) {
        sanitized.image = '[base64 image]';
    }
    if (sanitized.profileImageId && typeof sanitized.profileImageId === 'string' && sanitized.profileImageId.startsWith('data:image/')) {
        sanitized.profileImageId = '[base64 image]';
    }
    return sanitized;
}
