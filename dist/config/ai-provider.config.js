"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GEMINI_LIVE_REWIND_MODEL = exports.AI_TEXT_CONFIG = exports.AI_TEXT_FEATURE = exports.AI_TEXT_PROVIDER = void 0;
exports.getAiTextProviderConfig = getAiTextProviderConfig;
exports.AI_TEXT_PROVIDER = {
    GEMINI: "gemini",
    OPENROUTER: "openrouter",
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
        model: "poolside/laguna-s-2.1:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    // All text generation uses OpenRouter. Gemini is reserved for the live
    // Rewind session below, where the partner actually speaks.
    DAILY_OBSERVATION: {
        model: "qwen/qwen3.8-27b:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    EMOTION_SUMMARY: {
        model: "qwen/qwen3.8-27b:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    JOURNAL_SUMMARY: {
        model: "qwen/qwen3.8-27b:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    QUICK_GOAL_SETUP: {
        model: "qwen/qwen3.8-27b:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    REWIND_CHAT: {
        model: "qwen/qwen3.8-27b:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    REWIND_CHAT_V2: {
        model: "qwen/qwen3.8-27b:free",
        provider: exports.AI_TEXT_PROVIDER.OPENROUTER,
        reasoningEnabled: true,
    },
    REWIND_REFLECTION: {
        model: "qwen/qwen3.8-27b:free",
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
