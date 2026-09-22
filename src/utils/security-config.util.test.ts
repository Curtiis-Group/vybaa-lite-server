import assert from "node:assert/strict";
import test from "node:test";
import { isPublicProfileOrigin } from "./security-config.util";

test("allows canonical public-profile subdomains", () => {
  assert.equal(isPublicProfileOrigin("https://ada.vybaa.app"), true);
  assert.equal(isPublicProfileOrigin("https://ada_lovelace.vybaa.app"), true);
});

test("rejects non-profile and malformed subdomains", () => {
  assert.equal(isPublicProfileOrigin("https://api.vybaa.app"), false);
  assert.equal(isPublicProfileOrigin("https://ada.team.vybaa.app"), false);
  assert.equal(isPublicProfileOrigin("http://ada.vybaa.app"), false);
  assert.equal(isPublicProfileOrigin("https://ada.example.com"), false);
});
