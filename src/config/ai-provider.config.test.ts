import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_TEXT_FEATURE,
  AI_TEXT_PROVIDER,
  getAiTextProviderConfig,
} from "./ai-provider.config";

test("text AI defaults to Gemini for every feature", () => {
  const config = getAiTextProviderConfig(AI_TEXT_FEATURE.JOURNAL_SUMMARY, {});

  assert.equal(config.provider, AI_TEXT_PROVIDER.GEMINI);
  assert.equal(config.model, "gemini-2.0-flash");
  assert.equal(config.reasoningEnabled, true);
});

test("a feature can opt into OpenRouter without changing other features", () => {
  const environment = {
    AI_TEXT_PROVIDER_JOURNAL_SUMMARY: "openrouter",
    OPENROUTER_MODEL: "qwen/qwen3.8-27b:free",
  };

  const journalConfig = getAiTextProviderConfig(
    AI_TEXT_FEATURE.JOURNAL_SUMMARY,
    environment,
  );
  const emotionConfig = getAiTextProviderConfig(
    AI_TEXT_FEATURE.EMOTION_SUMMARY,
    environment,
  );

  assert.equal(journalConfig.provider, AI_TEXT_PROVIDER.OPENROUTER);
  assert.equal(journalConfig.model, "qwen/qwen3.8-27b:free");
  assert.equal(journalConfig.reasoningEnabled, true);
  assert.equal(emotionConfig.provider, AI_TEXT_PROVIDER.GEMINI);
});

test("a global provider can be overridden for one feature", () => {
  const environment = {
    AI_TEXT_PROVIDER: "openrouter",
    AI_TEXT_PROVIDER_CHILL_SUGGESTIONS: "gemini",
    AI_TEXT_REASONING_ENABLED: "false",
    OPENROUTER_MODEL: "openrouter/free",
  };

  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.CHILL_SUGGESTIONS, environment)
      .provider,
    AI_TEXT_PROVIDER.GEMINI,
  );
  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.JOURNAL_SUMMARY, environment)
      .provider,
    AI_TEXT_PROVIDER.OPENROUTER,
  );
  assert.equal(
    getAiTextProviderConfig(AI_TEXT_FEATURE.JOURNAL_SUMMARY, environment)
      .reasoningEnabled,
    false,
  );
});

test("keeps the existing Gemini rewind-analysis model override", () => {
  const config = getAiTextProviderConfig(AI_TEXT_FEATURE.DAILY_OBSERVATION, {
    GEMINI_REWIND_ANALYSIS_MODEL: "gemini-custom-analysis",
  });

  assert.equal(config.model, "gemini-custom-analysis");
});

test("uses the structured-output OpenRouter default for chill suggestions", () => {
  const config = getAiTextProviderConfig(
    AI_TEXT_FEATURE.CHILL_SUGGESTIONS,
    { AI_TEXT_PROVIDER: "openrouter" },
  );

  assert.equal(config.model, "poolside/laguna-s-2.1:free");
});

test("unsupported text providers fail with a feature-specific error", () => {
  assert.throws(
    () =>
      getAiTextProviderConfig(AI_TEXT_FEATURE.EMOTION_SUMMARY, {
        AI_TEXT_PROVIDER_EMOTION_SUMMARY: "unsupported",
      }),
    /Unsupported AI text provider.*EMOTION_SUMMARY/,
  );
});
