import assert from "node:assert/strict";
import test from "node:test";

import {
  socialActivityConsentSchema,
  socialSuggestionRefreshSchema,
} from "./social.validators";

test("social activity consent accepts only an explicit boolean decision", () => {
  assert.equal(
    socialActivityConsentSchema.safeParse({ accepted: true }).success,
    true,
  );
  assert.equal(
    socialActivityConsentSchema.safeParse({ accepted: false }).success,
    true,
  );
  assert.equal(
    socialActivityConsentSchema.safeParse({ accepted: "true" }).success,
    false,
  );
  assert.equal(
    socialActivityConsentSchema.safeParse({ accepted: true, userId: "other" })
      .success,
    false,
  );
});

test("social suggestion refresh accepts only an optional force flag", () => {
  assert.equal(socialSuggestionRefreshSchema.safeParse({}).success, true);
  assert.equal(
    socialSuggestionRefreshSchema.safeParse({ force: true }).success,
    true,
  );
  assert.equal(
    socialSuggestionRefreshSchema.safeParse({ force: "true" }).success,
    false,
  );
});
