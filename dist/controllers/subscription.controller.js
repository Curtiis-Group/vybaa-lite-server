"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubscriptionConfig = getSubscriptionConfig;
exports.getSubscriptionStatus = getSubscriptionStatus;
const revenuecat_service_1 = require("../services/revenuecat.service");
async function getSubscriptionConfig(_req, res) {
    res.status(200).json({
        msg: "Subscription config retrieved",
        data: (0, revenuecat_service_1.getRevenueCatConfig)(),
    });
}
async function getSubscriptionStatus(req, res) {
    if (!req.userId) {
        return res.status(401).json({ msg: "Authentication required" });
    }
    const status = await (0, revenuecat_service_1.getRevenueCatSubscriptionStatus)(req.userId);
    res.status(200).json({
        msg: "Subscription status retrieved",
        data: status,
    });
}
