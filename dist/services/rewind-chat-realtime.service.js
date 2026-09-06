"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishRewindChatEvent = publishRewindChatEvent;
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const realtime_websocket_service_1 = require("./realtime-websocket.service");
async function publishRewindChatEvent(userId, event) {
    try {
        await (0, realtime_websocket_service_1.publishUserRealtimeEvent)(userId, "rewind_chat_event", event);
        return true;
    }
    catch (error) {
        logger_util_1.default.warn("Unable to publish Rewind chat realtime event", {
            chatId: event.chatId,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorStack: error instanceof Error ? error.stack : undefined,
            eventType: event.type,
            runId: "runId" in event ? event.runId : undefined,
            userId,
        });
        return false;
    }
}
