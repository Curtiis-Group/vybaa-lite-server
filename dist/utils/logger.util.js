"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
require("dotenv/config");
const winston_1 = __importDefault(require("winston"));
const logDir = "logs";
(0, fs_1.mkdirSync)(logDir, { recursive: true });
const logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.json());
const logLevel = (process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "production" ? "info" : "debug")).toLowerCase();
const verboseConsoleOutput = ["debug", "silly", "verbose"].includes(logLevel);
const consoleFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston_1.default.format.errors({ stack: true }), winston_1.default.format.splat(), winston_1.default.format.printf((info) => {
    const level = String(info.level ?? "info");
    const context = {};
    let errorStack = typeof info.stack === "string" ? info.stack : undefined;
    for (const [key, value] of Object.entries(info)) {
        if (["errorStack", "level", "message", "service", "stack", "timestamp"].includes(key)) {
            if (key === "errorStack" && typeof value === "string") {
                errorStack ?? (errorStack = value);
            }
            continue;
        }
        context[key] = value;
    }
    const splatValue = Reflect.get(info, Symbol.for("splat"));
    if (Array.isArray(splatValue)) {
        for (const value of splatValue) {
            if (value instanceof Error) {
                context.errorName = value.name;
                context.errorMessage = value.message;
                errorStack ?? (errorStack = value.stack);
                continue;
            }
            if (isRecord(value)) {
                for (const [key, entryValue] of Object.entries(value)) {
                    if (key === "errorStack" && typeof entryValue === "string") {
                        errorStack ?? (errorStack = entryValue);
                        continue;
                    }
                    context[key] = entryValue;
                }
                continue;
            }
            context.details = value;
        }
    }
    const message = typeof info.message === "string"
        ? info.message
        : serializeLogValue(info.message);
    const contextSuffix = verboseConsoleOutput && Object.keys(context).length
        ? ` ${chalk_1.default.dim(`context=${serializeLogValue(context)}`)}`
        : formatHttpConsoleContext(message, context);
    const stackSuffix = errorStack &&
        verboseConsoleOutput &&
        (process.env.LOG_STACKS === "true" || level === "error")
        ? `\n${chalk_1.default.dim(errorStack)}`
        : "";
    return `[${chalk_1.default.yellow(String(info.timestamp ?? ""))}][${colorizeLevel(level)}]: ${message}${contextSuffix}${stackSuffix}`;
}));
const logger = winston_1.default.createLogger({
    level: logLevel,
    format: logFormat,
    defaultMeta: { service: "vybaa-lite-server" },
    transports: [
        new winston_1.default.transports.Console({
            format: consoleFormat,
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, "error.log"),
            level: "error",
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, "combined.log"),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});
function colorizeLevel(level) {
    const label = level.toUpperCase().padEnd(5, " ");
    switch (level.toLowerCase()) {
        case "error":
            return chalk_1.default.red(label);
        case "warn":
            return chalk_1.default.yellow(label);
        case "debug":
            return chalk_1.default.cyan(label);
        case "verbose":
            return chalk_1.default.magenta(label);
        default:
            return chalk_1.default.green(label);
    }
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function redactLogValue(value, key, depth = 0) {
    if (key && isSensitiveLogKey(key)) {
        return "[REDACTED]";
    }
    if (depth >= 4) {
        return "[TRUNCATED]";
    }
    if (typeof value === "string") {
        return value.length > 1000 ? `${value.slice(0, 1000)}…[TRUNCATED]` : value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 20).map((item) => redactLogValue(item, undefined, depth + 1));
    }
    if (isRecord(value)) {
        const redacted = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            redacted[childKey] = redactLogValue(childValue, childKey, depth + 1);
        }
        return redacted;
    }
    return value;
}
function isSensitiveLogKey(key) {
    const normalizedKey = key
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .toLowerCase();
    return (normalizedKey === "token" ||
        normalizedKey.endsWith("_token") ||
        normalizedKey.includes("api_key") ||
        normalizedKey.includes("authorization") ||
        normalizedKey.includes("cookie") ||
        normalizedKey.includes("password") ||
        normalizedKey.includes("secret"));
}
function serializeLogValue(value) {
    try {
        const serialized = JSON.stringify(redactLogValue(value));
        return serialized ?? String(value);
    }
    catch {
        return "[Unserializable]";
    }
}
function formatHttpConsoleContext(message, context) {
    if (!message.startsWith("HTTP request"))
        return "";
    const method = typeof context.method === "string" ? context.method : null;
    const requestPath = typeof context.path === "string" ? context.path : null;
    const requestLabel = [method, requestPath].filter((value) => Boolean(value)).join(" ");
    if (!requestLabel)
        return "";
    if (message === "HTTP request started")
        return ` ${requestLabel}`;
    const details = [];
    if (typeof context.status === "number") {
        details.push(String(context.status));
    }
    if (typeof context.durationMs === "number") {
        details.push(`in ${Math.round(context.durationMs)}ms`);
    }
    return details.length
        ? ` ${requestLabel} -> ${details.join(" ")}`
        : ` ${requestLabel}`;
}
function writeLogStream(message) {
    const trimmedMessage = message.trim();
    if (trimmedMessage) {
        logger.info(trimmedMessage);
    }
}
const loggerWithStream = Object.assign(logger, {
    stream: { write: writeLogStream },
});
exports.default = loggerWithStream;
