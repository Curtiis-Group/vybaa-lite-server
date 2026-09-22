import assert from "node:assert/strict";
import test from "node:test";
import {
  isActiveRewindChatSubscription,
  personalizeRewindNotification,
  prepareRewindChatNotificationForAccess,
} from "./rewind-notification-personalization.util";

test("keeps paid Rewind chat notifications actionable", () => {
  const input = {
    data: { chatId: "chat-1", route: "/app/rewind-chat/chat-1" },
    isPro: true,
    message: "I noticed something about your day.",
    title: "Ella sent you a message",
  };

  assert.deepEqual(prepareRewindChatNotificationForAccess(input), {
    data: input.data,
    message: input.message,
    title: input.title,
  });
});

test("turns free Rewind chat notifications into honest upgrade previews", () => {
  const result = prepareRewindChatNotificationForAccess({
    data: {
      chatId: "chat-1",
      messageId: "message-1",
      route: "/app/rewind-chat/chat-1",
    },
    isPro: false,
    message:
      "I noticed something important about the way you handled that difficult conversation today, and I think it is worth revisiting together.",
    title: "Ella sent you a message",
  });

  assert.equal(result.data?.route, "/app/rewind-chats");
  assert.equal(result.data?.requiresPro, true);
  assert.equal(result.data?.upgradeFeature, "rewind-chats");
  assert.match(result.message, /Upgrade to open Discussions and reply\.$/);
  assert.ok(result.message.length <= 120);
});

test("treats missing, inactive, and expired snapshots as free", () => {
  const now = new Date("2026-09-22T12:00:00.000Z");

  assert.equal(isActiveRewindChatSubscription(null, now), false);
  assert.equal(
    isActiveRewindChatSubscription({ expiresAt: null, isPro: false }, now),
    false,
  );
  assert.equal(
    isActiveRewindChatSubscription(
      {
        expiresAt: new Date("2026-09-22T11:59:59.000Z"),
        isPro: true,
      },
      now,
    ),
    false,
  );
  assert.equal(
    isActiveRewindChatSubscription(
      {
        expiresAt: new Date("2026-09-22T12:00:01.000Z"),
        isPro: true,
      },
      now,
    ),
    true,
  );
  assert.equal(
    isActiveRewindChatSubscription({ expiresAt: null, isPro: true }, now),
    true,
  );
});

test("leaves generic notification copy unchanged without a selected partner", () => {
  const input = {
    data: { route: "/app/home" },
    message: "Your daily summary is ready.",
    selectedPersonaId: null,
    title: "Daily summary",
    type: "system",
  };

  assert.deepEqual(personalizeRewindNotification(input), {
    data: input.data,
    message: input.message,
    title: input.title,
  });
});

test("uses the selected partner's voice without exposing their identity", () => {
  const base = {
    data: { route: "/app/home" },
    message: "Your end-of-day summary is ready.",
    title: "End-of-Day Summary",
    type: "system",
  };

  const presentations = [
    personalizeRewindNotification({ ...base, selectedPersonaId: "ella" }),
    personalizeRewindNotification({ ...base, selectedPersonaId: "lyra" }),
    personalizeRewindNotification({ ...base, selectedPersonaId: "jake" }),
    personalizeRewindNotification({ ...base, selectedPersonaId: "ariel" }),
    personalizeRewindNotification({ ...base, selectedPersonaId: "tobi" }),
    personalizeRewindNotification({ ...base, selectedPersonaId: "neeja" }),
  ];

  assert.deepEqual(
    presentations.map(({ message, title }) => ({ message, title })),
    [
      {
        message: "your end-of-day summary is ready. 👀",
        title: "End-of-Day Summary",
      },
      {
        message: "btw, your end-of-day summary is ready.",
        title: "End-of-Day Summary",
      },
      {
        message: "heads up. your end-of-day summary is ready.",
        title: "End-of-Day Summary",
      },
      {
        message: "hey, your end-of-day summary is ready.",
        title: "End-of-Day Summary",
      },
      {
        message: "yo, your end-of-day summary is ready.",
        title: "End-of-Day Summary",
      },
      {
        message: "btw, your end-of-day summary is ready. 👀",
        title: "End-of-Day Summary",
      },
    ],
  );
  assert.deepEqual(presentations[1]?.data, base.data);
});

test("uses the actual message sender regardless of the selected partner", () => {
  assert.deepEqual(
    personalizeRewindNotification({
      data: {
        chatId: "chat-1",
        sourcePersonaId: "ella",
      },
      message: "u still awake? 👀",
      selectedPersonaId: "jake",
      title: "Ella sent you a message",
      type: "rewind_chat_message",
    }),
    {
      data: {
        chatId: "chat-1",
        notificationSender: {
          avatarUrl:
            "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/ella",
          name: "Ella",
          personaId: "ella",
        },
        sourcePersonaId: "ella",
      },
      message: "u still awake? 👀",
      title: "Ella",
    },
  );
});

test("labels a locked partner preview as Vybaa Pro", () => {
  const result = personalizeRewindNotification({
    data: {
      requiresPro: true,
      route: "/app/rewind-chats",
      sourcePersonaId: "ella",
    },
    message: "I noticed something. · Upgrade to open Discussions and reply.",
    selectedPersonaId: "jake",
    title: "Ella sent you a message",
    type: "rewind_chat_message",
  });

  assert.equal(result.title, "Ella · Vybaa Pro");
  assert.equal(result.data?.route, "/app/rewind-chats");
  assert.deepEqual(result.data?.notificationSender, {
    avatarUrl:
      "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/ella",
    name: "Ella",
    personaId: "ella",
  });
});

test("does not rewrite a selected partner's own chat message", () => {
  const result = personalizeRewindNotification({
    data: { sourcePersonaId: "ariel" },
    message: "hey, u good?",
    selectedPersonaId: "ariel",
    title: "Ariel sent you a message",
    type: "rewind_chat_message",
  });

  assert.equal(result.title, "Ariel");
  assert.equal(result.message, "hey, u good?");
  assert.deepEqual(result.data?.notificationSender, {
    avatarUrl:
      "https://res.cloudinary.com/dqdtazdda/image/upload/c_fill,f_png,g_auto,h_256,q_auto:good,w_256/v1/vybaa/rewind/partners/ariel",
    name: "Ariel",
    personaId: "ariel",
  });
});
