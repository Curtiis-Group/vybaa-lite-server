"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNotificationDedupeConflict = isNotificationDedupeConflict;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNotificationDedupeConflict(error, dedupeKey) {
    return Boolean(dedupeKey) && isRecord(error) && error.code === "P2002";
}
