"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rewindConversationMoodSchema = void 0;
exports.resolveRewindConversationMood = resolveRewindConversationMood;
exports.formatRewindConversationMood = formatRewindConversationMood;
exports.getRewindMoodDelayMultiplier = getRewindMoodDelayMultiplier;
const zod_1 = require("zod");
exports.rewindConversationMoodSchema = zod_1.z
    .object({
    energy: zod_1.z.number().int().min(0).max(100),
    playfulness: zod_1.z.number().int().min(0).max(100),
    directness: zod_1.z.number().int().min(0).max(100),
})
    .strict();
function resolveRewindConversationMood(value) {
    const parsed = exports.rewindConversationMoodSchema.safeParse(value);
    return parsed.success
        ? parsed.data
        : { energy: 50, playfulness: 50, directness: 50 };
}
function formatRewindConversationMood(value) {
    const mood = resolveRewindConversationMood(value);
    return `Conversation preferences (0–100): energy ${mood.energy} (quiet to lively), playfulness ${mood.playfulness} (serious to playful), directness ${mood.directness} (gentle to frank). Adapt how you phrase and pace this conversation, not who you are. Livelier means more engaged, never message flooding. Quiet does not mean ignoring someone. Playfulness never trivializes distress. Directness never means cruelty. Preserve each partner's own views, voice, boundaries and persistent relationship feelings. These preferences do not change reminders, permissions or proactive message limits.`;
}
function getRewindMoodDelayMultiplier(value) {
    return 1.25 - resolveRewindConversationMood(value).energy / 200;
}
