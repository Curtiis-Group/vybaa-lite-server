"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChillSession = createChillSession;
exports.updateSessionDuration = updateSessionDuration;
exports.completeChillSession = completeChillSession;
exports.getChillSessions = getChillSessions;
exports.getChillStats = getChillStats;
exports.getEmotionSummary = getEmotionSummary;
exports.getPaginatedSessions = getPaginatedSessions;
const chill_service_1 = require("../services/chill.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Create a chill session and get AI suggestions
 */
async function createChillSession(req, res) {
    try {
        const userId = req.userId;
        const { emotion } = req.body;
        if (!emotion || typeof emotion !== "string" || emotion.trim().length === 0) {
            return res.status(400).json({ msg: "Emotion text is required" });
        }
        const result = await chill_service_1.chillService.createSession(userId, emotion.trim());
        res.json({
            msg: "Chill session created successfully",
            data: {
                sessionId: result.sessionId,
                suggestedTimes: result.suggestions.suggestedTimes,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Create chill session error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Update session duration when user selects a time
 */
async function updateSessionDuration(req, res) {
    try {
        const userId = req.userId;
        const sessionId = String(req.params.sessionId);
        const { duration } = req.body;
        if (!duration || typeof duration !== "number" || duration <= 0) {
            return res.status(400).json({ msg: "Valid duration is required" });
        }
        await chill_service_1.chillService.updateSessionDuration(sessionId, userId, duration);
        res.json({
            msg: "Session duration updated",
        });
    }
    catch (error) {
        logger_util_1.default.error("Update session duration error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Mark a chill session as completed
 */
async function completeChillSession(req, res) {
    try {
        const userId = req.userId;
        const sessionId = String(req.params.sessionId);
        const { postSessionMood } = req.body;
        await chill_service_1.chillService.completeSession(sessionId, userId, postSessionMood);
        res.json({
            msg: "Chill session completed successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Complete chill session error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get user's chill session history
 */
async function getChillSessions(req, res) {
    try {
        const userId = req.userId;
        const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const sessions = await chill_service_1.chillService.getUserSessions(userId, limit);
        res.json({
            msg: "Chill sessions retrieved successfully",
            data: sessions,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get chill sessions error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get user's chill session stats
 */
async function getChillStats(req, res) {
    try {
        const userId = req.userId;
        const stats = await chill_service_1.chillService.getUserStats(userId);
        res.json({
            msg: "Chill stats retrieved successfully",
            data: stats,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get chill stats error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get AI-generated summary only (cached for 24 hours)
 */
async function getEmotionSummary(req, res) {
    try {
        const userId = req.userId;
        const result = await chill_service_1.chillService.getEmotionSummary(userId);
        res.json({
            msg: "Emotion summary retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get emotion summary error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get paginated sessions
 */
async function getPaginatedSessions(req, res) {
    try {
        const userId = req.userId;
        const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
        const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "10")) || 10;
        const result = await chill_service_1.chillService.getPaginatedSessions(userId, page, limit);
        res.json({
            msg: "Sessions retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get paginated sessions error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
