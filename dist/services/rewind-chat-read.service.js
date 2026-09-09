"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRewindReadSchedule = createRewindReadSchedule;
exports.getRewindReadTimes = getRewindReadTimes;
exports.getRewindPersonaReadTime = getRewindPersonaReadTime;
exports.processRewindChatReadReceipts = processRewindChatReadReceipts;
exports.deliverRewindReadReceiptLater = deliverRewindReadReceiptLater;
const node_crypto_1 = require("node:crypto");
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const rewind_chat_realtime_service_1 = require("./rewind-chat-realtime.service");
function createRewindReadSchedule(personas, now) {
    const schedule = {};
    let delay = (0, node_crypto_1.randomInt)(2500, 6001);
    // Shuffle who notices first, rather than always letting the same partner lead.
    const remaining = [...new Set(personas)];
    while (remaining.length) {
        const index = (0, node_crypto_1.randomInt)(remaining.length);
        const persona = remaining.splice(index, 1)[0];
        if (!persona)
            continue;
        schedule[persona] = new Date(now.getTime() + delay).toISOString();
        delay += (0, node_crypto_1.randomInt)(2000, 7001);
    }
    return schedule;
}
function getRewindReadTimes(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return [];
    return Object.values(value)
        .filter((entry) => typeof entry === "string")
        .map((entry) => Date.parse(entry))
        .filter(Number.isFinite);
}
function getRewindPersonaReadTime(value, personaId) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const entry = Object.entries(value).find(([key]) => key === personaId)?.[1];
    const time = typeof entry === "string" ? Date.parse(entry) : NaN;
    return Number.isFinite(time) ? time : null;
}
async function processRewindChatReadReceipts(messageId, userId) {
    const now = new Date();
    const messages = await db_config_1.prisma.rewindChatMessage.findMany({
        select: {
            id: true,
            userId: true,
            chatId: true,
            runId: true,
            readDueAt: true,
        },
        where: {
            id: messageId,
            userId,
            role: "USER",
            seenAt: null,
            readDueAt: { lte: now },
        },
        orderBy: { readDueAt: "asc" },
        take: 100,
    });
    for (const message of messages) {
        if (!message.readDueAt)
            continue;
        const outboxId = await db_config_1.prisma.$transaction(async (tx) => {
            const updated = await tx.rewindChatMessage.updateMany({
                data: { seenAt: message.readDueAt },
                where: {
                    id: message.id,
                    userId: message.userId,
                    seenAt: null,
                    readDueAt: { lte: now },
                },
            });
            if (!updated.count)
                return null;
            const outbox = await tx.rewindChatOutbox.create({
                data: {
                    chatId: message.chatId,
                    userId: message.userId,
                    dedupeKey: `user_message_seen:${message.id}`,
                    eventType: "user_message_seen",
                    payload: { messageId: message.id, runId: message.runId ?? "" },
                },
            });
            return outbox.id;
        });
        if (!outboxId)
            continue;
        const published = await (0, rewind_chat_realtime_service_1.publishRewindChatEvent)(message.userId, {
            chatId: message.chatId,
            messageId: message.id,
            runId: message.runId ?? "",
            seenAt: message.readDueAt.toISOString(),
            type: "user_message_seen",
        });
        if (published) {
            await db_config_1.prisma.rewindChatOutbox.update({
                data: { publishedAt: new Date() },
                where: { id: outboxId },
            });
        }
    }
}
async function deliverRewindReadReceiptLater(messageId, userId, dueAt) {
    try {
        const delay = Math.max(0, dueAt.getTime() - Date.now());
        await new Promise((resolve) => setTimeout(resolve, delay));
        await processRewindChatReadReceipts(messageId, userId);
    }
    catch (error) {
        logger_util_1.default.warn("Read receipt will retry in the chat worker", {
            messageId,
            userId,
            errorMessage: error instanceof Error ? error.message : String(error),
        });
    }
}
