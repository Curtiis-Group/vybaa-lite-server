import assert from "node:assert/strict";
import test from "node:test";

import {
  getRewindSeenToTypingDelayMs,
  parseRewindDirectorResponse,
  parseRewindPartnerResponse,
  resolveRewindDirectorDecision,
} from "./rewind-chat-v2.service";

const DIRECTOR_FALLBACK = {
  nextConsiderInMinutes: 180,
  turns: [],
};

test("v2 director accepts one bare JSON object with all four unique partners", () => {
  const response = JSON.stringify({
    nextConsiderInMinutes: 75,
    turns: [
      {
        intent: "Name the emotional stakes without softening them.",
        personaId: "ella",
        replyToMessageId: null,
      },
      {
        intent: "Give a calm, dry read of the situation.",
        personaId: "lyra",
        replyToMessageId: "message-ella",
      },
      {
        intent: "Call out the contradiction directly.",
        personaId: "jake",
        replyToMessageId: "message-lyra",
      },
      {
        intent: "Offer a practical next step and reality check.",
        personaId: "ariel",
        replyToMessageId: "message-jake",
      },
    ],
  });

  assert.deepEqual(parseRewindDirectorResponse(response), {
    nextConsiderInMinutes: 75,
    turns: [
      {
        intent: "Name the emotional stakes without softening them.",
        personaId: "ella",
        replyToMessageId: null,
      },
      {
        intent: "Give a calm, dry read of the situation.",
        personaId: "lyra",
        replyToMessageId: "message-ella",
      },
      {
        intent: "Call out the contradiction directly.",
        personaId: "jake",
        replyToMessageId: "message-lyra",
      },
      {
        intent: "Offer a practical next step and reality check.",
        personaId: "ariel",
        replyToMessageId: "message-jake",
      },
    ],
  });
});

test("v2 director rejects anything other than its exact bare JSON shape", () => {
  const validDecision = JSON.stringify({
    nextConsiderInMinutes: 90,
    turns: [
      {
        intent: "Respond naturally.",
        personaId: "ella",
        replyToMessageId: null,
      },
    ],
  });
  const malformedResponses = [
    `\`\`\`json\n${validDecision}\n\`\`\``,
    `Here is the decision: ${validDecision}`,
    `${validDecision} trailing prose`,
    '{"nextConsiderInMinutes":90,"turns":[],}',
    "[]",
    "null",
    JSON.stringify({
      extra: true,
      nextConsiderInMinutes: 90,
      turns: [],
    }),
    JSON.stringify({
      nextConsiderInMinutes: 90,
      turns: [
        {
          extra: true,
          intent: "Respond naturally.",
          personaId: "ella",
          replyToMessageId: null,
        },
      ],
    }),
    JSON.stringify({
      nextConsiderInMinutes: 90,
      turns: [
        {
          intent: "Take the first angle.",
          personaId: "ella",
          replyToMessageId: null,
        },
        {
          intent: "Repeat the same persona.",
          personaId: "ella",
          replyToMessageId: null,
        },
      ],
    }),
    JSON.stringify({
      nextConsiderInMinutes: 90,
      turns: [
        {
          intent: "   ",
          personaId: "ella",
          replyToMessageId: null,
        },
      ],
    }),
  ];

  for (const response of malformedResponses) {
    assert.deepEqual(parseRewindDirectorResponse(response), DIRECTOR_FALLBACK);
  }
});

test("v2 partner accepts exact JSON and normalizes its message", () => {
  assert.equal(
    parseRewindPartnerResponse(
      JSON.stringify({ message: "  That   does not add up.\nAsk @Jake.  " }),
    ),
    "That does not add up. Ask @Jake.",
  );
  assert.equal(
    parseRewindPartnerResponse(
      JSON.stringify({ message: "Write it down before you forget." }),
    ),
    "Write it down before you forget.",
  );
  assert.equal(
    parseRewindPartnerResponse(JSON.stringify({ message: "Fair point 😅" })),
    "Fair point 😅",
  );
});

test("v2 partner rejects malformed, wrapped, extra, empty, and overlong output", () => {
  const malformedResponses = [
    "not JSON",
    "null",
    "[]",
    '```json\n{"message":"No."}\n```',
    'Here is my reply: {"message":"No."}',
    '{"message":"No."} trailing prose',
    JSON.stringify({ extra: true, message: "No." }),
    JSON.stringify({ message: 42 }),
    JSON.stringify({ message: "   " }),
    JSON.stringify({ message: "x".repeat(1_201) }),
    JSON.stringify({ message: "x".repeat(421) }),
    JSON.stringify({ message: "2. **Analyze the user's response." }),
    JSON.stringify({ message: '") as Lyra.' }),
    JSON.stringify({ message: "* Wait, `" }),
    JSON.stringify({ message: "Director intent: reassure the user." }),
  ];

  for (const response of malformedResponses) {
    assert.throws(() => parseRewindPartnerResponse(response));
  }
});

test("v2 seen-to-typing jitter always stays within the intended range", () => {
  for (let sample = 0; sample < 1_000; sample += 1) {
    const delay = getRewindSeenToTypingDelayMs();
    assert.ok(delay >= 450);
    assert.ok(delay <= 1_400);
  }
});

test("v2 director fallback excludes the latest speaker and preserves reply context", () => {
  const decision = resolveRewindDirectorDecision({
    allowed: ["ella", "lyra", "jake", "ariel"],
    decision: {
      nextConsiderInMinutes: 60,
      turns: [
        {
          intent: "Lyra should continue her own thought.",
          personaId: "lyra",
          replyToMessageId: "message-latest",
        },
      ],
    },
    excludedPersonas: ["lyra"],
    fallbackIntent: "Answer Lyra's point directly.",
    fallbackReplyToMessageId: "message-latest",
    mentions: ["lyra", "jake"],
    minimumTurns: 1,
    roomEnergy: [
      { energy: 99, personaId: "ella" },
      { energy: 10, personaId: "jake" },
    ],
  });

  assert.deepEqual(decision, {
    nextConsiderInMinutes: 60,
    turns: [
      {
        intent: "Answer Lyra's point directly.",
        personaId: "jake",
        replyToMessageId: "message-latest",
      },
    ],
  });
});
