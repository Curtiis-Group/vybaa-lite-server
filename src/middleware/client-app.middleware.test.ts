import assert from "node:assert/strict";
import test from "node:test";
import { getClientAppFromPath } from "./client-app.middleware";

test("identifies My Cove requests by their dedicated prefix", () => {
  assert.equal(getClientAppFromPath("/mycove/v1/auth/login"), "mycove");
  assert.equal(getClientAppFromPath("/mycove"), "mycove");
});

test("keeps existing API and unknown paths on the Vybaa surface", () => {
  assert.equal(getClientAppFromPath("/api/v1/auth/login"), "vybaa");
  assert.equal(getClientAppFromPath("/mycove-notes"), "vybaa");
});
