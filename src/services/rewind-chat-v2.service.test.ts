import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRewindRelationshipDelta,
  constrainImmediateRelationshipSoftening,
  decayRewindRelationshipState,
  getRewindBetweenWavesDelayMs,
  getRewindDeliveredToSeenDelayMs,
  getRewindSeenToTypingDelayMs,
  getRewindWaveTypingDelays,
  parseRewindDirectorResponse,
  parseRewindPartnerResponse,
  resolveRewindDirectorDecision,
} from "./rewind-chat-v2.service";

const DIRECTOR_FALLBACK = {
  nextConsiderInMinutes: 180,
  reactions: [],
  turns: [],
};

function createPartnerResponse(message: string): string {
  return JSON.stringify({
    message,
    reaction: null,
    relationshipDelta: {
      anger: 0,
      hate: 0,
      jealousy: 0,
      love: 0,
      malice: 0,
    },
    relationshipMemory: null,
  });
}

test("v2 director accepts one bare JSON object with all four unique partners", () => {
  const response = JSON.stringify({
    nextConsiderInMinutes: 75,
    reactions: [
      { kind: "LOVE", messageId: "message-user", personaId: "ella" },
      { kind: "LAUGH", messageId: "message-user", personaId: "lyra" },
      { kind: "CRY", messageId: "message-user", personaId: "jake" },
      { kind: "LIKE", messageId: "message-user", personaId: "ariel" },
    ],
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
    reactions: [
      { kind: "LOVE", messageId: "message-user", personaId: "ella" },
      { kind: "LAUGH", messageId: "message-user", personaId: "lyra" },
      { kind: "CRY", messageId: "message-user", personaId: "jake" },
      { kind: "LIKE", messageId: "message-user", personaId: "ariel" },
    ],
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
    reactions: [],
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
      reactions: [],
      turns: [],
    }),
    JSON.stringify({
      nextConsiderInMinutes: 90,
      reactions: [],
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
      reactions: [],
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
      reactions: [],
      turns: [
        {
          intent: "   ",
          personaId: "ella",
          replyToMessageId: null,
        },
      ],
    }),
    JSON.stringify({
      nextConsiderInMinutes: 90,
      reactions: [{ kind: "FIRE", messageId: "message-1", personaId: "ella" }],
      turns: [],
    }),
    JSON.stringify({
      nextConsiderInMinutes: 90,
      reactions: [
        { kind: "LIKE", messageId: "message-1", personaId: "ella" },
        { kind: "LOVE", messageId: "message-1", personaId: "ella" },
      ],
      turns: [],
    }),
  ];

  for (const response of malformedResponses) {
    assert.deepEqual(parseRewindDirectorResponse(response), DIRECTOR_FALLBACK);
  }
});

test("v2 partner accepts exact JSON and normalizes its message", () => {
  assert.deepEqual(
    parseRewindPartnerResponse(
      createPartnerResponse("  That   does not add up.\nAsk @Jake.  "),
    ),
    {
      message: "That does not add up. Ask @Jake.",
      reaction: null,
      relationshipDelta: {
        anger: 0,
        hate: 0,
        jealousy: 0,
        love: 0,
        malice: 0,
      },
      relationshipMemory: null,
    },
  );
  assert.equal(
    parseRewindPartnerResponse(
      createPartnerResponse("Write it down before you forget."),
    ).message,
    "Write it down before you forget.",
  );
  assert.equal(
    parseRewindPartnerResponse(createPartnerResponse("Fair point 😅")).message,
    "Fair point 😅",
  );
});

test("v2 partner accepts only four bounded reactions and slow feeling deltas", () => {
  const parsed = parseRewindPartnerResponse(
    JSON.stringify({
      message: "nah, that actually hurt 😭",
      reaction: { kind: "CRY", messageId: "message-user-1" },
      relationshipDelta: {
        anger: 5,
        hate: 1,
        jealousy: 0,
        love: -2,
        malice: 1,
      },
      relationshipMemory: "The user's dismissal still feels unresolved.",
    }),
  );
  assert.equal(parsed.reaction?.kind, "CRY");
  assert.equal(parsed.relationshipDelta.anger, 5);
  assert.equal(
    parsed.relationshipMemory,
    "The user's dismissal still feels unresolved.",
  );

  const invalidKinds = ["ANGRY", "FIRE", "SAD", "HEART"];
  for (const kind of invalidKinds) {
    assert.throws(() =>
      parseRewindPartnerResponse(
        JSON.stringify({
          message: "nope",
          reaction: { kind, messageId: "message-user-1" },
          relationshipDelta: {
            anger: 0,
            hate: 0,
            jealousy: 0,
            love: 0,
            malice: 0,
          },
          relationshipMemory: null,
        }),
      ),
    );
  }
});

test("relationship feelings persist across minutes and decay on long horizons", () => {
  const state = { anger: 50, hate: 30, jealousy: 20, love: 70, malice: 10 };
  const startedAt = new Date("2026-09-05T10:00:00.000Z");
  assert.deepEqual(
    decayRewindRelationshipState(
      state,
      startedAt,
      new Date("2026-09-05T10:05:00.000Z"),
    ),
    state,
  );
  assert.deepEqual(
    decayRewindRelationshipState(
      state,
      startedAt,
      new Date("2026-09-19T10:00:00.000Z"),
    ),
    { anger: 36, hate: 29, jealousy: 16, love: 70, malice: 8 },
  );
  assert.deepEqual(
    applyRewindRelationshipDelta(state, {
      anger: 8,
      hate: 3,
      jealousy: 5,
      love: -6,
      malice: 3,
    }),
    { anger: 58, hate: 33, jealousy: 25, love: 64, malice: 13 },
  );
  const apologyDelta = {
    anger: -4,
    hate: -2,
    jealousy: -3,
    love: 6,
    malice: -2,
  };
  assert.deepEqual(
    constrainImmediateRelationshipSoftening(
      apologyDelta,
      startedAt,
      new Date("2026-09-05T10:05:00.000Z"),
    ),
    { anger: 0, hate: 0, jealousy: 0, love: 0, malice: 0 },
  );
  assert.deepEqual(
    constrainImmediateRelationshipSoftening(
      apologyDelta,
      startedAt,
      new Date("2026-09-05T17:00:00.000Z"),
    ),
    apologyDelta,
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
    createPartnerResponse("x".repeat(1_201)),
    createPartnerResponse("x".repeat(421)),
    createPartnerResponse("2. **Analyze the user's response."),
    createPartnerResponse('") as Lyra.'),
    createPartnerResponse("* Wait, `"),
    createPartnerResponse("Director intent: reassure the user."),
    createPartnerResponse("we should talk — later"),
    JSON.stringify({
      message: "no",
      reaction: null,
      relationshipDelta: {
        anger: 99,
        hate: 0,
        jealousy: 0,
        love: 0,
        malice: 0,
      },
      relationshipMemory: null,
    }),
  ];

  for (const response of malformedResponses) {
    assert.throws(() => parseRewindPartnerResponse(response));
  }
});

test("v2 seen-to-typing jitter always stays within the intended range", () => {
  for (let sample = 0; sample < 1_000; sample += 1) {
    const deliveredToSeenDelay = getRewindDeliveredToSeenDelayMs();
    const delay = getRewindSeenToTypingDelayMs();
    const betweenWavesDelay = getRewindBetweenWavesDelayMs();
    assert.ok(deliveredToSeenDelay >= 650);
    assert.ok(deliveredToSeenDelay <= 1_800);
    assert.ok(delay >= 650);
    assert.ok(delay <= 1_900);
    assert.ok(betweenWavesDelay >= 900);
    assert.ok(betweenWavesDelay <= 2_200);

    const waveDelays = getRewindWaveTypingDelays(4);
    assert.equal(waveDelays.length, 4);
    assert.ok((waveDelays[0] ?? 0) >= 650);
    assert.ok((waveDelays[0] ?? 0) <= 1_900);
    for (let index = 1; index < waveDelays.length; index += 1) {
      const stagger = (waveDelays[index] ?? 0) - (waveDelays[index - 1] ?? 0);
      assert.ok(stagger >= 550);
      assert.ok(stagger <= 1_400);
    }
  }
});

test("v2 director fallback excludes the latest speaker and preserves reply context", () => {
  const decision = resolveRewindDirectorDecision({
    allowed: ["ella", "lyra", "jake", "ariel"],
    decision: {
      nextConsiderInMinutes: 60,
      reactions: [],
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
    reactions: [],
    turns: [
      {
        intent: "Answer Lyra's point directly.",
        personaId: "jake",
        replyToMessageId: "message-latest",
      },
    ],
  });
});
