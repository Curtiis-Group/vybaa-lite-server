import { GoogleGenerativeAI } from "@google/generative-ai";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";

export interface ChillSuggestion {
  duration: number;
  affirms: string[];
}

export interface ChillResponse {
  suggestedTimes: ChillSuggestion[];
}

class GeminiService {
  private genAI: GoogleGenerativeAI | null = null;

  private getClient(): GoogleGenerativeAI {
    if (!this.genAI) {
      const apiKey =Env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured");
      }
      this.genAI = new GoogleGenerativeAI(apiKey);
    }
    return this.genAI;
  }

  /**
   * Generate calming session suggestions based on user's emotion
   */
  async generateChillSuggestions(emotion: string): Promise<ChillResponse> {
    try {
      const genAI = this.getClient();
      const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      // Extract JSON from response (remove markdown code blocks if present)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error("No JSON found in Gemini response:", text);
        return this.getFallbackSuggestions();
      }

      const parsedResponse = JSON.parse(jsonMatch[0]) as ChillResponse;

      // Validate response structure
      if (
        !parsedResponse.suggestedTimes ||
        !Array.isArray(parsedResponse.suggestedTimes) ||
        parsedResponse.suggestedTimes.length === 0
      ) {
        logger.error("Invalid response structure from Gemini");
        return this.getFallbackSuggestions();
      }

      logger.info("Gemini chill suggestions generated successfully");
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
}

export const geminiService = new GeminiService();
