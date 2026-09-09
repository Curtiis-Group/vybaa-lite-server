"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROOM_REACTION_COOLDOWN_MS = exports.PARTNER_REACTION_COOLDOWN_MS = void 0;
exports.getPartnerReactionDelayMs = getPartnerReactionDelayMs;
exports.shouldAddPartnerReaction = shouldAddPartnerReaction;
const node_crypto_1 = require("node:crypto");
exports.PARTNER_REACTION_COOLDOWN_MS = 12 * 1000;
exports.ROOM_REACTION_COOLDOWN_MS = 3 * 1000;
function getPartnerReactionDelayMs() {
    return (0, node_crypto_1.randomInt)(4000, 12001);
}
function shouldAddPartnerReaction(params) {
    if (params.targetRole === "SYSTEM" ||
        params.targetPersonaId === params.personaId)
        return false;
    if (params.hasPartnerReaction)
        return false;
    const age = params.now.getTime() - params.createdAt.getTime();
    if (age < 0 || age > 30 * 60 * 1000)
        return false;
    if (params.lastPartnerReactionAt &&
        params.now.getTime() - params.lastPartnerReactionAt.getTime() <
            exports.PARTNER_REACTION_COOLDOWN_MS)
        return false;
    if (params.lastRoomReactionAt &&
        params.now.getTime() - params.lastRoomReactionAt.getTime() <
            exports.ROOM_REACTION_COOLDOWN_MS)
        return false;
    return Boolean(params.content.trim());
}
