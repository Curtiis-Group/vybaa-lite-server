import assert from "node:assert/strict";
import test from "node:test";
import { CURRENT_TERMS_VERSION } from "../constants/legal.constants";
import { loginSchema } from "./auth.validators";
import {
  createCommunitySchema,
  createTemplateSchema,
} from "./community.validators";
import {
  blockUserSchema,
  moderationEvidenceSchema,
} from "./moderation.validators";

test("authentication requires current explicit terms consent", () => {
  const base = { email: "friend@example.com", password: "password" };
  assert.equal(loginSchema.safeParse(base).success, false);
  assert.equal(
    loginSchema.safeParse({
      ...base,
      acceptedTerms: true,
      termsVersion: CURRENT_TERMS_VERSION,
    }).success,
    true,
  );
});

test("shared community fields reject objectionable content", () => {
  assert.equal(
    createCommunitySchema.safeParse({ name: "I will hurt you" }).success,
    false,
  );
  assert.equal(
    createTemplateSchema.safeParse({ goalText: "send nudes", targetDays: 2 })
      .success,
    false,
  );
});

test("reports require a reason and bounded target", () => {
  assert.equal(
    moderationEvidenceSchema.safeParse({
      reason: "harassment",
      targetId: "activity-1",
      targetType: "activity",
    }).success,
    true,
  );
  assert.equal(
    moderationEvidenceSchema.safeParse({
      reason: "unknown",
      targetId: "activity-1",
      targetType: "activity",
    }).success,
    false,
  );
});

test("block evidence must provide target type and id together", () => {
  assert.equal(
    blockUserSchema.safeParse({ targetType: "activity" }).success,
    false,
  );
  assert.equal(
    blockUserSchema.safeParse({
      targetId: "activity-1",
      targetType: "activity",
    }).success,
    true,
  );
});
