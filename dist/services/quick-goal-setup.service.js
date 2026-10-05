"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuickGoalSetupError = void 0;
exports.normalizeQuickGoalSetupResult = normalizeQuickGoalSetupResult;
exports.generateQuickGoalSetup = generateQuickGoalSetup;
const luxon_1 = require("luxon");
const ai_provider_config_1 = require("../config/ai-provider.config");
const goal_v2_validators_1 = require("../validators/goal-v2.validators");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const openrouter_text_service_1 = require("./openrouter-text.service");
const rewind_temporal_context_service_1 = require("./rewind-temporal-context.service");
const QUICK_GOAL_SETUP_RESPONSE_SCHEMA = {
    additionalProperties: false,
    properties: {
        draft: {
            additionalProperties: false,
            properties: {
                description: { type: "string" },
                schedule: {
                    additionalProperties: false,
                    properties: {
                        date: { type: "string" },
                        endDate: { type: "string" },
                        startDate: { type: "string" },
                        type: {
                            enum: ["DAILY", "ONE_TIME", "SELECTED_WEEKDAYS", "WEEKLY"],
                            type: "string",
                        },
                        weekday: { type: "number" },
                        weekdays: { items: { type: "number" }, type: "array" },
                    },
                    required: ["type"],
                    type: "object",
                },
                target: {
                    additionalProperties: false,
                    properties: {
                        amount: { type: "number" },
                        count: { type: "number" },
                        endDate: { type: "string" },
                        type: {
                            enum: ["CHECK_IN_COUNT", "QUANTITY", "UNTIL_DATE"],
                            type: "string",
                        },
                        unit: { type: "string" },
                    },
                    required: ["type"],
                    type: "object",
                },
                reminderTimes: {
                    items: {
                        pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
                        type: "string",
                    },
                    maxItems: 3,
                    type: "array",
                },
                remarks: { type: "string" },
                title: { type: "string" },
            },
            required: ["reminderTimes", "schedule", "target", "title", "remarks"],
            type: "object",
        },
        kind: { enum: ["DRAFT", "QUESTIONS"], type: "string" },
        questions: {
            items: {
                additionalProperties: false,
                properties: { question: { type: "string" } },
                required: ["question"],
                type: "object",
            },
            maxItems: 2,
            minItems: 1,
            type: "array",
        },
    },
    required: ["kind"],
    type: "object",
};
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
function isQuickGoalSetupQuestions(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
        return false;
    }
    return value.every((item) => isRecord(item) &&
        typeof item.question === "string" &&
        item.question.trim().length >= 3 &&
        item.question.trim().length <= 240);
}
function normalizeQuickGoalSetupResult(value, today, fallbackReminderTimes = []) {
    if (!isRecord(value)) {
        return value;
    }
    if (value.kind === "DRAFT" &&
        !isRecord(value.draft) &&
        isQuickGoalSetupQuestions(value.questions)) {
        return { kind: "QUESTIONS", questions: value.questions };
    }
    if (value.kind !== "DRAFT" || !isRecord(value.draft)) {
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
        draft: {
            ...draft,
            reminderTimes: Array.isArray(draft.reminderTimes)
                ? draft.reminderTimes
                : fallbackReminderTimes,
            schedule: normalizedSchedule,
        },
    };
}
async function generateQuickGoalSetup(timezone, input, personaId) {
    const today = luxon_1.DateTime.now().setZone(timezone).toISODate();
    if (!today)
        throw new QuickGoalSetupError("Could not resolve today's date");
    const temporalContext = (0, rewind_temporal_context_service_1.formatRewindTemporalContext)(timezone);
    const partner = getQuickGoalSetupPartner(personaId);
    const hasAnswers = Boolean(input.answers?.length);
    const isEdit = Boolean(input.edit);
    const answeredQuestions = input.answers
        ?.map(({ answer, question }) => `Q: ${question}\nA: ${answer}`)
        .join("\n\n");
    const prompt = "Help the user make one practical, editable goal setup. " +
        "Return exactly one JSON object matching the schema. No markdown or prose. " +
        (isEdit
            ? "Revise the current draft using the user's change request. Preserve every detail they did not ask to change. Return a DRAFT now; do not ask questions. "
            : hasAnswers
                ? "The user answered the planning questions below. Return a DRAFT now; do not ask more questions. "
                : "First decide whether a goal can be made well from the user's idea. Ask one or two QUESTIONS only when an answer would materially change the target or schedule. Do not ask for details you can reasonably infer. Otherwise return a DRAFT immediately. ") +
        "For a DRAFT, choose a clear short title, an optional one-sentence reason, a measurable target, " +
        "and a realistic schedule. Prefer CHECK_IN_COUNT with DAILY for habits unless the " +
        "user clearly asks for a quantity, weekday, weekly, or one-time goal. Refrain from unnecessary questions. " +
        "If you ask a question, return kind QUESTIONS with questions only. If you return a DRAFT, return draft only. Never mix the two response shapes. " +
        "Always return reminderTimes as an array of up to three unique HH:MM times in the user's local timezone. " +
        "If the user mentions a reminder or a time such as after dinner, infer a sensible local reminder time. " +
        "If they do not ask for reminders, use an empty array. For edits, preserve the current reminderTimes " +
        "unless the user asks to add, move, or remove reminders. " +
        `${temporalContext} Today is ${today}. Use YYYY-MM-DD dates on or after today. ` +
        "Interpret relative dates and phrases such as tonight, tomorrow morning, after work, or before bed in that local context. Never schedule a same-day reminder in the past. " +
        "For CHECK_IN_COUNT, count must be an integer from 1 to 365. " +
        "For QUANTITY, include a concise unit. For WEEKLY, weekday is 1 for Monday through 7 for Sunday. " +
        "Do not invent deadlines the user did not imply; use a sensible short horizon when needed.\n\n" +
        (partner
            ? `${partner.name} is the user's selected Rewind partner and owns this setup. ${partner.setupDirection}\n\n`
            : "Keep the setup neutral and practical.\n\n") +
        `User idea: ${input.prompt.trim()}` +
        (answeredQuestions ? `\n\nPlanning answers:\n${answeredQuestions}` : "") +
        (input.edit
            ? `\n\nCurrent draft:\n${JSON.stringify(input.edit.draft)}\n\nRequested changes:\n${input.edit.instruction.trim()}`
            : "") +
        " lastly, drop remarks in the rewind partner's tone of what they did and why they did what they did, keep it as concise as possible, and personal as possible, maybe because they noticed a pattern or something with the user";
    const responseText = await (0, openrouter_text_service_1.generateOpenRouterText)({
        feature: ai_provider_config_1.AI_TEXT_FEATURE.QUICK_GOAL_SETUP,
        jsonSchema: QUICK_GOAL_SETUP_RESPONSE_SCHEMA,
        maxOutputTokens: 1024,
        prompt,
        temperature: 0.25,
    });
    let parsed;
    try {
        parsed = JSON.parse(responseText.trim());
    }
    catch {
        throw new QuickGoalSetupError("AI goal setup returned invalid JSON");
    }
    const normalized = normalizeQuickGoalSetupResult(parsed, today, input.edit?.draft.reminderTimes ?? []);
    logger_util_1.default.debug("Quick goal setup normalized", {
        kind: isRecord(normalized) && typeof normalized.kind === "string"
            ? normalized.kind
            : "unknown",
    });
    const validated = goal_v2_validators_1.quickGoalSetupDecisionSchema.safeParse(normalized);
    if (!validated.success) {
        logger_util_1.default.warn("Quick goal setup response rejected", {
            issues: validated.error.issues,
            returnedKind: isRecord(normalized) && typeof normalized.kind === "string"
                ? normalized.kind
                : "unknown",
        });
        throw new QuickGoalSetupError("AI goal setup returned an invalid result");
    }
    return validated.data;
}
