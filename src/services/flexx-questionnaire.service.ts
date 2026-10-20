import { ActivitySignalSourceType } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";

import { prisma } from "../config/db.config";
import { parseSavedFlexxDesign } from "./flexx-design.service";

const EVENT = "FLEXX_QUESTIONNAIRE_ANSWERED";
const designIdSchema = z
  .string()
  .regex(/^collection:[A-Za-z0-9_-]{1,80}:(?:[0-9]|[1-9][0-9])$/);
export const flexxAnswerInputSchema = z
  .object({
    designId: designIdSchema,
    localDateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    answer: z.string().trim().min(1).max(800),
    custom: z.boolean(),
  })
  .strict();
const storedAnswerSchema = z.object({
  answer: z.string().min(1).max(800),
  custom: z.boolean(),
});

export class FlexxAnswerError extends Error {
  public constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "FlexxAnswerError";
  }
}

async function answerContext(userId: string, now: Date) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true, rewindPersonalizationEnabled: true },
  });
  if (!user) throw new FlexxAnswerError(404, "User not found");
  const local = DateTime.fromJSDate(now, { zone: user.timezone });
  const localDateKey = (
    local.isValid ? local : DateTime.fromJSDate(now, { zone: "UTC" })
  ).toISODate();
  if (!localDateKey)
    throw new FlexxAnswerError(503, "Unable to determine today's date");
  return {
    localDateKey,
    personalizationEnabled: user.rewindPersonalizationEnabled,
  };
}

export async function listFlexxAnswers(userId: string, now = new Date()) {
  const context = await answerContext(userId, now);
  const rows = await prisma.activitySignal.findMany({
    where: {
      userId,
      localDateKey: context.localDateKey,
      sourceType: ActivitySignalSourceType.FLEXX,
      eventType: EVENT,
    },
    orderBy: [{ happenedAt: "desc" }, { id: "desc" }],
    take: 300,
    select: { sourceId: true, metadata: true, privacyEligible: true },
  });
  const answers = rows.flatMap((row) => {
    const parsed = storedAnswerSchema.safeParse(row.metadata);
    if (!parsed.success || !designIdSchema.safeParse(row.sourceId).success)
      return [];
    return [
      {
        designId: row.sourceId,
        ...parsed.data,
        contributesToReflection:
          row.privacyEligible && context.personalizationEnabled,
      },
    ];
  });
  return { ...context, answers };
}

export async function saveFlexxAnswer(
  userId: string,
  payload: z.infer<typeof flexxAnswerInputSchema>,
  now = new Date(),
) {
  const input = flexxAnswerInputSchema.parse(payload);
  const context = await answerContext(userId, now);
  if (input.localDateKey !== context.localDateKey)
    throw new FlexxAnswerError(
      409,
      "Your local day changed. Refresh and confirm your answer again.",
    );
  const [, collectionId, indexText] = input.designId.split(":");
  if (!collectionId || !indexText)
    throw new FlexxAnswerError(400, "Invalid questionnaire identifier");
  const collection = await prisma.flexxDesignCollection.findFirst({
    where: { id: collectionId, status: "READY" },
    select: { designs: true },
  });
  if (!collection || !Array.isArray(collection.designs))
    throw new FlexxAnswerError(404, "Question not found");
  const index = Number(indexText);
  if (index >= collection.designs.length)
    throw new FlexxAnswerError(404, "Question not found");
  const design = parseSavedFlexxDesign(collection.designs[index]);
  const question = design.questionnaire;
  if (!question)
    throw new FlexxAnswerError(400, "This Flexx is not a questionnaire");
  if (!input.custom && !question.options.includes(input.answer))
    throw new FlexxAnswerError(
      400,
      "Choose one of the suggested answers or write your own",
    );
  const saved = await prisma.activitySignal.upsert({
    where: {
      dedupeKey: `flexx-answer:${userId}:${context.localDateKey}:${input.designId}`,
    },
    create: {
      userId,
      localDateKey: context.localDateKey,
      sourceType: ActivitySignalSourceType.FLEXX,
      sourceId: input.designId,
      eventType: EVENT,
      happenedAt: now,
      dedupeKey: `flexx-answer:${userId}:${context.localDateKey}:${input.designId}`,
      description: `Daily reflection answer to “${question.question}”: “${input.answer}”. This is the user's explicit answer, not an inferred feeling.`,
      metadata: {
        answer: input.answer,
        custom: input.custom,
        question: question.question,
        partnerIds: design.author.partnerIds,
      },
      personaId: design.author.partnerIds[0],
      privacyEligible: context.personalizationEnabled,
    },
    // Once per local day: retries cannot overwrite an already recorded answer.
    update: {},
    select: { metadata: true, privacyEligible: true },
  });
  const answer = storedAnswerSchema.parse(saved.metadata);
  if (answer.answer !== input.answer || answer.custom !== input.custom)
    throw new FlexxAnswerError(
      409,
      "You have already answered this question today.",
    );
  return {
    ...context,
    designId: input.designId,
    ...answer,
    contributesToReflection:
      saved.privacyEligible && context.personalizationEnabled,
  };
}
