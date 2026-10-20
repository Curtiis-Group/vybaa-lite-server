import { randomUUID } from "node:crypto";

import {
  AI_TEXT_FEATURE,
  getAiTextProviderConfig,
} from "../config/ai-provider.config";
import { prisma } from "../config/db.config";
import { FLEXX_DESIGN_CONFIG } from "../config/flexx-design.config";
import { FLEXX_RESPONSE_SCHEMA } from "../validators/flexx-design.validators";
import { parseFlexxDesignBatch } from "./flexx-design.service";
import { generateOpenRouterText } from "./openrouter-text.service";

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "P2002";
}

// Only called from the existing background AI scheduling cycle, never a feed GET.
export async function refreshScheduledFlexxDesigns(
  now = new Date(),
): Promise<{ generated: number }> {
  const cycle = Math.floor(
    now.getTime() / FLEXX_DESIGN_CONFIG.generationIntervalMs,
  );
  const id = `flexx-v3-${cycle}`;
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + FLEXX_DESIGN_CONFIG.leaseMs);
  const model = getAiTextProviderConfig(AI_TEXT_FEATURE.FLEXX_DESIGNS).model;
  try {
    await prisma.flexxDesignCollection.create({
      data: { id, model, leaseToken, leaseUntil },
    });
  } catch (error: unknown) {
    if (!isUniqueConflict(error)) throw error;
    const claimed = await prisma.flexxDesignCollection.updateMany({
      where: {
        id,
        status: { in: ["GENERATING", "FAILED"] },
        leaseUntil: { lte: now },
      },
      data: { status: "GENERATING", model, leaseToken, leaseUntil },
    });
    if (!claimed.count) return { generated: 0 };
  }
  try {
    const text = await generateOpenRouterText({
      feature: AI_TEXT_FEATURE.FLEXX_DESIGNS,
      jsonSchema: FLEXX_RESPONSE_SCHEMA,
      maxOutputTokens: FLEXX_DESIGN_CONFIG.maxOutputTokens,
      timeoutMs: FLEXX_DESIGN_CONFIG.timeoutMs,
      temperature: 0.95,
      prompt: `Design ${FLEXX_DESIGN_CONFIG.batchSize} distinct vertical editorial posters for Vybaa. Scheduled collection seed: ${cycle}. Return schema JSON only. Include all five categories, at least three palettes and three layouts. No personal facts are supplied: never invent user achievements, stats, dates, memories or progress claims. Headlines: two to five words, max 48 characters, no digits, HTML, CSS, code or URLs. Palettes: ink dark, rose pink, mint green, amber gold, slate dark blue-grey, plum deep pink. NEVER use white/off-white surfaces. Stat layouts: billboard, split, ledger, statement, ring. Each stats design has one hero metric and zero to three supporting blocks, unique slots and metrics. Allowed metrics by category: daily totalCheckIns,totalGoals,currentStreak,completionRate; weekly averageProgress,totalCheckIns,totalGoals,currentStreak,completionRate; streak currentStreak,longestStreak,totalCheckIns,completionRate; rewind rewindSessions,rewindConsistency. Achievement uses emblem, no blocks. Ring hero must be completionRate,averageProgress or rewindConsistency. Include exactly TWO questionnaire posters: category rewind, layout questionnaire, no metric blocks, questionnaire:{question,options}. Each asks one thoughtful, non-judgmental question about today with three distinct short first-person answers; custom text is handled by the UI, do not include Other. Questions should invite feelings, a meaningful moment or a gentle next step. No diagnoses, assumptions or medical claims. All other posters have questionnaire:null. Author is {partnerIds:[...]}, one to three distinct Vybaa AI partners ONLY: ella,lyra,jake,ariel,tobi,neeja. The user is NEVER an author. Include solo and partner-group authors. likedBy is an array of zero to six distinct known partner IDs representing in-world AI partner reactions; vary between none, one and multiple. Do NOT output popularity numbers or simulatedLikes. The client binds real owner metrics separately. No duplicate maps.`,
    });
    const designs = parseFlexxDesignBatch(JSON.parse(text), "all");
    if (
      designs.filter((design) => design.questionnaire).length !== 2 ||
      !designs.some((design) => design.author.partnerIds.length > 1) ||
      !designs.some((design) => design.author.partnerIds.length === 1)
    )
      throw new Error(
        "Scheduled Flexx batch must include two questionnaires and partner creator variety",
      );
    const published = await prisma.flexxDesignCollection.updateMany({
      where: { id, status: "GENERATING", leaseToken },
      data: {
        status: "READY",
        designs,
        publishedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return { generated: published.count ? designs.length : 0 };
  } catch (error: unknown) {
    await prisma.flexxDesignCollection.updateMany({
      where: { id, status: "GENERATING", leaseToken },
      data: {
        status: "FAILED",
        leaseToken: null,
        leaseUntil: new Date(
          now.getTime() + FLEXX_DESIGN_CONFIG.failureRetryMs,
        ),
      },
    });
    throw error;
  }
}
