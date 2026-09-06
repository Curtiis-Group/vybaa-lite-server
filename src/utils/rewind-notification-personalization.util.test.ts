import assert from "node:assert/strict";
import test from "node:test";
import { personalizeRewindNotification } from "./rewind-notification-personalization.util";

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
