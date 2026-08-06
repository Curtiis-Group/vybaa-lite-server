"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubscriptionConfig = getSubscriptionConfig;
exports.getSubscriptionStatus = getSubscriptionStatus;
exports.syncSubscriptionStatus = syncSubscriptionStatus;
const db_config_1 = require("../config/db.config");
const revenuecat_service_1 = require("../services/revenuecat.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
async function getSubscriptionUsage(userId) {
    const [goals, ownedCommunities] = await Promise.all([
        db_config_1.prisma.goal.findMany({
            where: { userId },
            select: { currentDay: true, targetDays: true },
        }),
        db_config_1.prisma.community.count({ where: { ownerId: userId } }),
    ]);
    return {
        activeGoals: goals.filter((goal) => goal.currentDay < goal.targetDays).length,
        ownedCommunities,
    };
}
async function getSubscriptionConfig(req, res) {
    res.status(200).json({
        msg: "Subscription config retrieved",
        data: (0, revenuecat_service_1.getRevenueCatConfig)(req.clientApp),
    });
}
async function getSubscriptionStatus(req, res) {
    if (!req.userId) {
        return res.status(401).json({ msg: "Authentication required" });
    }
    try {
        const [status, usage] = await Promise.all([
            (0, revenuecat_service_1.getRevenueCatSubscriptionStatus)(req.userId, req.clientApp),
            getSubscriptionUsage(req.userId),
        ]);
        res.status(200).json({
            msg: "Subscription status retrieved",
            data: { ...status, limits: (0, revenuecat_service_1.getLimitsForAccess)(status), usage },
        });
    }
    catch (error) {
        logger_util_1.default.error("Subscription verification failed", {
            clientApp: req.clientApp,
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        res.status(503).json({
            code: "SUBSCRIPTION_UNAVAILABLE",
            msg: "Subscription status is temporarily unavailable",
        });
    }
}
async function syncSubscriptionStatus(req, res) {
    if (!req.userId) {
        return res.status(401).json({ msg: "Authentication required" });
    }
    try {
        const status = await (0, revenuecat_service_1.getRevenueCatSubscriptionStatus)(req.userId, req.clientApp, { forceRefresh: true });
        const usage = await getSubscriptionUsage(req.userId);
        return res.status(200).json({
            msg: "Subscription synchronized",
            data: { ...status, limits: (0, revenuecat_service_1.getLimitsForAccess)(status), usage },
        });
    }
    catch (error) {
        logger_util_1.default.error("Subscription synchronization failed", {
            clientApp: req.clientApp,
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        return res.status(503).json({
            code: "SUBSCRIPTION_UNAVAILABLE",
            msg: "Subscription status is temporarily unavailable",
        });
    }
}
