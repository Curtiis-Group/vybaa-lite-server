"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEMINI_LIVE_REWIND_MODEL = exports.AI_TEXT_CONFIG = exports.AI_TEXT_FEATURE = exports.OPENROUTER_MODELS = exports.AI_TEXT_PROVIDER = void 0;
exports.getAiTextProviderConfig = getAiTextProviderConfig;
exports.AI_TEXT_PROVIDER = {
    GEMINI: "gemini",
    OPENROUTER: "openrouter",
};
exports.OPENROUTER_MODELS = {
    qwen: "qwen/qwen3.8-27b",
    laguna: "poolside/laguna-s-2.1",
    gemini: "google/gemini-3.5-flash-lite",
    luna: "openai/gpt-5.6-luna"
};
exports.AI_TEXT_FEATURE = {
    CHILL_SUGGESTIONS: "CHILL_SUGGESTIONS",
    DAILY_OBSERVATION: "DAILY_OBSERVATION",
    EMOTION_SUMMARY: "EMOTION_SUMMARY",
    JOURNAL_SUMMARY: "JOURNAL_SUMMARY",
    QUICK_GOAL_SETUP: "QUICK_GOAL_SETUP",
    REWIND_CHAT: "REWIND_CHAT",
    REWIND_CHAT_V2: "REWIND_CHAT_V2",
    REWIND_REFLECTION: "REWIND_REFLECTION",
};
exports.AI_TEXT_CONFIG = {
    // Structured chill responses use a model that reliably follows JSON output.
    CHILL_SUGGESTIONS: {
        model: exports.OPENROUTER_MODELS.laguna,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    // All text generation uses OpenRouter. Gemini is reserved for the live
    // Rewind session below, where the partner actually speaks.
    DAILY_OBSERVATION: {
        model: exports.OPENROUTER_MODELS.qwen,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        // This is a strict structured response. Reasoning can consume the model's
        // output budget and leave OpenRouter with no visible `content` field.
        reasoningEnabled: false,
    },
    EMOTION_SUMMARY: {
        model: exports.OPENROUTER_MODELS.qwen,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    JOURNAL_SUMMARY: {
        model: exports.OPENROUTER_MODELS.luna,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    QUICK_GOAL_SETUP: {
        model: exports.OPENROUTER_MODELS.luna,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    REWIND_CHAT: {
        model: exports.OPENROUTER_MODELS.luna,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    REWIND_CHAT_V2: {
        model: exports.OPENROUTER_MODELS.luna,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    REWIND_REFLECTION: {
        model: exports.OPENROUTER_MODELS.luna,
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
};
function getAiTextProviderConfig(feature) {
    return {
        feature,
        ...exports.AI_TEXT_CONFIG[feature],
    };
}
exports.GEMINI_LIVE_REWIND_MODEL = "models/gemini-3.1-flash-live-preview";
