"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlexxAnswerError = exports.flexxAnswerInputSchema = void 0;
exports.listFlexxAnswers = listFlexxAnswers;
exports.saveFlexxAnswer = saveFlexxAnswer;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const zod_1 = require("zod");
const db_config_1 = require("../config/db.config");
const flexx_design_service_1 = require("./flexx-design.service");
const EVENT = "FLEXX_QUESTIONNAIRE_ANSWERED";
const designIdSchema = zod_1.z
    .string()
    .regex(/^collection:[A-Za-z0-9_-]{1,80}:(?:[0-9]|[1-9][0-9])$/);
exports.flexxAnswerInputSchema = zod_1.z
    .object({
    designId: designIdSchema,
    localDateKey: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    answer: zod_1.z.string().trim().min(1).max(800),
    custom: zod_1.z.boolean(),
})
    .strict();
const storedAnswerSchema = zod_1.z.object({
    answer: zod_1.z.string().min(1).max(800),
    custom: zod_1.z.boolean(),
});
class FlexxAnswerError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = "FlexxAnswerError";
    }
}
exports.FlexxAnswerError = FlexxAnswerError;
async function answerContext(userId, now) {
    const user = await db_config_1.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true, rewindPersonalizationEnabled: true },
    });
    if (!user)
        throw new FlexxAnswerError(404, "User not found");
    const local = luxon_1.DateTime.fromJSDate(now, { zone: user.timezone });
    const localDateKey = (local.isValid ? local : luxon_1.DateTime.fromJSDate(now, { zone: "UTC" })).toISODate();
    if (!localDateKey)
        throw new FlexxAnswerError(503, "Unable to determine today's date");
    return {
        localDateKey,
        personalizationEnabled: user.rewindPersonalizationEnabled,
    };
}
async function listFlexxAnswers(userId, now = new Date()) {
    const context = await answerContext(userId, now);
    const rows = await db_config_1.prisma.activitySignal.findMany({
        where: {
            userId,
            localDateKey: context.localDateKey,
            sourceType: client_1.ActivitySignalSourceType.FLEXX,
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
                contributesToReflection: row.privacyEligible && context.personalizationEnabled,
            },
        ];
    });
    return { ...context, answers };
}
async function saveFlexxAnswer(userId, payload, now = new Date()) {
    const input = exports.flexxAnswerInputSchema.parse(payload);
    const context = await answerContext(userId, now);
    if (input.localDateKey !== context.localDateKey)
        throw new FlexxAnswerError(409, "Your local day changed. Refresh and confirm your answer again.");
    const [, collectionId, indexText] = input.designId.split(":");
    if (!collectionId || !indexText)
        throw new FlexxAnswerError(400, "Invalid questionnaire identifier");
    const collection = await db_config_1.prisma.flexxDesignCollection.findFirst({
        where: { id: collectionId, status: "READY" },
        select: { designs: true },
    });
    if (!collection || !Array.isArray(collection.designs))
        throw new FlexxAnswerError(404, "Question not found");
    const index = Number(indexText);
    if (index >= collection.designs.length)
        throw new FlexxAnswerError(404, "Question not found");
    const design = (0, flexx_design_service_1.parseSavedFlexxDesign)(collection.designs[index]);
    const question = design.questionnaire;
    if (!question)
        throw new FlexxAnswerError(400, "This Flexx is not a questionnaire");
    if (!input.custom && !question.options.includes(input.answer))
        throw new FlexxAnswerError(400, "Choose one of the suggested answers or write your own");
    const saved = await db_config_1.prisma.activitySignal.upsert({
        where: {
            dedupeKey: `flexx-answer:${userId}:${context.localDateKey}:${input.designId}`,
        },
        create: {
            userId,
            localDateKey: context.localDateKey,
            sourceType: client_1.ActivitySignalSourceType.FLEXX,
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
        throw new FlexxAnswerError(409, "You have already answered this question today.");
    return {
        ...context,
        designId: input.designId,
        ...answer,
        contributesToReflection: saved.privacyEligible && context.personalizationEnabled,
    };
}
