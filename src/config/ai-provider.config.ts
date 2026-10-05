export const AI_TEXT_PROVIDER = {
  GEMINI: "gemini",
  OPENROUTER: "openrouter",
} as const;

export const OPENROUTER_MODELS = {
  qwen: "qwen/qwen3.8-27b",
  laguna: "poolside/laguna-s-2.1",
  gemini: "google/gemini-3.5-flash-lite",
  luna: "openai/gpt-5.6-luna"
}

export type AiTextProvider =
  (typeof AI_TEXT_PROVIDER)[keyof typeof AI_TEXT_PROVIDER];

export const AI_TEXT_FEATURE = {
  CHILL_SUGGESTIONS: "CHILL_SUGGESTIONS",
  DAILY_OBSERVATION: "DAILY_OBSERVATION",
  EMOTION_SUMMARY: "EMOTION_SUMMARY",
  JOURNAL_SUMMARY: "JOURNAL_SUMMARY",
  QUICK_GOAL_SETUP: "QUICK_GOAL_SETUP",
  REWIND_CHAT: "REWIND_CHAT",
  REWIND_CHAT_V2: "REWIND_CHAT_V2",
  REWIND_REFLECTION: "REWIND_REFLECTION",
} as const;

export type AiTextFeature =
  (typeof AI_TEXT_FEATURE)[keyof typeof AI_TEXT_FEATURE];

export type AiTextProviderConfig = {
  feature: AiTextFeature;
  model: string;
  provider: AiTextProvider;
  reasoningEnabled: boolean;
};

type StaticAiTextProviderConfig = Omit<AiTextProviderConfig, "feature">;

export const AI_TEXT_CONFIG: Readonly<
  Record<AiTextFeature, StaticAiTextProviderConfig>
> = {
  // Structured chill responses use a model that reliably follows JSON output.
  CHILL_SUGGESTIONS: {
    model: OPENROUTER_MODELS.laguna,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
  // All text generation uses OpenRouter. Gemini is reserved for the live
  // Rewind session below, where the partner actually speaks.
  DAILY_OBSERVATION: {
    model: OPENROUTER_MODELS.luna,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    // This is a strict structured response. Reasoning can consume the model's
    // output budget and leave OpenRouter with no visible `content` field.
    reasoningEnabled: false,
  },
  EMOTION_SUMMARY: {
    model: OPENROUTER_MODELS.qwen,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
  JOURNAL_SUMMARY: {
    model: OPENROUTER_MODELS.luna,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
  QUICK_GOAL_SETUP: {
    model: OPENROUTER_MODELS.luna,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
  REWIND_CHAT: {
    model: OPENROUTER_MODELS.gemini,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
  REWIND_CHAT_V2: {
    model: OPENROUTER_MODELS.gemini,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
  REWIND_REFLECTION: {
    model: OPENROUTER_MODELS.luna,
    provider: AI_TEXT_PROVIDER.OPENROUTER,
    reasoningEnabled: true,
  },
};

export function getAiTextProviderConfig(
  feature: AiTextFeature,
): AiTextProviderConfig {
  return {
    feature,
    ...AI_TEXT_CONFIG[feature],
  };
}

export const GEMINI_LIVE_REWIND_MODEL =
  "models/gemini-3.1-flash-live-preview";
