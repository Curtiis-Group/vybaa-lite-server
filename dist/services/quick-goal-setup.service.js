"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickGoalSetupError = void 0;
exports.normalizeQuickGoalSetupResult = normalizeQuickGoalSetupResult;
exports.generateQuickGoalSetup = generateQuickGoalSetup;
const genai_1 = require("@google/genai");
const luxon_1 = require("luxon");
const env_util_1 = require("../utils/env.util");
const goal_v2_validators_1 = require("../validators/goal-v2.validators");
const QUICK_GOAL_SETUP_PARTNERS = {
    ariel: {
        name: "Ariel",
        setupDirection: "Ariel is a practical big-sibling figure. Keep the goal grounded, useful, and realistic without being controlling.",
    },
    ella: {
        name: "Ella",
        setupDirection: "Ella is emotionally perceptive and expressive. Keep the goal humane and connected to what matters, without becoming sentimental or overpromising.",
    },
    jake: {
        name: "Jake",
        setupDirection: "Jake is blunt and concise. Strip vague ambitions into a clear, honest commitment without being cruel.",
    },
    lyra: {
        name: "Lyra",
        setupDirection: "Lyra is low-key and dry. Keep the plan simple, low-drama, and sustainable rather than making it performative.",
    },
    neeja: {
        name: "Neeja",
        setupDirection: "Neeja is perceptive and composed. Catch hidden constraints, ask only useful questions, and shape a thoughtful plan without overcomplicating it.",
    },
    tobi: {
        name: "Tobi",
        setupDirection: "Tobi is playful and socially sharp. Make the goal feel doable and motivating, use plain language, and do not let jokes blur the commitment.",
    },
};
class QuickGoalSetupError extends Error {
    constructor(message) {
        super(message);
        this.status = 502;
        this.name = "QuickGoalSetupError";
    }
}
exports.QuickGoalSetupError = QuickGoalSetupError;
function getQuickGoalSetupPartner(personaId) {
    if (personaId !== "ariel" &&
        personaId !== "ella" &&
        personaId !== "jake" &&
        personaId !== "lyra" &&
        personaId !== "tobi" &&
        personaId !== "neeja") {
        return null;
    }
    return QUICK_GOAL_SETUP_PARTNERS[personaId];
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeQuickGoalSetupResult(value, today) {
    if (!isRecord(value) || value.kind !== "DRAFT" || !isRecord(value.draft)) {
        return value;
    }
    const { draft } = value;
    if (!isRecord(draft.schedule) || typeof draft.schedule.type !== "string") {
        return value;
    }
    const schedule = draft.schedule;
    const requiresStartDate = schedule.type === "DAILY" ||
        schedule.type === "SELECTED_WEEKDAYS" ||
        schedule.type === "WEEKLY";
    let normalizedSchedule = schedule;
    if (requiresStartDate && typeof schedule.startDate !== "string") {
        normalizedSchedule = { ...schedule, startDate: today };
    }
    else if (schedule.type === "ONE_TIME" &&
        typeof schedule.date !== "string") {
        normalizedSchedule = { ...schedule, date: today };
    }
    return {
        ...value,
        draft: { ...draft, schedule: normalizedSchedule },
    };
}
async function generateQuickGoalSetup(timezone, input, personaId) {
    if (!env_util_1.Env.GEMINI_API_KEY) {
        throw new QuickGoalSetupError("AI goal setup is not configured");
    }
    const today = luxon_1.DateTime.now().setZone(timezone).toISODate();
    if (!today)
        throw new QuickGoalSetupError("Could not resolve today's date");
    const client = new genai_1.GoogleGenAI({ apiKey: env_util_1.Env.GEMINI_API_KEY });
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
                        text: "Help the user make one practical, editable goal setup. " +
                            "Return exactly one JSON object matching the schema. No markdown or prose. " +
                            (isEdit
                                ? "Revise the current draft using the user's change request. Preserve every detail they did not ask to change. Return a DRAFT now; do not ask questions. "
                                : hasAnswers
                                    ? "The user answered the planning questions below. Return a DRAFT now; do not ask more questions. "
                                    : "First decide whether a goal can be made well from the user's idea. Ask one or two QUESTIONS only when an answer would materially change the target or schedule. Do not ask for details you can reasonably infer. Otherwise return a DRAFT immediately. ") +
                            "For a DRAFT, choose a clear short title, an optional one-sentence reason, a measurable target, " +
                            "and a realistic schedule. Prefer CHECK_IN_COUNT with DAILY for habits unless the " +
                            "user clearly asks for a quantity, weekday, weekly, or one-time goal. " +
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
                            description: { type: genai_1.Type.STRING },
                            schedule: {
                                properties: {
                                    date: { type: genai_1.Type.STRING },
                                    endDate: { type: genai_1.Type.STRING },
                                    startDate: { type: genai_1.Type.STRING },
                                    type: {
                                        enum: ["DAILY", "ONE_TIME", "SELECTED_WEEKDAYS", "WEEKLY"],
                                        type: genai_1.Type.STRING,
                                    },
                                    weekday: { type: genai_1.Type.NUMBER },
                                    weekdays: { items: { type: genai_1.Type.NUMBER }, type: genai_1.Type.ARRAY },
                                },
                                required: ["type"],
                                type: genai_1.Type.OBJECT,
                            },
                            target: {
                                properties: {
                                    amount: { type: genai_1.Type.NUMBER },
                                    count: { type: genai_1.Type.NUMBER },
                                    endDate: { type: genai_1.Type.STRING },
                                    type: {
                                        enum: ["CHECK_IN_COUNT", "QUANTITY", "UNTIL_DATE"],
                                        type: genai_1.Type.STRING,
                                    },
                                    unit: { type: genai_1.Type.STRING },
                                },
                                required: ["type"],
                                type: genai_1.Type.OBJECT,
                            },
                            title: { type: genai_1.Type.STRING },
                        },
                        required: ["schedule", "target", "title"],
                        type: genai_1.Type.OBJECT,
                    },
                    kind: {
                        enum: ["DRAFT", "QUESTIONS"],
                        type: genai_1.Type.STRING,
                    },
                    questions: {
                        items: {
                            properties: { question: { type: genai_1.Type.STRING } },
                            required: ["question"],
                            type: genai_1.Type.OBJECT,
                        },
                        maxItems: 2,
                        minItems: 1,
                        type: genai_1.Type.ARRAY,
                    },
                },
                required: ["kind"],
                type: genai_1.Type.OBJECT,
            },
            temperature: 0.25,
        },
        model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-3.6-flash",
    });
    if (!response.text) {
        throw new QuickGoalSetupError("AI goal setup returned no result");
    }
    let parsed;
    try {
        parsed = JSON.parse(response.text.trim());
    }
    catch {
        throw new QuickGoalSetupError("AI goal setup returned invalid JSON");
    }
    const normalized = normalizeQuickGoalSetupResult(parsed, today);
    const validated = goal_v2_validators_1.quickGoalSetupDecisionSchema.safeParse(normalized);
    if (!validated.success) {
        throw new QuickGoalSetupError("AI goal setup returned an invalid result");
    }
    return validated.data;
}
