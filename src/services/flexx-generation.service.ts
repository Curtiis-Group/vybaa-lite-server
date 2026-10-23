import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

import {
  AI_TEXT_FEATURE,
  getAiTextProviderConfig,
} from "../config/ai-provider.config";
import { prisma } from "../config/db.config";
import { FLEXX_DESIGN_CONFIG } from "../config/flexx-design.config";
import logger from "../utils/logger.util";
import { FLEXX_RESPONSE_SCHEMA } from "../validators/flexx-design.validators";
import { parseFlexxDesignBatch } from "./flexx-design.service";
import { generateOpenRouterText } from "./openrouter-text.service";
import type { FlexxDesign } from "../validators/flexx-design.validators";

type FlexxValidationIssue = {
  code: string;
  path: string;
  message: string;
};

function getValidationIssues(error: unknown): FlexxValidationIssue[] | null {
  if (error instanceof ZodError) {
    return error.issues.slice(0, 20).map((issue) => ({
      code: issue.code,
      path: issue.path.map(String).join("."),
      message: issue.message.slice(0, 180),
    }));
  }
  if (error instanceof SyntaxError) {
    return [
      {
        code: "invalid_json",
        path: "$",
        message: "Model output was not complete valid JSON",
      },
    ];
  }
  return null;
}

export function describeFlexxGenerationError(
  error: unknown,
): Record<string, unknown> {
  const issues = getValidationIssues(error);
  if (!issues) return {};
  return {
    validationIssueCount: error instanceof ZodError ? error.issues.length : 1,
    validationIssues: issues,
  };
}

function parseFlexxCandidate(text: string): FlexxDesign[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SyntaxError("Flexx model output was not valid JSON");
  }
  return parseFlexxDesignBatch(value, "all");
}

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
    const generationRequest = {
      feature: AI_TEXT_FEATURE.FLEXX_DESIGNS,
      jsonSchema: FLEXX_RESPONSE_SCHEMA,
      maxOutputTokens: FLEXX_DESIGN_CONFIG.maxOutputTokens,
      timeoutMs: FLEXX_DESIGN_CONFIG.timeoutMs,
      temperature: 0.95,
      prompt: `Design ${FLEXX_DESIGN_CONFIG.batchSize} distinct vertical social posts for Vybaa, written in the voices of its AI partners. Scheduled collection seed: ${cycle}. Return schema JSON only. Include all five categories, at least three palettes and three layouts. No personal facts are supplied: never invent user achievements, stats, dates, memories or progress claims. Headlines: two to five words, max 48 characters, no digits, HTML, CSS, code or URLs. Palettes: ink dark, rose pink, mint green, amber gold, slate dark blue-grey, plum deep pink. NEVER use white/off-white surfaces. Stat layouts: billboard, split, ledger, statement, ring. Each stats design has one hero metric and zero to three supporting blocks, unique slots and metrics. Allowed metrics by category: daily totalCheckIns,totalGoals,currentStreak,completionRate; weekly averageProgress,totalCheckIns,totalGoals,currentStreak,completionRate; streak currentStreak,longestStreak,totalCheckIns,completionRate; rewind rewindSessions,rewindConsistency. Achievement uses emblem, no blocks. Ring hero must be completionRate,averageProgress or rewindConsistency. Include exactly ${FLEXX_DESIGN_CONFIG.questionnaireCountPerBatch} questionnaire posters: category rewind, layout questionnaire, no metric blocks, questionnaire:{question,options}, editorial:null. Spread them through the batch so question-led swipes are naturally mixed with the stat posters. Each asks one thoughtful, non-judgmental question about today with three distinct short first-person answers; custom text is handled by the UI, do not include Other. The six questions must cover distinct angles: a playful this-or-that, a tiny moment worth keeping, an unexpected preference, a feeling check-in, something to let go, and a gentle next step. Write concise conversational hooks that invite a real answer, not six versions of the same mood survey. Vary the format: a tiny plot twist, a this-or-that, a word for the day, something to keep or let go. Do not make every question about productivity. Keep options warm, natural and distinctly different. No diagnoses, assumptions or medical claims. All other posters have questionnaire:null and editorial:{kind,text}. Choose kind from micro-action, reframe, reflection. Write one original 8–18 word line. Mix warm observations, playful hypotheticals, tiny experiments, surprising questions and tender reframes. Sound like a thoughtful friend posting, not a productivity dashboard or motivational poster. Ella is warm and expressive; Lyra dry and low-key; Jake direct without cruelty; Ariel reassuring; Tobi playfully funny; Neeja curious and perceptive. Match the primary author. Vary openings and sentence rhythm; some witty, some sweet, some quietly intriguing. Never shame, diagnose, flatter excessively, imply surveillance or fabricate shared memories. The client may bind a real activity fact to some posts: keep the editorial complementary, not another statistic. Make it specific to the poster's category, not generic cheerleading. Do not make research, medical or behavioral claims; do not mention numbers, dates, stats or facts about the user. Do not repeat editorial lines within this batch. Author is {partnerIds:[...]}, one to three distinct Vybaa AI partners ONLY: ella,lyra,jake,ariel,tobi,neeja. The user is NEVER an author. Include solo and partner-group authors. likedBy is an array of zero to six distinct known partner IDs representing in-world AI partner reactions; vary between none, one and multiple. Do NOT output popularity numbers or simulatedLikes. The client binds real owner metrics separately. No duplicate maps.`,
    } as const;
    const text = await generateOpenRouterText(generationRequest);
    let designs: FlexxDesign[];
    try {
      designs = parseFlexxCandidate(text);
    } catch (error: unknown) {
      const issues = getValidationIssues(error);
      if (!issues) throw error;
      logger.warn(
        "Scheduled Flexx output failed validation; requesting one correction",
        {
          validationIssueCount:
            error instanceof ZodError ? error.issues.length : issues.length,
          validationIssues: issues,
        },
      );
      const correctedText = await generateOpenRouterText({
        ...generationRequest,
        temperature: 0.55,
        prompt: `${generationRequest.prompt}\n\nThe previous complete response failed application validation. Return a corrected complete JSON response and fix every listed issue. Do not explain or omit any designs. Validation issues: ${JSON.stringify(issues)}\nPrevious response: ${text}`,
      });
      designs = parseFlexxCandidate(correctedText);
    }
    if (
      designs.filter((design) => design.questionnaire).length !==
        FLEXX_DESIGN_CONFIG.questionnaireCountPerBatch ||
      !designs.some((design) => design.author.partnerIds.length > 1) ||
      !designs.some((design) => design.author.partnerIds.length === 1)
    )
      throw new Error(
        `Scheduled Flexx batch must include ${FLEXX_DESIGN_CONFIG.questionnaireCountPerBatch} questionnaires and partner creator variety`,
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
