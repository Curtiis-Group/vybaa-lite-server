"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FREE_REWIND_PERSONA_IDS = exports.SubscriptionAccessError = void 0;
exports.areVybaaProChecksEnabled = areVybaaProChecksEnabled;
exports.getSubscriptionStatusWithProBypass = getSubscriptionStatusWithProBypass;
exports.requiresProForRewindPersona = requiresProForRewindPersona;
exports.requiresProForRewindFrequency = requiresProForRewindFrequency;
exports.requiresProForInsightsRange = requiresProForInsightsRange;
exports.getConfirmedVybaaAccess = getConfirmedVybaaAccess;
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
const env_util_1 = require("../utils/env.util");
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
function areVybaaProChecksEnabled(clientApp) {
    if (clientApp !== "vybaa")
        return true;
    return env_util_1.Env.VYBAA_PRO_CHECKS_ENABLED?.trim().toLowerCase() !== "false";
}
function createTemporaryProAccess() {
    return {
        clientApp: "vybaa",
        entitlementId: revenuecat_service_1.VYBAA_ENTITLEMENT_ID,
        environment: "BYPASS",
        expiresAt: null,
        isConfigured: true,
        isPro: true,
        isTrial: false,
        managementURL: null,
        productIdentifier: null,
        tier: "pro",
        verifiedAt: new Date().toISOString(),
    };
}
async function getSubscriptionStatusWithProBypass(userId, clientApp, options, loadStatus = revenuecat_service_1.getRevenueCatSubscriptionStatus) {
    if (!areVybaaProChecksEnabled(clientApp)) {
        return createTemporaryProAccess();
    }
    return loadStatus(userId, clientApp, options);
}
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
async function getConfirmedVybaaAccess(userId, clientApp, loadStatus = revenuecat_service_1.getRevenueCatSubscriptionStatus) {
    if (clientApp !== "vybaa")
        return null;
    try {
        const cachedAccess = await getSubscriptionStatusWithProBypass(userId, clientApp, undefined, loadStatus);
        if (cachedAccess.isPro)
            return cachedAccess;
        // A free snapshot may have been written moments before a purchase. Pro
        // gates must revalidate that negative result before denying access.
        return await getSubscriptionStatusWithProBypass(userId, clientApp, { forceRefresh: true }, loadStatus);
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
    if (!areVybaaProChecksEnabled(clientApp))
        return;
    const activeGoalCount = await (dependencies.countActiveGoals ?? countActiveGoals)(userId);
    if (activeGoalCount < revenuecat_service_1.FREE_SUBSCRIPTION_LIMITS.activeGoals)
        return;
    const access = await (dependencies.loadAccess ?? getConfirmedVybaaAccess)(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("FREE_LIMIT_REACHED", `Free accounts can have up to ${revenuecat_service_1.FREE_SUBSCRIPTION_LIMITS.activeGoals} active goals`);
}
async function assertCanCreateCommunity(userId, clientApp, dependencies = {}) {
    if (clientApp !== "vybaa")
        return;
    if (!areVybaaProChecksEnabled(clientApp))
        return;
    const ownedCommunityCount = await (dependencies.countOwnedCommunities ?? countOwnedCommunities)(userId);
    if (ownedCommunityCount < revenuecat_service_1.FREE_SUBSCRIPTION_LIMITS.ownedCommunities)
        return;
    const access = await (dependencies.loadAccess ?? getConfirmedVybaaAccess)(userId, clientApp);
    if (!access?.isPro) {
        throw new SubscriptionAccessError("FREE_LIMIT_REACHED", "Upgrade to Vybaa Pro to create another community");
    }
    const limit = (0, revenuecat_service_1.getLimitsForAccess)(access).ownedCommunities;
    if (ownedCommunityCount < limit)
        return;
    throw new SubscriptionAccessError("PLAN_LIMIT_REACHED", `Vybaa Pro supports up to ${limit} owned communities`);
}
async function assertCanUseRewindFrequency(userId, clientApp, frequency, loadAccess = getConfirmedVybaaAccess) {
    if (!areVybaaProChecksEnabled(clientApp))
        return;
    if (!requiresProForRewindFrequency(frequency))
        return;
    const access = await loadAccess(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("PRO_REQUIRED", "Morning and evening or custom Rewind routines require Vybaa Pro");
}
async function assertCanUseRewindInsightsRange(userId, clientApp, range, loadAccess = getConfirmedVybaaAccess) {
    if (!areVybaaProChecksEnabled(clientApp))
        return;
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
    if (!areVybaaProChecksEnabled(clientApp))
        return;
    const access = await loadAccess(userId, clientApp);
    if (access?.isPro)
        return;
    throw new SubscriptionAccessError("PRO_REQUIRED", message);
}
async function assertCanUseRewindChats(userId, clientApp, loadAccess = getConfirmedVybaaAccess) {
    await assertHasProAccess(userId, clientApp, "Anytime Rewind chats require Vybaa Pro", loadAccess);
}
async function assertCanUseQuickGoalSetup(userId, clientApp, loadAccess = getConfirmedVybaaAccess) {
    await assertHasProAccess(userId, clientApp, "Quick Goal Setup requires Vybaa Pro", loadAccess);
}
async function assertCanSelectRewindPersona(userId, clientApp, personaId, loadAccess = getConfirmedVybaaAccess) {
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
