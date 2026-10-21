import { createHash } from "node:crypto";
import type { ActivitySignal } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";

import { prisma } from "../config/db.config";

const suggestionSchema = z.object({
  title: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(3).max(220),
  signalIds: z.array(z.string().min(1).max(128)).min(1).max(3),
});

export type GeneratedTaskSuggestion = z.infer<typeof suggestionSchema>;
export interface QuickTaskSuggestion {
  id: string;
  title: string;
  reason: string;
}

export const TASK_SUGGESTIONS_RESPONSE_SCHEMA = {
  type: "array",
  maxItems: 3,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      reason: { type: "string" },
      signalIds: { type: "array", items: { type: "string" } },
    },
    required: ["title", "reason", "signalIds"],
  },
};

export function taskTitleKey(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Suggestions are optional: malformed extras must never break the daily observation.
export function parseTaskSuggestions(
  value: unknown,
): GeneratedTaskSuggestion[] {
  if (!Array.isArray(value)) return [];
  const suggestions: GeneratedTaskSuggestion[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, 10)) {
    const parsed = suggestionSchema.safeParse(entry);
    if (!parsed.success) continue;
    const key = taskTitleKey(parsed.data.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    suggestions.push(parsed.data);
    if (suggestions.length === 3) break;
  }
  return suggestions;
}

export function groundTaskSuggestions(
  suggestions: GeneratedTaskSuggestion[],
  signals: Pick<ActivitySignal, "id" | "privacyEligible" | "sourceType">[],
  existingTitles: string[] = [],
): GeneratedTaskSuggestion[] {
  const eligible = new Set(
    signals
      .filter(
        (signal) =>
          signal.privacyEligible &&
          signal.sourceType !== "REWARD" &&
          signal.sourceType !== "ACHIEVEMENT",
      )
      .map((signal) => signal.id),
  );
  const existing = new Set(existingTitles.map(taskTitleKey));
  return suggestions.filter(
    (suggestion) =>
      !existing.has(taskTitleKey(suggestion.title)) &&
      suggestion.signalIds.every((id) => eligible.has(id)),
  );
}

export async function listQuickTaskSuggestions(
  userId: string,
): Promise<QuickTaskSuggestion[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, rewindPersonalizationEnabled: true },
  });
  if (!user?.rewindPersonalizationEnabled) return [];
  const localNow = DateTime.now().setZone(user.timezone);
  const now = localNow.isValid ? localNow : DateTime.utc();
  const [observations, goals] = await Promise.all([
    prisma.dailyObservation.findMany({
      where: {
        userId,
        dismissedAt: null,
        localDateKey: {
          gte: now.minus({ days: 2 }).toISODate() ?? "",
          lte: now.toISODate() ?? "",
        },
      },
      select: { id: true, taskSuggestions: true },
      orderBy: [{ localDateKey: "desc" }, { id: "desc" }],
      take: 3,
    }),
    prisma.goalV2.findMany({
      where: {
        userId,
        OR: [
          { status: { in: ["ACTIVE", "PAUSED"] }, archivedAt: null },
          { createdAt: { gte: now.minus({ days: 3 }).toJSDate() } },
        ],
      },
      select: { title: true },
    }),
  ]);
  const candidates = observations.flatMap((observation) =>
    parseTaskSuggestions(observation.taskSuggestions),
  );
  if (!candidates.length) return [];
  // Recheck ownership and privacy against live evidence, not just saved AI references.
  const signals = await prisma.activitySignal.findMany({
    where: {
      userId,
      privacyEligible: true,
      id: { in: [...new Set(candidates.flatMap((item) => item.signalIds))] },
    },
    select: { id: true, privacyEligible: true, sourceType: true },
  });
  const grounded = groundTaskSuggestions(
    candidates,
    signals,
    goals.map((goal) => goal.title),
  );
  const seen = new Set<string>();
  const items: QuickTaskSuggestion[] = [];
  for (const suggestion of grounded) {
    const key = taskTitleKey(suggestion.title);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: createHash("sha256")
        .update(`${userId}:${key}`)
        .digest("hex")
        .slice(0, 24),
      title: suggestion.title,
      reason: suggestion.reason,
    });
    if (items.length === 3) break;
  }
  return items;
}
