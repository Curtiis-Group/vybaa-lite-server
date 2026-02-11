"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAchievements = getAchievements;
exports.getAchievementStats = getAchievementStats;
exports.getBadgeDefinitions = getBadgeDefinitions;
const achievement_service_1 = require("../services/achievement.service");
const badges_config_1 = require("../config/badges.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Get all achievements for the authenticated user
 */
async function getAchievements(req, res) {
    try {
        const userId = req.userId;
        const achievements = await achievement_service_1.achievementService.getUserAchievements(userId);
        res.json({
            msg: "Achievements retrieved successfully",
            data: achievements,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get achievements error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get achievement stats for the authenticated user
 */
async function getAchievementStats(req, res) {
    try {
        const userId = req.userId;
        const stats = await achievement_service_1.achievementService.getUserAchievementStats(userId);
        res.json({
            msg: "Achievement stats retrieved successfully",
            data: stats,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get achievement stats error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get all possible badge definitions (for showing locked badges)
 */
async function getBadgeDefinitions(req, res) {
    try {
        const allBadges = (0, badges_config_1.getAllBadgeDefinitions)();
        res.json({
            msg: "Badge definitions retrieved successfully",
            data: allBadges,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get badge definitions error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
