import { GoogleGenAI, Type } from "@google/genai";
import { DateTime } from "luxon";

import { Env } from "../utils/env.util";
import {
  quickGoalSetupDecisionSchema,
  type QuickGoalSetupInput,
  type QuickGoalSetupResponse,
} from "../validators/goal-v2.validators";

type QuickGoalSetupPartnerId =
  "ariel" | "ella" | "jake" | "lyra" | "tobi" | "neeja";

type QuickGoalSetupPartner = {
  name: string;
  setupDirection: string;
};

const QUICK_GOAL_SETUP_PARTNERS: Record<
  QuickGoalSetupPartnerId,
  QuickGoalSetupPartner
> = {
  ariel: {
    name: "Ariel",
    setupDirection:
      "Ariel is a practical big-sibling figure. Keep the goal grounded, useful, and realistic without being controlling.",
  },
  ella: {
    name: "Ella",
    setupDirection:
      "Ella is emotionally perceptive and expressive. Keep the goal humane and connected to what matters, without becoming sentimental or overpromising.",
  },
  jake: {
    name: "Jake",
    setupDirection:
      "Jake is blunt and concise. Strip vague ambitions into a clear, honest commitment without being cruel.",
  },
  lyra: {
    name: "Lyra",
    setupDirection:
      "Lyra is low-key and dry. Keep the plan simple, low-drama, and sustainable rather than making it performative.",
  },
  neeja: {
    name: "Neeja",
    setupDirection:
      "Neeja is perceptive and composed. Catch hidden constraints, ask only useful questions, and shape a thoughtful plan without overcomplicating it.",
  },
  tobi: {
    name: "Tobi",
    setupDirection:
      "Tobi is playful and socially sharp. Make the goal feel doable and motivating, use plain language, and do not let jokes blur the commitment.",
  },
};

export class QuickGoalSetupError extends Error {
  readonly status = 502;

  constructor(message: string) {
    super(message);
    this.name = "QuickGoalSetupError";
  }
}

function getQuickGoalSetupPartner(
  personaId: string | null,
): QuickGoalSetupPartner | null {
  if (
    personaId !== "ariel" &&
    personaId !== "ella" &&
    personaId !== "jake" &&
    personaId !== "lyra" &&
    personaId !== "tobi" &&
    personaId !== "neeja"
  ) {
    return null;
  }
  return QUICK_GOAL_SETUP_PARTNERS[personaId];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeQuickGoalSetupResult(
  value: unknown,
  today: string,
  fallbackReminderTimes: string[] = [],
): unknown {
  if (!isRecord(value) || value.kind !== "DRAFT" || !isRecord(value.draft)) {
    return value;
  }
  const { draft } = value;
  if (!isRecord(draft.schedule) || typeof draft.schedule.type !== "string") {
    return value;
  }
  const schedule = draft.schedule;
  const requiresStartDate =
    schedule.type === "DAILY" ||
    schedule.type === "SELECTED_WEEKDAYS" ||
    schedule.type === "WEEKLY";
  let normalizedSchedule = schedule;
  if (requiresStartDate && typeof schedule.startDate !== "string") {
    normalizedSchedule = { ...schedule, startDate: today };
  } else if (
    schedule.type === "ONE_TIME" &&
    typeof schedule.date !== "string"
  ) {
    normalizedSchedule = { ...schedule, date: today };
  }

  return {
    ...value,
    draft: {
      ...draft,
      reminderTimes: Array.isArray(draft.reminderTimes)
        ? draft.reminderTimes
        : fallbackReminderTimes,
      schedule: normalizedSchedule,
    },
  };
}

export async function generateQuickGoalSetup(
  timezone: string,
  input: QuickGoalSetupInput,
  personaId: string | null,
): Promise<QuickGoalSetupResponse> {
  if (!Env.GEMINI_API_KEY) {
    throw new QuickGoalSetupError("AI goal setup is not configured");
  }

  const today = DateTime.now().setZone(timezone).toISODate();
  if (!today) throw new QuickGoalSetupError("Could not resolve today's date");

  const client = new GoogleGenAI({ apiKey: Env.GEMINI_API_KEY });
  const partner = getQuickGoalSetupPartner(personaId);
  const hasAnswers = Boolean(input.answers?.length);
  const isEdit = Boolean(input.edit);
  const answeredQuestions = input.answers
    ?.map(({ answer, question }) => `Q: ${question}\nA: ${answer}`)
    .join("\n\n");
  const response = await client.models.generateContent({
    contents: [
      {
        parts: [
          {
            text:
              "Help the user make one practical, editable goal setup. " +
              "Return exactly one JSON object matching the schema. No markdown or prose. " +
              (isEdit
                ? "Revise the current draft using the user's change request. Preserve every detail they did not ask to change. Return a DRAFT now; do not ask questions. "
                : hasAnswers
                  ? "The user answered the planning questions below. Return a DRAFT now; do not ask more questions. "
                  : "First decide whether a goal can be made well from the user's idea. Ask one or two QUESTIONS only when an answer would materially change the target or schedule. Do not ask for details you can reasonably infer. Otherwise return a DRAFT immediately. ") +
              "For a DRAFT, choose a clear short title, an optional one-sentence reason, a measurable target, " +
              "and a realistic schedule. Prefer CHECK_IN_COUNT with DAILY for habits unless the " +
              "user clearly asks for a quantity, weekday, weekly, or one-time goal. " +
              "Always return reminderTimes as an array of up to three unique HH:MM times in the user's local timezone. " +
              "If the user mentions a reminder or a time such as after dinner, infer a sensible local reminder time. " +
              "If they do not ask for reminders, use an empty array. For edits, preserve the current reminderTimes " +
              "unless the user asks to add, move, or remove reminders. " +
              `Today is ${today} in timezone ${timezone}. Use YYYY-MM-DD dates on or after today. ` +
              "For CHECK_IN_COUNT, count must be an integer from 1 to 365. " +
              "For QUANTITY, include a concise unit. For WEEKLY, weekday is 1 for Monday through 7 for Sunday. " +
              "Do not invent deadlines the user did not imply; use a sensible short horizon when needed.\n\n" +
              (partner
                ? `${partner.name} is the user's selected Rewind partner and owns this setup. ${partner.setupDirection}\n\n`
                : "Keep the setup neutral and practical.\n\n") +
              `User idea: ${input.prompt.trim()}` +
              (answeredQuestions
                ? `\n\nPlanning answers:\n${answeredQuestions}`
                : "") +
              (input.edit
                ? `\n\nCurrent draft:\n${JSON.stringify(input.edit.draft)}\n\nRequested changes:\n${input.edit.instruction.trim()}`
                : ""),
          },
        ],
        role: "user",
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        properties: {
          draft: {
            properties: {
              description: { type: Type.STRING },
              schedule: {
                properties: {
                  date: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  startDate: { type: Type.STRING },
                  type: {
                    enum: ["DAILY", "ONE_TIME", "SELECTED_WEEKDAYS", "WEEKLY"],
                    type: Type.STRING,
                  },
                  weekday: { type: Type.NUMBER },
                  weekdays: { items: { type: Type.NUMBER }, type: Type.ARRAY },
                },
                required: ["type"],
                type: Type.OBJECT,
              },
              target: {
                properties: {
                  amount: { type: Type.NUMBER },
                  count: { type: Type.NUMBER },
                  endDate: { type: Type.STRING },
                  type: {
                    enum: ["CHECK_IN_COUNT", "QUANTITY", "UNTIL_DATE"],
                    type: Type.STRING,
                  },
                  unit: { type: Type.STRING },
                },
                required: ["type"],
                type: Type.OBJECT,
              },
              reminderTimes: {
                items: {
                  pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
                  type: Type.STRING,
                },
                maxItems: 3,
                type: Type.ARRAY,
              },
              title: { type: Type.STRING },
            },
            required: ["reminderTimes", "schedule", "target", "title"],
            type: Type.OBJECT,
          },
          kind: {
            enum: ["DRAFT", "QUESTIONS"],
            type: Type.STRING,
          },
          questions: {
            items: {
              properties: { question: { type: Type.STRING } },
              required: ["question"],
              type: Type.OBJECT,
            },
            maxItems: 2,
            minItems: 1,
            type: Type.ARRAY,
          },
        },
        required: ["kind"],
        type: Type.OBJECT,
      },
      temperature: 0.25,
    },
    model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
  });

  if (!response.text) {
    throw new QuickGoalSetupError("AI goal setup returned no result");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text.trim()) as unknown;
  } catch {
    throw new QuickGoalSetupError("AI goal setup returned invalid JSON");
  }

  const normalized = normalizeQuickGoalSetupResult(
    parsed,
    today,
    input.edit?.draft.reminderTimes ?? [],
  );
  const validated = quickGoalSetupDecisionSchema.safeParse(normalized);
  if (!validated.success) {
    throw new QuickGoalSetupError("AI goal setup returned an invalid result");
  }
  return validated.data;
}
