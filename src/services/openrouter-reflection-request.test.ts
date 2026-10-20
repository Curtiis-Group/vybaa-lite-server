import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import {
  RewindCompletionSource,
  RewindSessionStatus,
  RewindTurnRole,
} from "@prisma/client";
import type { RewindSession } from "@prisma/client";

import {
  AI_TEXT_FEATURE,
  getAiTextProviderConfig,
} from "../config/ai-provider.config";
import { prisma } from "../config/db.config";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";
import { generateOpenRouterText } from "./openrouter-text.service";
import { generateRewindReflection } from "./rewind-reflection.service";
import { finalizeRewindSession } from "./rewind-session-finalization.service";

const reflection = {
  summary: "A quiet walk helped the user feel calmer.",
  emotionalInsight: "A little space felt useful.",
  journalDraft: "I felt calmer after my walk.",
  emotionalTags: ["calm"],
  currentMood: "calm",
  comparisonInsight: null,
  nextStepNote: null,
  wellbeingSignals: {
    emotionalSteadiness: 60,
    energy: 60,
    clarity: 60,
    connection: 60,
    agency: 60,
  },
};
const providerError = {
  error: {
    code: 400,
    message: "Provider returned error",
    metadata: {
      provider_name: "Azure",
      provider_error_code: "invalid_json_schema",
      raw: JSON.stringify({
        error: {
          code: "invalid_json_schema",
          param: "text.format.schema",
          message: "Invalid schema. Missing 'comparisonInsight'.",
          privatePrompt: "DO_NOT_LOG_THIS",
          apiKey: "DO_NOT_LOG_THIS",
        },
      }),
    },
  },
};

function setup(context: TestContext) {
  const originalKey = Env.OPENROUTER_API_KEY;
  Env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  context.after(() => {
    Env.OPENROUTER_API_KEY = originalKey;
  });
  context.mock.method(logger, "info", () => logger);
  const errorContexts: unknown[] = [];
  context.mock.method(logger, "error", (...args: unknown[]) => {
    errorContexts.push(args[1]);
    return logger;
  });
  return { errorContexts };
}

function successResponse(): Response {
  return Response.json({
    id: "completion",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(reflection) },
      },
    ],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStrictSchema(schema: unknown): void {
  assert.ok(isRecord(schema));
  if (schema.type === "object") {
    assert.ok(isRecord(schema.properties));
    assert.ok(Array.isArray(schema.required));
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(
      [...schema.required].sort(),
      Object.keys(schema.properties).sort(),
    );
    for (const property of Object.values(schema.properties))
      assertStrictSchema(property);
  }
  if (schema.type === "array") assertStrictSchema(schema.items);
}

test("Rewind sends a valid strict schema with every nullable field required", async (context) => {
  setup(context);
  const request = context.mock.method(
    globalThis,
    "fetch",
    async (_input: unknown, init?: RequestInit) => {
      assert.equal(typeof init?.body, "string");
      if (typeof init?.body !== "string") throw new Error("Expected JSON body");
      const body: unknown = JSON.parse(init.body);
      assert.ok(isRecord(body));
      assert.equal(
        body.model,
        getAiTextProviderConfig(AI_TEXT_FEATURE.REWIND_REFLECTION).model,
      );
      assert.ok(
        isRecord(body.response_format) &&
          isRecord(body.response_format.json_schema),
      );
      assert.equal(body.response_format.json_schema.strict, true);
      assertStrictSchema(body.response_format.json_schema.schema);
      return successResponse();
    },
  );
  const result = await generateRewindReflection({
    personaName: "Ella",
    previousSummaries: [],
    journalEntries: [],
    transcript: [
      { role: "user", content: "A quiet walk helped me feel calmer." },
    ],
  });
  assert.deepEqual(result, reflection);
  assert.equal(request.mock.callCount(), 1);
});

test("provider schema errors log actionable fields without dumping raw bodies or prompts", async (context) => {
  const { errorContexts } = setup(context);
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(providerError, { status: 400 }),
  );
  await assert.rejects(
    generateOpenRouterText({
      feature: AI_TEXT_FEATURE.REWIND_REFLECTION,
      prompt: "DO_NOT_LOG_THIS",
    }),
  );
  const entry = errorContexts[0];
  assert.ok(isRecord(entry));
  assert.deepEqual(entry, {
    providerName: "Azure",
    providerErrorCode: "invalid_json_schema",
    providerParameter: "text.format.schema",
    schemaMissingField: "comparisonInsight",
    errorMessage: "400 Provider returned error",
    errorName: "Error",
    providerStatus: 400,
    durationMs: entry.durationMs,
    feature: AI_TEXT_FEATURE.REWIND_REFLECTION,
    model: getAiTextProviderConfig(AI_TEXT_FEATURE.REWIND_REFLECTION).model,
    provider: "openrouter",
    stream: false,
  });
  assert.equal(JSON.stringify(entry).includes("DO_NOT_LOG_THIS"), false);
});

test("a provider rejection preserves saved answers, releases finalization and allows retry", async (context) => {
  setup(context);
  const responses = {
    kind: "questionnaire",
    answers: [{ text: "A quiet walk helped me feel calmer." }],
  };
  const session: Pick<
    RewindSession,
    | "id"
    | "userId"
    | "personaId"
    | "isTestSession"
    | "responses"
    | "sessionDateKey"
    | "timezone"
    | "status"
    | "completed"
    | "summary"
    | "emotionalInsight"
    | "wellbeingSignals"
  > = {
    id: "session",
    userId: "owner",
    personaId: "ella",
    isTestSession: true,
    responses,
    sessionDateKey: "2026-10-18",
    timezone: "Africa/Lagos",
    status: RewindSessionStatus.IN_PROGRESS,
    completed: false,
    summary: null,
    emotionalInsight: null,
    wellbeingSignals: null,
  };
  const turns = [
    {
      role: RewindTurnRole.USER,
      content: "A quiet walk helped me feel calmer.",
    },
  ];
  const originals = {
    session: {
      findUnique: prisma.rewindSession.findUnique,
      findMany: prisma.rewindSession.findMany,
      updateMany: prisma.rewindSession.updateMany,
      update: prisma.rewindSession.update,
    },
    journal: prisma.journal.findMany,
    turn: prisma.rewindTurn.findMany,
    routine: prisma.rewindRoutine.findUnique,
    user: prisma.user.findUnique,
    activity: prisma.activitySignal.findMany,
    observation: prisma.dailyObservation.findUnique,
  };
  Object.assign(prisma.rewindSession, {
    findUnique: async () => ({ ...session }),
    findMany: async () => [],
    updateMany: async ({ data }: { data: { status: RewindSessionStatus } }) => {
      session.status = data.status;
      return { count: 1 };
    },
    update: async () => {
      session.status = RewindSessionStatus.COMPLETED;
      session.completed = true;
      return session;
    },
  });
  Object.assign(prisma.journal, { findMany: async () => [] });
  Object.assign(prisma.rewindTurn, { findMany: async () => turns });
  Object.assign(prisma.rewindRoutine, { findUnique: async () => null });
  Object.assign(prisma.user, {
    findUnique: async () => ({ rewindPersonalizationEnabled: false }),
  });
  Object.assign(prisma.activitySignal, { findMany: async () => [] });
  Object.assign(prisma.dailyObservation, { findUnique: async () => null });
  context.after(() => {
    Object.assign(prisma.rewindSession, originals.session);
    Object.assign(prisma.journal, { findMany: originals.journal });
    Object.assign(prisma.rewindTurn, { findMany: originals.turn });
    Object.assign(prisma.rewindRoutine, { findUnique: originals.routine });
    Object.assign(prisma.user, { findUnique: originals.user });
    Object.assign(prisma.activitySignal, { findMany: originals.activity });
    Object.assign(prisma.dailyObservation, {
      findUnique: originals.observation,
    });
  });
  let attempts = 0;
  context.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    return attempts === 1
      ? Response.json(providerError, { status: 400 })
      : successResponse();
  });
  const params = { sessionId: session.id, source: RewindCompletionSource.USER };
  await assert.rejects(finalizeRewindSession(params));
  assert.equal(session.status, RewindSessionStatus.IN_PROGRESS);
  assert.deepEqual(session.responses, responses);
  assert.equal(session.completed, false);
  assert.equal((await finalizeRewindSession(params)).status, "completed");
  assert.deepEqual(session.responses, responses);
  assert.equal(attempts, 2);
});
