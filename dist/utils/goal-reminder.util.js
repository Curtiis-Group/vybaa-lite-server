"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildGoalReminderCopy = buildGoalReminderCopy;
exports.getNextGoalReminderOccurrence = getNextGoalReminderOccurrence;
const node_crypto_1 = require("node:crypto");
const luxon_1 = require("luxon");
const ACTION_VERBS = new Set([
    "call",
    "clean",
    "cook",
    "create",
    "drink",
    "exercise",
    "finish",
    "journal",
    "learn",
    "meditate",
    "plan",
    "practice",
    "pray",
    "read",
    "run",
    "save",
    "sleep",
    "start",
    "stretch",
    "study",
    "walk",
    "work",
    "write",
]);
function getDeterministicIndex(seed, length) {
    const digest = (0, node_crypto_1.createHash)("sha256").update(seed).digest();
    return digest.readUInt32BE(0) % length;
}
function normalizeGoalTitle(value) {
    return value.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim().slice(0, 90);
}
function getActionPhrase(goalTitle) {
    const normalized = goalTitle.toLowerCase();
    const prefixedAction = normalized.match(/^(?:to|i want to|i need to|my goal is to)\s+(.+)$/);
    if (prefixedAction?.[1])
        return prefixedAction[1];
    const firstWord = normalized.split(/\s+/)[0];
    return ACTION_VERBS.has(firstWord) ? normalized : null;
}
function buildGoalReminderCopy(params) {
    const goalTitle = normalizeGoalTitle(params.goalTitle) || "your goal";
    const preferredName = params.preferredName?.trim().split(/\s+/)[0]?.slice(0, 40) || "there";
    const actionPhrase = getActionPhrase(goalTitle);
    const variant = getDeterministicIndex(`${params.seed}:${preferredName}:${goalTitle}`, 3);
    if (actionPhrase) {
        const messages = [
            `Hi ${preferredName}, it's time to ${actionPhrase}.`,
            `Howdy ${preferredName}, ready to ${actionPhrase}?`,
            `Wassup ${preferredName}, you planned to ${actionPhrase}. Ready when you are.`,
        ];
        return {
            message: messages[variant],
            title: `Time to ${actionPhrase}`,
        };
    }
    const messages = [
        `Hi ${preferredName}, ${goalTitle} is on your plan now.`,
        `Howdy ${preferredName}, ready for ${goalTitle}?`,
        `Wassup ${preferredName}, your ${goalTitle} check-in is ready.`,
    ];
    return {
        message: messages[variant],
        title: `${goalTitle} check-in`,
    };
}
function getNextGoalReminderOccurrence(params) {
    const timeMatch = params.reminderTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!timeMatch)
        return null;
    const requestedTimezone = params.timezone?.trim() || "UTC";
    const localNow = luxon_1.DateTime.fromJSDate(params.now, {
        zone: requestedTimezone,
    });
    if (!localNow.isValid)
        return null;
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    let localDay = localNow;
    let occurrence = luxon_1.DateTime.fromObject({
        day: localDay.day,
        hour,
        millisecond: 0,
        minute,
        month: localDay.month,
        second: 0,
        year: localDay.year,
    }, { zone: requestedTimezone });
    if (!occurrence.isValid)
        return null;
    if (occurrence <= localNow) {
        localDay = localNow.plus({ days: 1 });
        occurrence = luxon_1.DateTime.fromObject({
            day: localDay.day,
            hour,
            millisecond: 0,
            minute,
            month: localDay.month,
            second: 0,
            year: localDay.year,
        }, { zone: requestedTimezone });
    }
    if (!occurrence.isValid)
        return null;
    return {
        dayKey: occurrence.toFormat("yyyy-LL-dd"),
        scheduledFor: occurrence.toUTC().toJSDate(),
    };
}
