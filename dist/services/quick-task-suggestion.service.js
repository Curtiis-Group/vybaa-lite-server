"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_SUGGESTIONS_RESPONSE_SCHEMA = void 0;
exports.taskTitleKey = taskTitleKey;
exports.parseTaskSuggestions = parseTaskSuggestions;
exports.groundTaskSuggestions = groundTaskSuggestions;
exports.listQuickTaskSuggestions = listQuickTaskSuggestions;
const node_crypto_1 = require("node:crypto");
const luxon_1 = require("luxon");
const zod_1 = require("zod");
const db_config_1 = require("../config/db.config");
const suggestionSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(3).max(120),
    reason: zod_1.z.string().trim().min(3).max(220),
    signalIds: zod_1.z.array(zod_1.z.string().min(1).max(128)).min(1).max(3),
});
exports.TASK_SUGGESTIONS_RESPONSE_SCHEMA = {
    type: "array",
    maxItems: 3,
    items: {
        type: "object",
        additionalProperties: false,
        properties: {
            title: { type: "string" },
            reason: { type: "string" },
            signalIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "reason", "signalIds"],
    },
};
function taskTitleKey(title) {
    return title
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
}
// Suggestions are optional: malformed extras must never break the daily observation.
function parseTaskSuggestions(value) {
    if (!Array.isArray(value))
        return [];
    const suggestions = [];
    const seen = new Set();
    for (const entry of value.slice(0, 10)) {
        const parsed = suggestionSchema.safeParse(entry);
        if (!parsed.success)
            continue;
        const key = taskTitleKey(parsed.data.title);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        suggestions.push(parsed.data);
        if (suggestions.length === 3)
            break;
    }
    return suggestions;
}
function groundTaskSuggestions(suggestions, signals, existingTitles = []) {
    const eligible = new Set(signals
        .filter((signal) => signal.privacyEligible &&
        signal.sourceType !== "REWARD" &&
        signal.sourceType !== "ACHIEVEMENT")
        .map((signal) => signal.id));
    const existing = new Set(existingTitles.map(taskTitleKey));
    return suggestions.filter((suggestion) => !existing.has(taskTitleKey(suggestion.title)) &&
        suggestion.signalIds.every((id) => eligible.has(id)));
}
async function listQuickTaskSuggestions(userId) {
    const user = await db_config_1.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true, rewindPersonalizationEnabled: true },
    });
    if (!user?.rewindPersonalizationEnabled)
        return [];
    const localNow = luxon_1.DateTime.now().setZone(user.timezone);
    const now = localNow.isValid ? localNow : luxon_1.DateTime.utc();
    const [observations, goals] = await Promise.all([
        db_config_1.prisma.dailyObservation.findMany({
            where: {
                userId,
                dismissedAt: null,
                localDateKey: {
                    gte: now.minus({ days: 2 }).toISODate() ?? "",
                    lte: now.toISODate() ?? "",
                },
            },
            select: { id: true, taskSuggestions: true },
            orderBy: [{ localDateKey: "desc" }, { id: "desc" }],
            take: 3,
        }),
        db_config_1.prisma.goalV2.findMany({
            where: {
                userId,
                OR: [
                    { status: { in: ["ACTIVE", "PAUSED"] }, archivedAt: null },
                    { createdAt: { gte: now.minus({ days: 3 }).toJSDate() } },
                ],
            },
            select: { title: true },
        }),
    ]);
    const candidates = observations.flatMap((observation) => parseTaskSuggestions(observation.taskSuggestions));
    if (!candidates.length)
        return [];
    // Recheck ownership and privacy against live evidence, not just saved AI references.
    const signals = await db_config_1.prisma.activitySignal.findMany({
        where: {
            userId,
            privacyEligible: true,
            id: { in: [...new Set(candidates.flatMap((item) => item.signalIds))] },
        },
        select: { id: true, privacyEligible: true, sourceType: true },
    });
    const grounded = groundTaskSuggestions(candidates, signals, goals.map((goal) => goal.title));
    const seen = new Set();
    const items = [];
    for (const suggestion of grounded) {
        const key = taskTitleKey(suggestion.title);
        if (seen.has(key))
            continue;
        seen.add(key);
        items.push({
            id: (0, node_crypto_1.createHash)("sha256")
                .update(`${userId}:${key}`)
                .digest("hex")
                .slice(0, 24),
            title: suggestion.title,
            reason: suggestion.reason,
        });
        if (items.length === 3)
            break;
    }
    return items;
}
