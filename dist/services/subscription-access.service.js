"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_REWIND_PERSONA_IDS = exports.SubscriptionAccessError = void 0;
exports.requiresProForRewindPersona = requiresProForRewindPersona;
exports.requiresProForRewindFrequency = requiresProForRewindFrequency;
exports.requiresProForInsightsRange = requiresProForInsightsRange;
exports.assertCanCreateGoal = assertCanCreateGoal;
exports.assertCanCreateCommunity = assertCanCreateCommunity;
exports.assertCanUseRewindFrequency = assertCanUseRewindFrequency;
exports.assertCanUseRewindInsightsRange = assertCanUseRewindInsightsRange;
exports.assertCanUseRewindChats = assertCanUseRewindChats;
exports.assertCanUseQuickGoalSetup = assertCanUseQuickGoalSetup;
exports.assertCanSelectRewindPersona = assertCanSelectRewindPersona;
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
exports.FREE_REWIND_PERSONA_IDS = ["ella", "lyra"];
function requiresProForRewindPersona(personaId) {
    if (!personaId)
        return false;
    return !exports.FREE_REWIND_PERSONA_IDS.some((freePersonaId) => freePersonaId === personaId);
}
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
async function countActiveGoals(userId) {
    const [legacyGoals, standardGoals] = await Promise.all([
        db_config_1.prisma.goal.findMany({
            where: { archivedAt: null, userId },
            select: { currentDay: true, targetDays: true },
        }),
        db_config_1.prisma.goalV2.count({
            where: { archivedAt: null, status: { in: ["ACTIVE", "PAUSED"] }, userId },
        }),
    ]);
    return (legacyGoals.filter((goal) => goal.currentDay < goal.targetDays).length +
        standardGoals);
}
async function countOwnedCommunities(userId) {
    return db_config_1.prisma.community.count({ where: { ownerId: userId } });
}
async function assertCanCreateGoal(userId, clientApp, dependencies = {}) {
    if (clientApp !== "vybaa")
        return;
    const activeGoalCount = await (dependencies.countActiveGoals ?? countActiveGoals)(userId);
    if (activeGoalCount < revenuecat_service_1.FREE_SUBSCRIPTION_LIMITS.activeGoals)
        return;
    const access = await (dependencies.loadAccess ?? getVybaaAccess)(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("FREE_LIMIT_REACHED", `Free accounts can have up to ${revenuecat_service_1.FREE_SUBSCRIPTION_LIMITS.activeGoals} active goals`);
}
async function assertCanCreateCommunity(userId, clientApp, dependencies = {}) {
    if (clientApp !== "vybaa")
        return;
    const ownedCommunityCount = await (dependencies.countOwnedCommunities ?? countOwnedCommunities)(userId);
    if (ownedCommunityCount < revenuecat_service_1.FREE_SUBSCRIPTION_LIMITS.ownedCommunities)
        return;
    const access = await (dependencies.loadAccess ?? getVybaaAccess)(userId, clientApp);
    if (!access?.isPro) {
        throw new SubscriptionAccessError("FREE_LIMIT_REACHED", "Upgrade to Vybaa Pro to create another community");
    }
    const limit = (0, revenuecat_service_1.getLimitsForAccess)(access).ownedCommunities;
    if (ownedCommunityCount < limit)
        return;
    throw new SubscriptionAccessError("PLAN_LIMIT_REACHED", `Vybaa Pro supports up to ${limit} owned communities`);
}
async function assertCanUseRewindFrequency(userId, clientApp, frequency, loadAccess = getVybaaAccess) {
    if (!requiresProForRewindFrequency(frequency))
        return;
    const access = await loadAccess(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("PRO_REQUIRED", "Morning and evening or custom Rewind routines require Vybaa Pro");
}
async function assertCanUseRewindInsightsRange(userId, clientApp, range, loadAccess = getVybaaAccess) {
    if (!requiresProForInsightsRange(range))
        return;
    const access = await loadAccess(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("PRO_REQUIRED", `${range === "30d" ? "30-day" : "90-day"} Rewind insights require Vybaa Pro`);
}
async function assertHasProAccess(userId, clientApp, message, loadAccess) {
    if (clientApp !== "vybaa")
        return;
    const access = await loadAccess(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("PRO_REQUIRED", message);
}
async function assertCanUseRewindChats(userId, clientApp, loadAccess = getVybaaAccess) {
    await assertHasProAccess(userId, clientApp, "Anytime Rewind chats require Vybaa Pro", loadAccess);
}
async function assertCanUseQuickGoalSetup(userId, clientApp, loadAccess = getVybaaAccess) {
    await assertHasProAccess(userId, clientApp, "Quick Goal Setup requires Vybaa Pro", loadAccess);
}
async function assertCanSelectRewindPersona(userId, clientApp, personaId, loadAccess = getVybaaAccess) {
    if (!requiresProForRewindPersona(personaId))
        return;
    await assertHasProAccess(userId, clientApp, "Jake, Ariel, Tobi, and Neeja require Vybaa Pro", loadAccess);
}
function handleSubscriptionAccessError(error, res) {
    if (!(error instanceof SubscriptionAccessError))
        return false;
    res.status(error.statusCode).json({ code: error.code, msg: error.message });
    return true;
}
