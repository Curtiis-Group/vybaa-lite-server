import { z } from "zod";

export const rewindConversationMoodSchema = z
  .object({
    energy: z.number().int().min(0).max(100),
    playfulness: z.number().int().min(0).max(100),
    directness: z.number().int().min(0).max(100),
  })
  .strict();

export type RewindConversationMood = z.infer<
  typeof rewindConversationMoodSchema
>;

export function resolveRewindConversationMood(
  value: unknown,
): RewindConversationMood {
  const parsed = rewindConversationMoodSchema.safeParse(value);
  return parsed.success
    ? parsed.data
    : { energy: 50, playfulness: 50, directness: 50 };
}

export function formatRewindConversationMood(value: unknown): string {
  const mood = resolveRewindConversationMood(value);
  return `Conversation preferences (0–100): energy ${mood.energy} (quiet to lively), playfulness ${mood.playfulness} (serious to playful), directness ${mood.directness} (gentle to frank). Adapt how you phrase and pace this conversation, not who you are. Livelier means more engaged, never message flooding. Quiet does not mean ignoring someone. Playfulness never trivializes distress. Directness never means cruelty. Preserve each partner's own views, voice, boundaries and persistent relationship feelings. These preferences do not change reminders, permissions or proactive message limits.`;
}

export function getRewindMoodDelayMultiplier(value: unknown): number {
  return 1.25 - resolveRewindConversationMood(value).energy / 200;
}
