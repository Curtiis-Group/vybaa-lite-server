export const AI_TEXT_PROVIDER = {
  GEMINI: "gemini",
  OPENROUTER: "openrouter",
} as const;

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

const DEFAULT_OPENROUTER_MODEL = "qwen/qwen3.8-27b:free";
const DEFAULT_OPENROUTER_MODELS: Partial<Record<AiTextFeature, string>> = {
  // Chill suggestions use structured JSON, so use a model that handles the
  // response format reliably when no explicit model is configured.
  CHILL_SUGGESTIONS: "poolside/laguna-s-2.1:free",
};
const DEFAULT_REWIND_ANALYSIS_MODEL = "gemini-3.6-flash";
const DEFAULT_GEMINI_MODELS: Record<AiTextFeature, string> = {
  CHILL_SUGGESTIONS: "gemini-2.0-flash",
  DAILY_OBSERVATION: DEFAULT_REWIND_ANALYSIS_MODEL,
  EMOTION_SUMMARY: "gemini-2.0-flash",
  JOURNAL_SUMMARY: "gemini-2.0-flash",
  QUICK_GOAL_SETUP: DEFAULT_REWIND_ANALYSIS_MODEL,
  REWIND_CHAT: DEFAULT_REWIND_ANALYSIS_MODEL,
  REWIND_CHAT_V2: DEFAULT_REWIND_ANALYSIS_MODEL,
  REWIND_REFLECTION: DEFAULT_REWIND_ANALYSIS_MODEL,
};

function parseProvider(
  value: string | undefined,
  feature: AiTextFeature,
): AiTextProvider {
  const normalizedValue = value?.trim().toLowerCase();

  if (!normalizedValue) {
    return AI_TEXT_PROVIDER.GEMINI;
  }
  if (
    normalizedValue === AI_TEXT_PROVIDER.GEMINI ||
    normalizedValue === AI_TEXT_PROVIDER.OPENROUTER
  ) {
    return normalizedValue;
  }

  throw new Error(
    `Unsupported AI text provider "${value}" for ${feature}. Use gemini or openrouter.`,
  );
}

function getConfiguredModel(
  feature: AiTextFeature,
  provider: AiTextProvider,
  environment: NodeJS.ProcessEnv,
): string {
  const featureModel = environment[`AI_TEXT_MODEL_${feature}`]?.trim();

  if (featureModel) {
    return featureModel;
  }
  if (provider === AI_TEXT_PROVIDER.OPENROUTER) {
    return (
      environment.OPENROUTER_MODEL?.trim() ||
      DEFAULT_OPENROUTER_MODELS[feature] ||
      DEFAULT_OPENROUTER_MODEL
    );
  }

  if (
    feature === AI_TEXT_FEATURE.DAILY_OBSERVATION ||
    feature === AI_TEXT_FEATURE.QUICK_GOAL_SETUP ||
    feature === AI_TEXT_FEATURE.REWIND_CHAT ||
    feature === AI_TEXT_FEATURE.REWIND_CHAT_V2 ||
    feature === AI_TEXT_FEATURE.REWIND_REFLECTION
  ) {
    return (
      environment.GEMINI_REWIND_ANALYSIS_MODEL?.trim() ||
      DEFAULT_REWIND_ANALYSIS_MODEL
    );
  }

  return DEFAULT_GEMINI_MODELS[feature];
}

function getReasoningEnabled(
  feature: AiTextFeature,
  environment: NodeJS.ProcessEnv,
): boolean {
  const configuredValue =
    environment[`AI_TEXT_REASONING_${feature}`] ??
    environment.AI_TEXT_REASONING_ENABLED;

  if (!configuredValue) {
    return true;
  }

  return configuredValue.trim().toLowerCase() !== "false";
}

export function getAiTextProviderConfig(
  feature: AiTextFeature,
  environment: NodeJS.ProcessEnv = process.env,
): AiTextProviderConfig {
  const provider = parseProvider(
    environment[`AI_TEXT_PROVIDER_${feature}`] ??
      environment.AI_TEXT_PROVIDER,
    feature,
  );

  return {
    feature,
    model: getConfiguredModel(feature, provider, environment),
    provider,
    reasoningEnabled: getReasoningEnabled(feature, environment),
  };
}
