import assert from "node:assert/strict";
import test from "node:test";
import {
  containsObjectionableContent,
  isAllowedUserContent,
} from "./content-moderation.util";

test("allows ordinary community conversation", () => {
  assert.equal(
    isAllowedUserContent("Great work today, see you tomorrow!"),
    true,
  );
});

test("filters abusive, threatening, and obfuscated content", () => {
  assert.equal(containsObjectionableContent("kys"), true);
  assert.equal(containsObjectionableContent("I will hurt you"), true);
  assert.equal(containsObjectionableContent("send nudes"), true);
  assert.equal(containsObjectionableContent("n!gger"), true);
});
