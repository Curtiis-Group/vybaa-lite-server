"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLogger = requestLogger;
const crypto_1 = require("crypto");
const metrics_service_1 = require("../services/metrics.service");
const logger_util_1 = __importStar(require("../utils/logger.util"));
function requestLogger(req, res, next) {
    const start = Date.now();
    const requestId = getRequestId(req);
    const requestPath = (0, logger_util_1.redactRequestPath)(req.originalUrl ?? req.path);
    let responseLogged = false;
    res.setHeader("x-request-id", requestId);
    logRequestStarted(req, requestId, requestPath);
    if (shouldLogBody(req.method, req.path) && req.body !== undefined) {
        logger_util_1.default.debug("HTTP request body", {
            body: sanitizeBody(req.body),
            requestId,
        });
    }
    res.once("finish", () => {
        if (responseLogged) {
            return;
        }
        responseLogged = true;
        logRequestCompleted(req, res, requestId, requestPath, Date.now() - start);
    });
    res.once("close", () => {
        if (responseLogged || res.writableFinished) {
            return;
        }
        responseLogged = true;
        logger_util_1.default.warn("HTTP request closed before response completed", {
            durationMs: Date.now() - start,
            method: req.method,
            path: requestPath,
            requestId,
        });
    });
    next();
}
function getRequestId(req) {
    const suppliedRequestId = req.header("x-request-id")?.trim();
    if (suppliedRequestId && suppliedRequestId.length <= 128) {
        return suppliedRequestId;
    }
    return (0, crypto_1.randomUUID)();
}
function logRequestStarted(req, requestId, requestPath) {
    logger_util_1.default.info("HTTP request started", {
        ip: req.ip ?? "unknown",
        method: req.method,
        path: requestPath,
        requestId,
        userAgent: req.get("user-agent") ?? "unknown",
    });
}
function logRequestCompleted(req, res, requestId, requestPath, durationMs) {
    const context = {
        contentLength: res.getHeader("content-length"),
        durationMs,
        method: req.method,
        path: requestPath,
        requestId,
        route: req.route?.path ?? req.path,
        status: res.statusCode,
    };
    if (res.statusCode >= 500) {
        logger_util_1.default.error("HTTP request completed", context);
        recordRequestMetrics(req, res, durationMs, requestId);
        return;
    }
    if (res.statusCode >= 400) {
        logger_util_1.default.warn("HTTP request completed", context);
        recordRequestMetrics(req, res, durationMs, requestId);
        return;
    }
    logger_util_1.default.info("HTTP request completed", context);
    recordRequestMetrics(req, res, durationMs, requestId);
}
function recordRequestMetrics(req, res, durationMs, requestId) {
    void metrics_service_1.metricsService
        .record("http_request_duration_ms", durationMs, {
        method: req.method,
        route: req.route?.path ?? req.path,
        status: res.statusCode,
    })
        .catch((error) => {
        logger_util_1.default.warn("HTTP metrics recording failed", {
            ...describeError(error),
            requestId,
        });
    });
}
function shouldLogBody(method, path) {
    const sensitivePaths = ["/auth/login", "/auth/register", "/auth/google"];
    if (sensitivePaths.some((sensitivePath) => path.includes(sensitivePath))) {
        return false;
    }
    return ["POST", "PUT", "PATCH"].includes(method);
}
function sanitizeBody(body, fieldName) {
    if (fieldName && isSensitiveField(fieldName)) {
        return "[REDACTED]";
    }
    if (typeof body === "string") {
        if (body.startsWith("data:image/")) {
            return "[base64 image]";
        }
        return body.length > 1000 ? `${body.slice(0, 1000)}…[TRUNCATED]` : body;
    }
    if (Array.isArray(body)) {
        return body.slice(0, 20).map((item) => sanitizeBody(item));
    }
    if (!isRecord(body)) {
        return body;
    }
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, sanitizeBody(value, key)]));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSensitiveField(fieldName) {
    return /password|refreshToken|token|otp|authorization|cookie|secret/i.test(fieldName);
}
function describeError(error) {
    if (error instanceof Error) {
        return { errorMessage: error.message, errorName: error.name };
    }
    return { errorMessage: String(error) };
}
