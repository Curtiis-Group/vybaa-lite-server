import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_TEXT_FEATURE,
  AI_TEXT_PROVIDER,
  getAiTextProviderConfig,
} from "./ai-provider.config";

test("text AI routing is defined centrally", () => {
  const config = getAiTextProviderConfig(AI_TEXT_FEATURE.JOURNAL_SUMMARY);

  assert.equal(config.provider, AI_TEXT_PROVIDER.OPENROUTER);
  assert.equal(config.model, "qwen/qwen3.8-27b:free");
  assert.equal(config.reasoningEnabled, true);
});

test("Rewind stays on Gemini", () => {
  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.REWIND_CHAT).provider,
    AI_TEXT_PROVIDER.GEMINI,
  );
  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.REWIND_CHAT).model,
    "gemini-3.6-flash",
  );
});

test("uses the structured-output OpenRouter model for chill suggestions", () => {
  const config = getAiTextProviderConfig(
    AI_TEXT_FEATURE.CHILL_SUGGESTIONS,
  );

  assert.equal(config.provider, AI_TEXT_PROVIDER.OPENROUTER);
  assert.equal(config.model, "poolside/laguna-s-2.1:free");
});
