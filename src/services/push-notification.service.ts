import { firebaseClient } from "../config/firebase.config";
import type { ClientApp } from "../types/client-app.type";
import logger from "../utils/logger.util";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInternalAppRoute(route: string): boolean {
  return route.startsWith("/") && !route.startsWith("//");
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export type CommunicationNotificationMetadata = {
  avatarUrl: string;
  conversationId: string;
  senderId: string;
  senderName: string;
};

function getTrustedPartnerAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value);
    const trustedCloudinaryAsset =
      url.hostname === "res.cloudinary.com" &&
      url.pathname.startsWith("/dqdtazdda/image/upload/");
    return url.protocol === "https:" && trustedCloudinaryAsset
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function getCommunicationNotificationMetadata(
  payload: Record<string, unknown>,
): CommunicationNotificationMetadata | null {
  if (payload.type !== "rewind_chat_message") return null;

  const notificationData = parseRecord(payload.data) ?? payload;
  const sender = parseRecord(notificationData.notificationSender);
  const avatarUrl = getTrustedPartnerAvatarUrl(sender?.avatarUrl);
  const conversationId = notificationData.chatId;
  const senderId = sender?.personaId;
  const senderName = sender?.name;
  if (
    !avatarUrl ||
    typeof conversationId !== "string" ||
    typeof senderId !== "string" ||
    typeof senderName !== "string"
  ) {
    return null;
  }

  return { avatarUrl, conversationId, senderId, senderName };
}

export function getNotificationSenderAvatarUrl(
  payload: Record<string, unknown>,
): string | null {
  return getCommunicationNotificationMetadata(payload)?.avatarUrl ?? null;
}

function getNotificationRoute(payload: Record<string, unknown>): string | null {
  const directRoute = payload.route;
  if (typeof directRoute === "string" && isInternalAppRoute(directRoute)) {
    return directRoute;
  }

  const nestedPayload = payload.data;
  if (!isRecord(nestedPayload)) return null;

  const nestedRoute = nestedPayload.route;
  return typeof nestedRoute === "string" && isInternalAppRoute(nestedRoute)
    ? nestedRoute
    : null;
}

export function serializePushPayload(
  payload: Record<string, unknown>,
): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    data[key] = typeof value === "string" ? value : JSON.stringify(value);
  }

  const route = getNotificationRoute(payload);
  if (route) {
    data.route = route;
  }

  const communication = getCommunicationNotificationMetadata(payload);
  if (communication) {
    data.avatarUrl = communication.avatarUrl;
    data.conversationId = communication.conversationId;
    data.senderId = communication.senderId;
    data.senderName = communication.senderName;
  }

  return data;
}

export class PushNotificationService {
  private buildBaseMessage(
    clientApp: ClientApp,
    title: string,
    body: string,
    payload: Record<string, unknown> = {},
    silent = false,
  ) {
    const data = serializePushPayload(payload);
    const communication = silent
      ? null
      : getCommunicationNotificationMetadata(payload);
    const avatarUrl = communication?.avatarUrl ?? null;

    return {
      data,
      notification: silent
        ? undefined
        : { title, body, imageUrl: avatarUrl ?? undefined },
      webpush: {
        headers: { Urgency: "high" },
        notification: {
          body,
          requireInteraction: true,
          badge: "/badge-icon.png",
          icon: avatarUrl ?? undefined,
        },
      },
      android: {
        notification: {
          channelId: silent
            ? ""
            : clientApp === "mycove"
              ? "mycove_notifications"
              : "vybaa_notifications",
          imageUrl: avatarUrl ?? undefined,
          sound: silent ? undefined : "default",
        },
      },
      apns: {
        fcmOptions: avatarUrl ? { imageUrl: avatarUrl } : undefined,
        payload: {
          aps: {
            sound: silent ? undefined : "default",
            badge: 1,
            mutableContent: Boolean(communication),
          },
        },
      },
    };
  }

  /**
   * Send FCM push notification to multiple tokens
   * @param userFcmTokens Array of FCM tokens to send to
   * @param title Notification title
   * @param body Notification body
   * @param payload Additional data payload (notification ID, type, etc.)
   * @param silent If true, send as data-only notification (no visual notification)
   */
  async sendFCMPush(
    userFcmTokens: string[],
    title: string,
    body: string,
    payload: Record<string, unknown> = {},
    silent = false,
    clientApp: ClientApp = "vybaa",
  ) {
    if (!userFcmTokens || userFcmTokens.length === 0) {
      logger.debug("No FCM tokens provided, skipping push notification");
      return [];
    }

    const message = this.buildBaseMessage(
      clientApp,
      title,
      body,
      payload,
      silent,
    );

    const results = await Promise.allSettled(
      userFcmTokens.map(async (token: string) => {
        try {
          const result = await firebaseClient(clientApp)
            .messaging()
            .send({
              ...message,
              token,
            } as any);
          logger.debug("FCM push sent successfully", {
            token: token.substring(0, 20) + "...",
            result,
          });
          return { success: true, token, result };
        } catch (error: any) {
          console.log(error);

          logger.error("Failed to send FCM push", {
            token: token.substring(0, 20) + "...",
            error: error.message,
            code: error.code,
          });

          // Handle invalid tokens - they should be removed from database
          if (
            error.code === "messaging/invalid-registration-token" ||
            error.code === "messaging/registration-token-not-registered"
          ) {
            logger.warn("Invalid FCM token detected, should be removed", {
              token: token.substring(0, 20) + "...",
            });
          }

          return { success: false, token, error: error.message };
        }
      }),
    );

    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success,
    ).length;
    const failed = results.length - successful;

    if (failed > 0) {
      logger.warn("Some FCM pushes failed", {
        successful,
        failed,
        total: results.length,
      });
    } else {
      logger.info("All FCM pushes sent successfully", { count: successful });
    }

    return results.map((r) =>
      r.status === "fulfilled"
        ? r.value
        : { success: false, error: "Unknown error" },
    );
  }

  /**
   * Send a multicast message to up to 500 tokens at a time using Admin SDK sendEachForMulticast.
   * Automatically chunks if tokens > 500.
   */
  async sendFCMMulticast(
    userFcmTokens: string[],
    title: string,
    body: string,
    payload: Record<string, unknown> = {},
    silent = false,
    clientApp: ClientApp = "vybaa",
  ) {
    if (!userFcmTokens?.length) {
      logger.debug("No FCM tokens provided for multicast, skipping");
      return { successCount: 0, failureCount: 0, failedTokens: [] as string[] };
    }

    const chunkSize = 500;
    const base = this.buildBaseMessage(clientApp, title, body, payload, silent);
    const failedTokens: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < userFcmTokens.length; i += chunkSize) {
      const tokens = userFcmTokens.slice(i, i + chunkSize);
      try {
        const resp = await firebaseClient(clientApp)
          .messaging()
          .sendEachForMulticast({
            ...base,
            tokens,
          } as any);
        successCount += resp.successCount;
        failureCount += resp.failureCount;
        if (resp.failureCount > 0) {
          resp.responses.forEach((r, idx) => {
            if (!r.success) failedTokens.push(tokens[idx]!);
          });
        }
      } catch (error: any) {
        logger.error("Multicast send failed for chunk", {
          error: error?.message,
        });
        // Consider all in chunk failed
        failureCount += tokens.length;
        failedTokens.push(...tokens);
      }
    }

    if (failureCount > 0) {
      logger.warn("Multicast sends completed with failures", {
        successCount,
        failureCount,
      });
    } else {
      logger.info("Multicast sends completed successfully", { successCount });
    }

    return { successCount, failureCount, failedTokens };
  }

  /**
   * Send a customized list of up to 500 messages using sendEach.
   * Accepts per-recipient overrides (title/body/payload/silent).
   * Automatically chunks if >500.
   */
  async sendFCMBatchMessages(
    messages: Array<{
      clientApp?: ClientApp;
      token: string;
      title: string;
      body: string;
      payload?: Record<string, unknown>;
      silent?: boolean;
    }>,
  ) {
    if (!messages?.length)
      return { successCount: 0, failureCount: 0, failedTokens: [] as string[] };

    const messagesByClientApp = new Map<ClientApp, typeof messages>();
    for (const message of messages) {
      const clientApp = message.clientApp ?? "vybaa";
      const clientMessages = messagesByClientApp.get(clientApp) ?? [];
      clientMessages.push(message);
      messagesByClientApp.set(clientApp, clientMessages);
    }

    const chunkSize = 500;
    const failedTokens: string[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (const [clientApp, clientMessages] of messagesByClientApp) {
      for (let i = 0; i < clientMessages.length; i += chunkSize) {
        const chunk = clientMessages.slice(i, i + chunkSize);
        const built = chunk.map((message) => ({
          ...this.buildBaseMessage(
            clientApp,
            message.title,
            message.body,
            message.payload ?? {},
            message.silent ?? false,
          ),
          token: message.token,
        })) as any;
        try {
          const response = await firebaseClient(clientApp)
            .messaging()
            .sendEach(built);
          successCount += response.successCount;
          failureCount += response.failureCount;
          if (response.failureCount) {
            response.responses.forEach((result, index) => {
              if (!result.success) failedTokens.push(chunk[index]!.token);
            });
          }
        } catch (error: unknown) {
          logger.error("Batch sendEach failed for chunk", {
            clientApp,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          failureCount += chunk.length;
          failedTokens.push(...chunk.map((message) => message.token));
        }
      }
    }

    if (failureCount > 0) {
      logger.warn("Batch sendEach completed with failures", {
        successCount,
        failureCount,
      });
    } else {
      logger.info("Batch sendEach completed successfully", { successCount });
    }

    return { successCount, failureCount, failedTokens };
  }
}

export const pushNotificationService = new PushNotificationService();
