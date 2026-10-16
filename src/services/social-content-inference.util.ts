export type SocialInferenceSourceType =
  "ACHIEVEMENT" | "GOAL_PROGRESS" | "REWIND";

export interface SocialInferenceSource {
  dateKey: string;
  id: string;
  text: string;
  type: SocialInferenceSourceType;
}

const SOURCE_LABELS: Record<SocialInferenceSourceType, string> = {
  ACHIEVEMENT: "Achievement",
  GOAL_PROGRESS: "Completed goal progress",
  REWIND: "Completed Rewind summary",
};

export function formatSocialInferenceContext(
  sources: SocialInferenceSource[],
): string {
  return sources
    .filter((source) => source.text.trim())
    .slice(0, 7)
    .map((source) => {
      const text = source.text.replace(/\s+/g, " ").trim().slice(0, 600);
      return `- ${SOURCE_LABELS[source.type]}, ${source.dateKey}: ${text}`;
    })
    .join("\n")
    .slice(0, 5_000);
}
