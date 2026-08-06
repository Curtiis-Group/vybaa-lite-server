"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRewindRoutine = getRewindRoutine;
exports.updateRewindRoutine = updateRewindRoutine;
const client_1 = require("@prisma/client");
const rewind_routine_service_1 = require("../services/rewind-routine.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const subscription_access_service_1 = require("../services/subscription-access.service");
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isRewindFrequency(value) {
    return typeof value === "string" && Object.values(client_1.RewindFrequency).includes(value);
}
function isRewindIntent(value) {
    return typeof value === "string" && Object.values(client_1.RewindIntent).includes(value);
}
function getStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? value
        : undefined;
}
function serializeOccurrence(session) {
    if (!session)
        return null;
    return {
        id: session.id,
        scheduledFor: session.scheduledFor?.toISOString() ?? null,
        status: session.status,
        windowEndsAt: session.windowEndsAt?.toISOString() ?? null,
    };
}
async function getRewindRoutine(req, res) {
    try {
        const overview = await (0, rewind_routine_service_1.getRewindRoutineOverview)({ userId: req.userId });
        if (!overview) {
            return res.status(404).json({ msg: "User not found" });
        }
        return res.json({
            msg: "Rewind routine retrieved",
            data: {
                currentSession: serializeOccurrence(overview.currentSession),
                latestSession: serializeOccurrence(overview.latestSession),
                nextSession: serializeOccurrence(overview.nextSession),
                routine: overview.routine,
                timezone: overview.timezone,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get Rewind routine error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        return res.status(500).json({ msg: "Internal server error" });
    }
}
async function updateRewindRoutine(req, res) {
    try {
        if (!isRecord(req.body)) {
            return res.status(400).json({ msg: "Invalid Rewind routine" });
        }
        const { customIntent, frequency, intent, times, timezone } = req.body;
        if (!isRewindFrequency(frequency) ||
            !isRewindIntent(intent) ||
            typeof timezone !== "string") {
            return res.status(400).json({ msg: "Invalid Rewind routine" });
        }
        await (0, subscription_access_service_1.assertCanUseRewindFrequency)(req.userId, req.clientApp, frequency);
        const routine = await (0, rewind_routine_service_1.saveRewindRoutine)({
            userId: req.userId,
            input: {
                customIntent: typeof customIntent === "string" ? customIntent : null,
                frequency,
                intent,
                times: getStringArray(times),
                timezone,
            },
        });
        const overview = await (0, rewind_routine_service_1.getRewindRoutineOverview)({ userId: req.userId });
        return res.json({
            msg: "Rewind routine updated",
            data: {
                currentSession: serializeOccurrence(overview?.currentSession ?? null),
                latestSession: serializeOccurrence(overview?.latestSession ?? null),
                nextSession: serializeOccurrence(overview?.nextSession ?? null),
                routine,
                timezone: overview?.timezone ?? timezone,
            },
        });
    }
    catch (error) {
        if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
            return res;
        const message = error instanceof Error ? error.message : "Invalid Rewind routine";
        if (message === "A valid IANA timezone is required" ||
            message.includes("Custom Rewind") ||
            message.includes("Custom Rewind intention")) {
            return res.status(400).json({ msg: message });
        }
        logger_util_1.default.error("Update Rewind routine error", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        return res.status(500).json({ msg: "Internal server error" });
    }
}
