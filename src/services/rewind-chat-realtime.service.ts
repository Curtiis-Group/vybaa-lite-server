import logger from "../utils/logger.util";
import { publishUserRealtimeEvent } from "./realtime-websocket.service";
import type {
  SerializedRewindChatMessage,
  SerializedRewindChatReaction,
} from "./rewind-chat-serialization.service";

export type RewindChatRealtimeEvent =
  | {
      chatId: string;
      runId: string;
      status: string;
      type: "run_state";
    }
  | {
      chatId: string;
      personaId: string;
      runId: string;
      turnId: string;
      type: "typing_started" | "typing_stopped";
    }
  | {
      chatId: string;
      delta: string;
      personaId: string;
      runId: string;
      sequence: number;
      turnId: string;
      type: "message_delta";
    }
  | {
      chatId: string;
      message: SerializedRewindChatMessage;
      messageId: string;
      runId: string;
      turnId: string;
      type: "message_committed";
    }
  | {
      chatId: string;
      messageId: string;
      type: "user_message_committed";
    }
  | {
      chatId: string;
      messageId: string;
      reactions: SerializedRewindChatReaction[];
      type: "reaction_updated";
    }
  | {
      chatId: string;
      messageId: string;
      runId: string;
      seenAt: string;
      type: "user_message_seen";
    }
  | {
      chatId: string;
      runId: string;
      type: "chat_invalidated";
    }
  | {
      chatId: string;
      code: string;
      message: string;
      runId: string;
      type: "run_failed";
    };

export async function publishRewindChatEvent(
  userId: string,
  event: RewindChatRealtimeEvent,
): Promise<boolean> {
  try {
    await publishUserRealtimeEvent(userId, "rewind_chat_event", event);
    return true;
  } catch (error: unknown) {
    logger.warn("Unable to publish Rewind chat realtime event", {
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
