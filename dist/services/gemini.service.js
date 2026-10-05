"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiService = void 0;
const generative_ai_1 = require("@google/generative-ai");
const ai_provider_config_1 = require("../config/ai-provider.config");
const openrouter_text_service_1 = require("./openrouter-text.service");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const CHILL_RESPONSE_SCHEMA = {
    additionalProperties: false,
    properties: {
        suggestedTimes: {
            items: {
                additionalProperties: false,
                properties: {
                    affirms: {
                        items: { type: "string" },
                        type: "array",
                    },
                    duration: { type: "number" },
                },
                required: ["duration", "affirms"],
                type: "object",
            },
            minItems: 3,
            type: "array",
        },
    },
    required: ["suggestedTimes"],
    type: "object",
};
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function parseChillResponse(value) {
    if (!isRecord(value) || !Array.isArray(value.suggestedTimes)) {
        return null;
    }
    const suggestedTimes = [];
    for (const suggestion of value.suggestedTimes) {
        if (!isRecord(suggestion)) {
            return null;
        }
        const duration = suggestion.duration;
        const affirmations = suggestion.affirms;
        if (typeof duration !== "number" ||
            !Array.isArray(affirmations) ||
            affirmations.some((affirmation) => typeof affirmation !== "string")) {
            return null;
        }
        suggestedTimes.push({
            affirms: affirmations,
            duration,
        });
    }
    return suggestedTimes.length ? { suggestedTimes } : null;
}
function parseChillResponseText(text) {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return null;
    }
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        return parseChillResponse(parsed);
    }
    catch {
        return null;
    }
}
class GeminiService {
    constructor() {
        this.genAI = null;
    }
    getClient() {
        if (!this.genAI) {
            const apiKey = env_util_1.Env.GEMINI_API_KEY;
            if (!apiKey) {
                throw new Error("GEMINI_API_KEY is not configured");
            }
            this.genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
        }
        return this.genAI;
    }
    /**
     * Generate calming session suggestions based on user's emotion
     */
    async generateChillSuggestions(emotion) {
        try {
            const prompt = `You are a compassionate therapist helping someone who is feeling: "${emotion}".

Please suggest 3 calming breathing session durations with appropriate affirmations for each:
- 5 minutes: For quick emotional relief
- 10 minutes: For moderate calming
- 20 minutes: For deep relaxation

For each duration, provide 8-12 short, calming affirmations (2-6 words each).
Affirmations should be:
- Empathetic and supportive
- Present tense, positive
- Easy to read during breathing
- Non-judgmental
- Soothing and reassuring

Examples: "You are safe", "Breathe deeply", "Take it gently", "You've got this", "Let it go"

Return ONLY valid JSON in this exact format:
{
  "suggestedTimes": [
    {
      "duration": 5,
      "affirms": ["affirmation 1", "affirmation 2", ...]
    },
    {
      "duration": 10,
      "affirms": ["affirmation 1", "affirmation 2", ...]
    },
    {
      "duration": 20,
      "affirms": ["affirmation 1", "affirmation 2", ...]
    }
  ]
}`;
            const aiConfig = (0, ai_provider_config_1.getAiTextProviderConfig)(ai_provider_config_1.AI_TEXT_FEATURE.CHILL_SUGGESTIONS);
            if (aiConfig.provider === ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER) {
                const text = await (0, openrouter_text_service_1.generateOpenRouterText)({
                    feature: ai_provider_config_1.AI_TEXT_FEATURE.CHILL_SUGGESTIONS,
                    jsonSchema: CHILL_RESPONSE_SCHEMA,
                    maxOutputTokens: 1024,
                    prompt,
                    temperature: 0.2,
                });
                const parsedResponse = parseChillResponseText(text);
                if (!parsedResponse) {
                    logger_util_1.default.error("Invalid OpenRouter chill suggestions response");
                    return this.getFallbackSuggestions();
                }
                logger_util_1.default.info("OpenRouter chill suggestions generated successfully");
                return parsedResponse;
            }
            const genAI = this.getClient();
            const model = genAI.getGenerativeModel({ model: aiConfig.model });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            const parsedResponse = parseChillResponseText(text);
            if (!parsedResponse) {
                logger_util_1.default.error("No JSON found in Gemini response:", text);
                return this.getFallbackSuggestions();
            }
            logger_util_1.default.info("Gemini chill suggestions generated successfully");
            return parsedResponse;
        }
        catch (error) {
            logger_util_1.default.error("Error generating chill suggestions:", error);
            return this.getFallbackSuggestions();
        }
    }
    /**
     * Fallback suggestions if Gemini fails
     */
    getFallbackSuggestions() {
        return {
            suggestedTimes: [
                {
                    duration: 5,
                    affirms: [
                        "You are safe",
                        "Breathe deeply",
                        "Take it easy",
                        "You've got this",
                        "Let tension go",
                        "Find your calm",
                        "You are enough",
                        "Peace is here",
                    ],
                },
                {
                    duration: 10,
                    affirms: [
                        "You are safe",
                        "Breathe deeply",
                        "Take it gently",
                        "You've got this",
                        "Let it go",
                        "Find your peace",
                        "You are strong",
                        "Calm is coming",
                        "You are loved",
                        "Trust the process",
                    ],
                },
                {
                    duration: 20,
                    affirms: [
                        "You are safe",
                        "Breathe deeply",
                        "Take it gently",
                        "I'm here with you",
                        "You've got this",
                        "Let everything go",
                        "Find your center",
                        "You are worthy",
                        "Peace surrounds you",
                        "You are healing",
                        "Trust yourself",
                        "You are enough",
                    ],
                },
            ],
        };
    }
    /**
     * Generate AI summary of user's emotional journey
     */
    async generateEmotionSummary(sessions) {
        try {
            if (sessions.length === 0) {
                return "You haven't completed any chill sessions yet. Start your first session to see insights about your emotional journey.";
            }
            // Format sessions for prompt
            const sessionsText = sessions
                .slice(0, 20) // Limit to last 20 for context
                .map((s, i) => {
                const date = new Date(s.date).toLocaleDateString();
                return `${i + 1}. Date: ${date}\n   Before: "${s.emotion}"\n   After: ${s.postMood || "Not recorded"}`;
            })
                .join("\n\n");
            const prompt = `You are a compassionate therapist analyzing a user's emotional journey through their chill/breathing sessions.

Here are their recent sessions:
${sessionsText}

Please provide a very short, concise, and warm summary (2-4 sentences maximum) that:
1. Briefly identifies the main emotional pattern or trend
2. Highlights one key positive observation
3. Offers gentle encouragement

Keep it brief, supportive, and non-judgmental. Write in second person ("You have been...").

Return ONLY the summary text, no markdown formatting, no titles, just 2-4 concise sentences.`;
            const aiConfig = (0, ai_provider_config_1.getAiTextProviderConfig)(ai_provider_config_1.AI_TEXT_FEATURE.EMOTION_SUMMARY);
            if (aiConfig.provider === ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER) {
                const text = await (0, openrouter_text_service_1.generateOpenRouterText)({
                    feature: ai_provider_config_1.AI_TEXT_FEATURE.EMOTION_SUMMARY,
                    maxOutputTokens: 1024,
                    prompt,
                    temperature: 0.2,
                });
                logger_util_1.default.info("OpenRouter emotion summary generated successfully");
                return text;
            }
            const genAI = this.getClient();
            const model = genAI.getGenerativeModel({ model: aiConfig.model });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim();
            logger_util_1.default.info("Emotion summary generated successfully");
            return text;
        }
        catch (error) {
            logger_util_1.default.error("Error generating emotion summary:", error);
            return this.getFallbackSummary(sessions);
        }
    }
    /**
     * Fallback summary if AI fails
     */
    getFallbackSummary(sessions) {
        const completed = sessions.filter((s) => s.postMood).length;
        const total = sessions.length;
        if (total === 0) {
            return "You haven't completed any chill sessions yet. Start your first session to see insights about your emotional journey.";
        }
        return `You've completed ${completed} session${completed !== 1 ? "s" : ""}. Keep practicing breathing exercises to regulate your emotions.`;
    }
    /**
     * Generate AI summary of user's journal entries
     */
    async generateJournalSummary(entries) {
        try {
            if (entries.length === 0) {
                return "You haven't written any journal entries yet. Start journaling to reflect on your thoughts and see insights about your journey.";
            }
            // Format entries for prompt
            const entriesText = entries
                .slice(0, 20) // Limit to last 20 for context
                .map((e, i) => {
                const date = new Date(e.date).toLocaleDateString();
                const contentPreview = e.content.length > 200 ? e.content.substring(0, 200) + "..." : e.content;
                return `${i + 1}. Date: ${date}\n   Mood: ${e.mood || "Not recorded"}\n   Entry: "${contentPreview}"`;
            })
                .join("\n\n");
            const prompt = `You are a compassionate life coach analyzing a user's journal entries to provide gentle insights.

Here are their recent journal entries:
${entriesText}

Please provide a very short, concise summary (2-4 sentences maximum) that:
1. Identifies the main theme or pattern in their reflections
2. Highlights one positive insight or growth moment
3. Offers warm encouragement

Keep it brief, supportive, and insightful. Write in second person ("You have been...").

Return ONLY the summary text, no markdown formatting, no titles, just 2-4 concise sentences.`;
            const aiConfig = (0, ai_provider_config_1.getAiTextProviderConfig)(ai_provider_config_1.AI_TEXT_FEATURE.JOURNAL_SUMMARY);
            if (aiConfig.provider === ai_provider_config_1.AI_TEXT_PROVIDER.OPENROUTER) {
                const text = await (0, openrouter_text_service_1.generateOpenRouterText)({
                    feature: ai_provider_config_1.AI_TEXT_FEATURE.JOURNAL_SUMMARY,
                    maxOutputTokens: 1024,
                    prompt,
                    temperature: 0.2,
                });
                logger_util_1.default.info("OpenRouter journal summary generated successfully");
                return text;
            }
            const genAI = this.getClient();
            const model = genAI.getGenerativeModel({ model: aiConfig.model });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const text = response.text().trim();
            logger_util_1.default.info("Journal summary generated successfully");
            return text;
        }
        catch (error) {
            logger_util_1.default.error("Error generating journal summary:", error);
            return this.getFallbackJournalSummary(entries);
        }
    }
    /**
     * Fallback journal summary if AI fails
     */
    getFallbackJournalSummary(entries) {
        const withMood = entries.filter((e) => e.mood).length;
        const total = entries.length;
        if (total === 0) {
            return "You haven't written any journal entries yet. Start journaling to reflect on your thoughts and see insights about your journey.";
        }
        return `You've journaled ${total} time${total !== 1 ? "s" : ""}. Reflecting on your thoughts helps you understand yourself better.`;
    }
}
exports.geminiService = new GeminiService();
