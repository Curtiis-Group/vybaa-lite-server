"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionAccessError = void 0;
exports.requiresProForRewindFrequency = requiresProForRewindFrequency;
exports.requiresProForInsightsRange = requiresProForInsightsRange;
exports.assertSubscriptionStateCurrent = assertSubscriptionStateCurrent;
exports.assertCanCreateGoal = assertCanCreateGoal;
exports.assertCanCreateCommunity = assertCanCreateCommunity;
exports.assertCanUseRewindFrequency = assertCanUseRewindFrequency;
exports.assertCanUseRewindInsightsRange = assertCanUseRewindInsightsRange;
exports.handleSubscriptionAccessError = handleSubscriptionAccessError;
const client_1 = require("@prisma/client");
const db_config_1 = require("../config/db.config");
const revenuecat_service_1 = require("./revenuecat.service");
class SubscriptionAccessError extends Error {
    constructor(code, message, statusCode = 403) {
        super(message);
        this.name = "SubscriptionAccessError";
        this.code = code;
        this.statusCode = statusCode;
    }
}
exports.SubscriptionAccessError = SubscriptionAccessError;
function requiresProForRewindFrequency(frequency) {
    return (frequency === client_1.RewindFrequency.MORNINGS_AND_EVENINGS ||
        frequency === client_1.RewindFrequency.CUSTOM);
}
function requiresProForInsightsRange(range) {
    return range !== "7d";
}
async function getVybaaAccess(userId, clientApp) {
    if (clientApp !== "vybaa")
        return null;
    try {
        return await (0, revenuecat_service_1.getRevenueCatSubscriptionStatus)(userId, clientApp);
    }
    catch {
        throw new SubscriptionAccessError("SUBSCRIPTION_UNAVAILABLE", "Subscription status is temporarily unavailable", 503);
    }
}
async function assertSubscriptionStateCurrent(userId, clientApp) {
    await getVybaaAccess(userId, clientApp);
}
async function assertCanCreateGoal(userId, clientApp) {
    const access = await getVybaaAccess(userId, clientApp);
    if (!access)
        return;
    const limit = (0, revenuecat_service_1.getLimitsForAccess)(access).activeGoals;
    if (limit === null)
        return;
    const goals = await db_config_1.prisma.goal.findMany({
        where: { userId },
        select: { currentDay: true, targetDays: true },
    });
    const activeGoalCount = goals.filter((goal) => goal.currentDay < goal.targetDays).length;
    if (activeGoalCount >= limit) {
        throw new SubscriptionAccessError("FREE_LIMIT_REACHED", `Free accounts can have up to ${limit} active goals`);
    }
}
async function assertCanCreateCommunity(userId, clientApp) {
    const access = await getVybaaAccess(userId, clientApp);
    if (!access)
        return;
    const limit = (0, revenuecat_service_1.getLimitsForAccess)(access).ownedCommunities;
    const ownedCommunityCount = await db_config_1.prisma.community.count({
        where: { ownerId: userId },
    });
    if (ownedCommunityCount >= limit) {
        throw new SubscriptionAccessError(access.isPro ? "PLAN_LIMIT_REACHED" : "FREE_LIMIT_REACHED", access.isPro
            ? `Vybaa Pro supports up to ${limit} owned communities`
            : "Upgrade to Vybaa Pro to create another community");
    }
}
async function assertCanUseRewindFrequency(userId, clientApp, frequency) {
    const access = await getVybaaAccess(userId, clientApp);
    if (!access || access.isPro)
        return;
    if (requiresProForRewindFrequency(frequency)) {
        throw new SubscriptionAccessError("PRO_REQUIRED", "Morning and evening or custom Rewind routines require Vybaa Pro");
    }
}
async function assertCanUseRewindInsightsRange(userId, clientApp, range) {
    const access = await getVybaaAccess(userId, clientApp);
    if (!access || access.isPro || !requiresProForInsightsRange(range))
        return;
    throw new SubscriptionAccessError("PRO_REQUIRED", `${range === "30d" ? "30-day" : "90-day"} Rewind insights require Vybaa Pro`);
}
function handleSubscriptionAccessError(error, res) {
    if (!(error instanceof SubscriptionAccessError))
        return false;
    res.status(error.statusCode).json({ code: error.code, msg: error.message });
    return true;
}
