"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRewindReflection = parseRewindReflection;
exports.generateRewindReflection = generateRewindReflection;
const genai_1 = require("@google/genai");
const env_util_1 = require("../utils/env.util");
const REFLECTION_SIGNAL_KEYS = [
    "emotionalSteadiness",
    "energy",
    "clarity",
    "connection",
    "agency",
];
function normalizeText(value, maximumLength) {
    if (typeof value !== "string")
        return null;
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, maximumLength) : null;
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeSignals(value) {
    if (!isRecord(value))
        return null;
    const signals = {};
    for (const key of REFLECTION_SIGNAL_KEYS) {
        const numericValue = value[key];
        if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
            return null;
        }
        signals[key] = Math.max(0, Math.min(100, Math.round(numericValue)));
    }
    return signals;
}
function normalizeTags(value) {
    if (!Array.isArray(value))
        return [];
    const tags = [];
    for (const entry of value) {
        const tag = normalizeText(entry, 32)?.toLowerCase();
        if (tag && !tags.includes(tag))
            tags.push(tag);
        if (tags.length === 5)
            break;
    }
    return tags;
}
function parseRewindReflection(value) {
    if (!isRecord(value)) {
        throw new Error("Rewind reflection response was not an object");
    }
    const summary = normalizeText(value.summary, 2400);
    const emotionalInsight = normalizeText(value.emotionalInsight, 900);
    const journalDraft = normalizeText(value.journalDraft, 2400);
    const wellbeingSignals = normalizeSignals(value.wellbeingSignals);
    if (!summary || !emotionalInsight || !journalDraft || !wellbeingSignals) {
        throw new Error("Rewind reflection response omitted required content");
    }
    return {
        comparisonInsight: normalizeText(value.comparisonInsight, 700),
        currentMood: normalizeText(value.currentMood, 80),
        emotionalInsight,
        emotionalTags: normalizeTags(value.emotionalTags),
        journalDraft,
        nextStepNote: normalizeText(value.nextStepNote, 280),
        summary,
        wellbeingSignals,
    };
}
function formatTranscript(transcript) {
    return transcript
        .map((turn) => `${turn.role === "user" ? "User" : "Partner"}: ${turn.content}`)
        .join("\n");
}
function formatPriorContext(context) {
    const memories = context.previousSummaries
        .map((entry) => `- ${entry.dateKey}: ${entry.summary}`)
        .join("\n");
    const journals = context.journalEntries
        .map((entry) => `- ${entry.dateKey}: ${entry.content}`)
        .join("\n");
    const activities = context.activityObservations
        ?.map((entry) => `- [${entry.sourceType}] ${entry.description}`)
        .join("\n");
    return [
        memories
            ? `Private memories from ${context.personaName}:\n${memories}`
            : "",
        journals ? `The user's explicit journal entries:\n${journals}` : "",
        activities
            ? `Grounded activity from this local day. Use it only to clarify what the user shared; never let it override the transcript:\n${activities}`
            : "",
    ]
        .filter(Boolean)
        .join("\n\n");
}
async function generateRewindReflection(context) {
    if (!env_util_1.Env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured");
    }
    const client = new genai_1.GoogleGenAI({ apiKey: env_util_1.Env.GEMINI_API_KEY });
    const response = await client.models.generateContent({
        model: process.env.GEMINI_REWIND_ANALYSIS_MODEL ?? "gemini-2.5-flash",
        contents: [
            {
                role: "user",
                parts: [
                    {
                        text: "Create a substantial, grounded daily Rewind reflection from the completed transcript. Do not diagnose, invent events, or make medical claims. The partner can use only its own private memories and the user's explicit journals. Mention a prior pattern only when it genuinely clarifies today. The summary must contain four concise plain-text sections: What happened, What mattered emotionally, What became clearer, and A useful next check-in. Ground every point in the conversation. The journalDraft must be a first-person note the user can review and append without overwriting their writing. Wellbeing signals are non-clinical 0-100 reflective readings, not health scores.\n\n" +
                            (context.intent
                                ? `The user's stated Rewind intention is: ${context.intent}. Let it shape emphasis, but never force it where the transcript does not support it.\n\n`
                                : "") +
                            `Transcript:\n${formatTranscript(context.transcript)}\n\n` +
                            `${formatPriorContext(context)}`,
                    },
                ],
            },
        ],
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: genai_1.Type.OBJECT,
                properties: {
                    summary: { type: genai_1.Type.STRING },
                    emotionalInsight: { type: genai_1.Type.STRING },
                    comparisonInsight: { type: genai_1.Type.STRING, nullable: true },
                    journalDraft: { type: genai_1.Type.STRING },
                    currentMood: { type: genai_1.Type.STRING, nullable: true },
                    emotionalTags: { type: genai_1.Type.ARRAY, items: { type: genai_1.Type.STRING } },
                    nextStepNote: { type: genai_1.Type.STRING, nullable: true },
                    wellbeingSignals: {
                        type: genai_1.Type.OBJECT,
                        properties: {
                            emotionalSteadiness: { type: genai_1.Type.NUMBER },
                            energy: { type: genai_1.Type.NUMBER },
                            clarity: { type: genai_1.Type.NUMBER },
                            connection: { type: genai_1.Type.NUMBER },
                            agency: { type: genai_1.Type.NUMBER },
                        },
                        required: [
                            "emotionalSteadiness",
                            "energy",
                            "clarity",
                            "connection",
                            "agency",
                        ],
                    },
                },
                required: [
                    "summary",
                    "emotionalInsight",
                    "journalDraft",
                    "emotionalTags",
                    "wellbeingSignals",
                ],
            },
            temperature: 0.35,
        },
    });
    const text = response.text;
    if (!text) {
        throw new Error("Rewind reflection response was empty");
    }
    return parseRewindReflection(JSON.parse(text));
}
