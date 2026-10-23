"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatSocialInferenceContext = formatSocialInferenceContext;
const SOURCE_LABELS = {
    ACHIEVEMENT: "Achievement",
    GOAL_PROGRESS: "Completed goal progress",
    REWIND: "Completed Rewind summary",
};
function formatSocialInferenceContext(sources) {
    return sources
        .filter((source) => source.text.trim())
        .slice(0, 7)
        .map((source) => {
        const text = source.text.replace(/\s+/g, " ").trim().slice(0, 600);
        return `- ${SOURCE_LABELS[source.type]}, ${source.dateKey}: ${text}`;
    })
        .join("\n")
        .slice(0, 5000);
}
