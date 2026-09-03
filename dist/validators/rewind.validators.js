"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRewindActivitySchema = exports.updateRewindChatSchema = exports.sendRewindChatMessageSchema = exports.listRewindRecordsSchema = exports.rewindObservationIdSchema = exports.rewindChatIdSchema = exports.createLiveTokenSchema = void 0;
const zod_1 = require("zod");
exports.createLiveTokenSchema = zod_1.z.object({
    personaId: zod_1.z.enum(["ella", "lyra", "jake", "ariel"]),
});
exports.rewindChatIdSchema = zod_1.z.object({
    chatId: zod_1.z.string().trim().min(1).max(128),
});
exports.rewindObservationIdSchema = zod_1.z.object({
    observationId: zod_1.z.string().trim().min(1).max(128),
});
exports.listRewindRecordsSchema = zod_1.z.object({
    cursor: zod_1.z.string().trim().min(1).max(256).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(50).default(20),
});
exports.sendRewindChatMessageSchema = zod_1.z.object({
    content: zod_1.z.string().trim().min(1).max(4000),
    idempotencyKey: zod_1.z.string().trim().min(8).max(160),
});
exports.updateRewindChatSchema = zod_1.z.object({
    archived: zod_1.z.boolean(),
});
exports.recordRewindActivitySchema = zod_1.z.object({
    description: zod_1.z.string().trim().min(1).max(500),
    eventType: zod_1.z.enum(["FLEXX_CREATED", "FLEXX_SHARED"]),
    happenedAt: zod_1.z.string().datetime().optional(),
    sourceId: zod_1.z.string().trim().min(1).max(128),
});
