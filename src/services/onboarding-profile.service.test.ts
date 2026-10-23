import assert from "node:assert/strict";
import test from "node:test";
import { ONBOARDING_QUESTIONS } from "../config/onboarding-questionnaire.config";
import { onboardingProfileInputSchema } from "../validators/onboarding-profile.validators";
import {
  formatOnboardingPreferences,
  parseOnboardingProfile,
  saveOnboardingProfile,
} from "./onboarding-profile.service";
import { prisma } from "../config/db.config";
import type { TestContext } from "node:test";

function mockUserMethod(
  context: TestContext,
  method: "findUniqueOrThrow" | "updateMany",
  implementation: (...args: never[]) => unknown,
) {
  const original = prisma.user[method];
  const mock = context.mock.fn(implementation);
  Object.assign(prisma.user, { [method]: mock });
  context.after(() => Object.assign(prisma.user, { [method]: original }));
  return mock;
}

const profile = {
  version: 1,
  revision: 0,
  skipped: false,
  answers: [
    {
      questionId: "stress",
      choices: ["Go quiet for a while"],
      customText: "Give me a moment before advice",
    },
  ],
} as const;
function candidate() {
  return JSON.parse(JSON.stringify(profile));
}

test("onboarding covers behaviour, temperament, support and boundaries without scoring", () => {
  assert.equal(ONBOARDING_QUESTIONS.length, 13);
  assert.equal(
    new Set(ONBOARDING_QUESTIONS.map((question) => question.id)).size,
    13,
  );
  for (const question of ONBOARDING_QUESTIONS) {
    assert.ok(question.options.length >= 4);
    assert.equal(new Set(question.options).size, question.options.length);
  }
  assert.ok(
    ONBOARDING_QUESTIONS.some((question) => question.id === "boundaries"),
  );
  assert.equal(
    onboardingProfileInputSchema.safeParse(candidate()).success,
    true,
  );
});

test("onboarding validates question ownership, options, bounds and uniqueness", () => {
  for (const answer of [
    { questionId: "unknown", choices: ["Yes"], customText: "" },
    { questionId: "stress", choices: ["Invented"], customText: "" },
    {
      questionId: "stress",
      choices: ["Talk it through", "Go quiet for a while"],
      customText: "",
    },
    {
      questionId: "priorities",
      choices: ["Feeling more settled", "Feeling more settled"],
      customText: "",
    },
    { questionId: "stress", choices: [], customText: "x".repeat(501) },
    { questionId: "stress", choices: [], customText: "" },
  ])
    assert.equal(
      onboardingProfileInputSchema.safeParse({
        ...candidate(),
        answers: [answer],
      }).success,
      false,
    );
  const data = candidate();
  assert.equal(
    onboardingProfileInputSchema.safeParse({
      ...data,
      answers: [...data.answers, ...data.answers],
    }).success,
    false,
  );
  assert.equal(
    onboardingProfileInputSchema.safeParse({ ...data, skipped: true }).success,
    false,
  );
  assert.equal(
    onboardingProfileInputSchema.safeParse({ ...data, revision: -1 }).success,
    false,
  );
  assert.equal(
    onboardingProfileInputSchema.safeParse({
      ...data,
      skipped: true,
      answers: [],
    }).success,
    true,
  );
});

test("preferences remain self-reported, bounded data, not diagnoses or mutation consent", () => {
  assert.equal(formatOnboardingPreferences(null), "");
  assert.equal(
    formatOnboardingPreferences({
      version: 1,
      revision: 1,
      skipped: true,
      answers: [],
    }),
    "",
  );
  const text = formatOnboardingPreferences(candidate());
  assert.match(text, /not diagnoses/);
  assert.match(text, /Go quiet for a while/);
  assert.match(text, /do not authorize tasks/);
  assert.ok(text.length <= 5000);
  assert.equal(parseOnboardingProfile({ bad: true }), null);
});

test("save is owner-bound, revision-checked and atomically completes onboarding", async (context) => {
  const input = onboardingProfileInputSchema.parse(candidate());
  const reads = mockUserMethod(context, "findUniqueOrThrow", async () => ({
    onboardingProfile: null,
  }));
  const writes = mockUserMethod(context, "updateMany", async () => ({
    count: 1,
  }));
  await saveOnboardingProfile("owner", input);
  assert.equal(reads.mock.calls[0]?.arguments[0]?.where.id, "owner");
  const write = writes.mock.calls[0]?.arguments[0];
  assert.equal(write?.where?.id, "owner");
  assert.equal(write?.data.isFirstTime, false);
  assert.deepEqual(write?.data.onboardingProfile, { ...input, revision: 1 });
});

test("stale and concurrent writes cannot replace saved answers", async (context) => {
  const input = onboardingProfileInputSchema.parse(candidate());
  mockUserMethod(context, "findUniqueOrThrow", async () => ({
    onboardingProfile: { ...input, revision: 2 },
  }));
  const writes = mockUserMethod(context, "updateMany", async () => ({
    count: 0,
  }));
  await assert.rejects(saveOnboardingProfile("owner", input), /another device/);
  assert.equal(writes.mock.callCount(), 0);
  await assert.rejects(
    saveOnboardingProfile("owner", { ...input, revision: 2 }),
    /changed/,
  );
});
