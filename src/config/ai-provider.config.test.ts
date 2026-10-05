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

test("Rewind text stays on OpenRouter", () => {
  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.REWIND_CHAT).provider,
    AI_TEXT_PROVIDER.OPENROUTER,
  );
  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.REWIND_CHAT).model,
    "qwen/qwen3.8-27b:free",
  );
});

test("every text feature uses OpenRouter", () => {
  for (const feature of Object.values(AI_TEXT_FEATURE)) {
    assert.equal(
      getAiTextProviderConfig(feature).provider,
      AI_TEXT_PROVIDER.OPENROUTER,
    );
  }
});

test("uses the structured-output OpenRouter model for chill suggestions", () => {
  const config = getAiTextProviderConfig(
    AI_TEXT_FEATURE.CHILL_SUGGESTIONS,
  );

  assert.equal(config.provider, AI_TEXT_PROVIDER.OPENROUTER);
  assert.equal(config.model, "poolside/laguna-s-2.1:free");
});
