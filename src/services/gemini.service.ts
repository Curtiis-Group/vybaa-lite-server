import { AI_TEXT_FEATURE } from "../config/ai-provider.config";
import { generateOpenRouterText } from "./openrouter-text.service";
import logger from "../utils/logger.util";

export interface ChillSuggestion {
  duration: number;
  affirms: string[];
}

export interface ChillResponse {
  suggestedTimes: ChillSuggestion[];
}

const CHILL_RESPONSE_SCHEMA: Record<string, unknown> = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseChillResponse(value: unknown): ChillResponse | null {
  if (!isRecord(value) || !Array.isArray(value.suggestedTimes)) {
    return null;
  }

  const suggestedTimes: ChillSuggestion[] = [];
  for (const suggestion of value.suggestedTimes) {
    if (!isRecord(suggestion)) {
      return null;
    }

    const duration = suggestion.duration;
    const affirmations = suggestion.affirms;
    if (
      typeof duration !== "number" ||
      !Array.isArray(affirmations) ||
      affirmations.some((affirmation) => typeof affirmation !== "string")
    ) {
      return null;
    }

    suggestedTimes.push({
      affirms: affirmations,
      duration,
    });
  }

  return suggestedTimes.length ? { suggestedTimes } : null;
}

function parseChillResponseText(text: string): ChillResponse | null {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(jsonMatch[0]);
    return parseChillResponse(parsed);
  } catch {
    return null;
  }
}

class GeminiService {
  /**
   * Generate calming session suggestions based on user's emotion
   */
  async generateChillSuggestions(emotion: string): Promise<ChillResponse> {
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

      const text = await generateOpenRouterText({
        feature: AI_TEXT_FEATURE.CHILL_SUGGESTIONS,
        jsonSchema: CHILL_RESPONSE_SCHEMA,
        maxOutputTokens: 1_024,
        prompt,
        temperature: 0.2,
      });

      const parsedResponse = parseChillResponseText(text);
      if (!parsedResponse) {
        logger.error("Invalid OpenRouter chill suggestions response");
        return this.getFallbackSuggestions();
      }

      logger.info("OpenRouter chill suggestions generated successfully");
      return parsedResponse;
    } catch (error) {
      logger.error("Error generating chill suggestions:", error);
      return this.getFallbackSuggestions();
    }
  }

  /**
   * Fallback suggestions if Gemini fails
   */
  private getFallbackSuggestions(): ChillResponse {
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
  async generateEmotionSummary(
    sessions: Array<{ emotion: string; postMood: string | null; date: Date }>
  ): Promise<string> {
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

      const text = await generateOpenRouterText({
        feature: AI_TEXT_FEATURE.EMOTION_SUMMARY,
        maxOutputTokens: 1_024,
        prompt,
        temperature: 0.2,
      });

      logger.info("OpenRouter emotion summary generated successfully");
      return text;
    } catch (error) {
      logger.error("Error generating emotion summary:", error);
      return this.getFallbackSummary(sessions);
    }
  }

  /**
   * Fallback summary if AI fails
   */
  private getFallbackSummary(
    sessions: Array<{ emotion: string; postMood: string | null; date: Date }>
  ): string {
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
  async generateJournalSummary(
    entries: Array<{ date: Date; content: string; mood: string | null }>
  ): Promise<string> {
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

      const text = await generateOpenRouterText({
        feature: AI_TEXT_FEATURE.JOURNAL_SUMMARY,
        maxOutputTokens: 1_024,
        prompt,
        temperature: 0.2,
      });

      logger.info("OpenRouter journal summary generated successfully");
      return text;
    } catch (error) {
      logger.error("Error generating journal summary:", error);
      return this.getFallbackJournalSummary(entries);
    }
  }

  /**
   * Fallback journal summary if AI fails
   */
  private getFallbackJournalSummary(
    entries: Array<{ date: Date; content: string; mood: string | null }>
  ): string {
    const withMood = entries.filter((e) => e.mood).length;
    const total = entries.length;

    if (total === 0) {
      return "You haven't written any journal entries yet. Start journaling to reflect on your thoughts and see insights about your journey.";
    }

    return `You've journaled ${total} time${total !== 1 ? "s" : ""}. Reflecting on your thoughts helps you understand yourself better.`;
  }
}

export const geminiService = new GeminiService();
