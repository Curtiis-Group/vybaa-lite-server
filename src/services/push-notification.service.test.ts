import assert from "node:assert/strict";
import test from "node:test";
import {
  getCommunicationNotificationMetadata,
  getNotificationSenderAvatarUrl,
  serializePushPayload,
} from "./push-notification.service";

const ARIEL_AVATAR_URL =
  "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/ariel";

test("flattens a nested notification route into FCM data", () => {
  assert.deepEqual(
    serializePushPayload({
      data: { route: "/app/r/rewind_123", type: "rewind_summary_ready" },
      id: "notification_123",
      message: "Your reflection is ready.",
      title: "Your Rewind summary is ready",
    }),
    {
      data: JSON.stringify({
        route: "/app/r/rewind_123",
        type: "rewind_summary_ready",
      }),
      id: "notification_123",
      message: "Your reflection is ready.",
      route: "/app/r/rewind_123",
      title: "Your Rewind summary is ready",
    },
  );
});

test("does not create a route field from unsafe notification data", () => {
  assert.deepEqual(
    serializePushPayload({
      data: { route: "https://untrusted.example" },
      id: "notification_456",
    }),
    {
      data: JSON.stringify({ route: "https://untrusted.example" }),
      id: "notification_456",
    },
  );
});

test("does not flatten a protocol-relative route", () => {
  assert.deepEqual(
    serializePushPayload({
      data: { route: "//untrusted.example/app/rewind" },
      id: "notification_789",
    }),
    {
      data: JSON.stringify({ route: "//untrusted.example/app/rewind" }),
      id: "notification_789",
    },
  );
});

test("reads the trusted actual chat sender avatar from notification data", () => {
  assert.equal(
    getNotificationSenderAvatarUrl({
      type: "rewind_chat_message",
      data: {
        chatId: "chat-1",
        notificationSender: {
          avatarUrl: ARIEL_AVATAR_URL,
          name: "Ariel",
          personaId: "ariel",
        },
      },
    }),
    ARIEL_AVATAR_URL,
  );
});

test("flattens communication metadata for the native iOS extension", () => {
  const payload = {
    data: {
      chatId: "chat-1",
      notificationSender: {
        avatarUrl: ARIEL_AVATAR_URL,
        name: "Ariel",
        personaId: "ariel",
      },
    },
    message: "hey, u around?",
    title: "Ariel",
    type: "rewind_chat_message",
  };

  assert.deepEqual(getCommunicationNotificationMetadata(payload), {
    avatarUrl: ARIEL_AVATAR_URL,
    conversationId: "chat-1",
    senderId: "ariel",
    senderName: "Ariel",
  });
  assert.deepEqual(serializePushPayload(payload), {
    avatarUrl: ARIEL_AVATAR_URL,
    conversationId: "chat-1",
    data: JSON.stringify(payload.data),
    message: "hey, u around?",
    senderId: "ariel",
    senderName: "Ariel",
    title: "Ariel",
    type: "rewind_chat_message",
  });
});

test("does not attach partner imagery to a non-message notification", () => {
  assert.equal(
    getNotificationSenderAvatarUrl({
      data: {
        chatId: "chat-1",
        notificationSender: {
          avatarUrl: ARIEL_AVATAR_URL,
          name: "Ariel",
          personaId: "ariel",
        },
      },
      type: "system",
    }),
    null,
  );
});

test("does not attach an untrusted notification image", () => {
  assert.equal(
    getNotificationSenderAvatarUrl({
      type: "rewind_chat_message",
      data: JSON.stringify({
        chatId: "chat-1",
        notificationSender: {
          avatarUrl: "https://tracker.example/avatar.png",
          name: "Ariel",
          personaId: "ariel",
        },
      }),
    }),
    null,
  );
});
