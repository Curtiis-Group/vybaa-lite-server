"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLEXX_RESPONSE_SCHEMA = exports.flexxFeedQuerySchema = exports.flexxDesignSchema = exports.flexxSlots = exports.flexxMetrics = exports.flexxPalettes = exports.flexxLayouts = exports.flexxCategories = exports.flexxEditorialSchema = exports.flexxQuestionSchema = exports.flexxAuthorSchema = exports.flexxPartners = void 0;
const zod_1 = require("zod");
exports.flexxPartners = [
    "ella",
    "lyra",
    "jake",
    "ariel",
    "tobi",
    "neeja",
];
exports.flexxAuthorSchema = zod_1.z
    .object({
    partnerIds: zod_1.z.array(zod_1.z.enum(exports.flexxPartners)).min(1).max(3),
})
    .strict()
    .refine((author) => new Set(author.partnerIds).size === author.partnerIds.length, "Authors must be distinct known partners");
exports.flexxQuestionSchema = zod_1.z
    .object({
    question: zod_1.z.string().trim().min(8).max(180),
    options: zod_1.z.array(zod_1.z.string().trim().min(1).max(64)).min(2).max(4),
})
    .strict()
    .refine((question) => new Set(question.options).size === question.options.length, "Answers must be distinct");
exports.flexxEditorialSchema = zod_1.z
    .object({
    kind: zod_1.z.enum(["micro-action", "reflection", "reframe"]),
    text: zod_1.z
        .string()
        .trim()
        .min(12)
        .max(140)
        .refine((text) => !/https?:\/\/|www\.|<[^>]*>/i.test(text), "Editorial copy must be plain text"),
})
    .strict();
exports.flexxCategories = [
    "daily",
    "weekly",
    "streak",
    "rewind",
    "achievement",
];
exports.flexxLayouts = [
    "billboard",
    "split",
    "ledger",
    "ring",
    "statement",
    "emblem",
    "questionnaire",
];
exports.flexxPalettes = [
    "ink",
    "rose",
    "mint",
    "amber",
    "slate",
    "plum",
];
exports.flexxMetrics = [
    "totalGoals",
    "totalCheckIns",
    "currentStreak",
    "longestStreak",
    "completionRate",
    "averageProgress",
    "rewindSessions",
    "rewindConsistency",
];
exports.flexxSlots = [
    "hero",
    "aside",
    "bottomLeft",
    "bottomRight",
];
const metricsByCategory = {
    daily: ["totalGoals", "totalCheckIns", "currentStreak", "completionRate"],
    weekly: [
        "totalGoals",
        "totalCheckIns",
        "currentStreak",
        "averageProgress",
        "completionRate",
    ],
    streak: ["currentStreak", "longestStreak", "totalCheckIns", "completionRate"],
    rewind: ["rewindSessions", "rewindConsistency"],
    achievement: [],
};
// AI chooses a composition; it never supplies user values, HTML, CSS or URLs.
exports.flexxDesignSchema = zod_1.z
    .object({
    category: zod_1.z.enum(exports.flexxCategories),
    layout: zod_1.z.enum(exports.flexxLayouts),
    palette: zod_1.z.enum(exports.flexxPalettes),
    headline: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(48)
        .regex(/^[\p{L}\s.,!?&'’—-]+$/u),
    align: zod_1.z.enum(["left", "center"]),
    symbol: zod_1.z.enum(["bolt", "flame", "spark", "rewind", "trophy"]),
    author: exports.flexxAuthorSchema,
    likedBy: zod_1.z
        .array(zod_1.z.enum(exports.flexxPartners))
        .max(6)
        .refine((ids) => new Set(ids).size === ids.length, "Duplicate partner reactions"),
    questionnaire: exports.flexxQuestionSchema.nullable(),
    editorial: exports.flexxEditorialSchema.nullable(),
    blocks: zod_1.z
        .array(zod_1.z
        .object({
        slot: zod_1.z.enum(exports.flexxSlots),
        metric: zod_1.z.enum(exports.flexxMetrics),
    })
        .strict())
        .max(4),
})
    .strict()
    .superRefine((design, context) => {
    const allowed = metricsByCategory[design.category];
    if (design.questionnaire) {
        if (design.category !== "rewind" ||
            design.layout !== "questionnaire" ||
            design.blocks.length ||
            design.editorial)
            context.addIssue({
                code: "custom",
                message: "Questionnaires use a Rewind questionnaire layout without stats",
            });
        return;
    }
    if (design.layout === "questionnaire")
        context.addIssue({
            code: "custom",
            message: "Questionnaire content is required",
        });
    if (design.category === "achievement") {
        if (design.blocks.length || design.layout !== "emblem")
            context.addIssue({
                code: "custom",
                message: "Achievement designs use an emblem and no numeric bindings",
            });
        return;
    }
    if (design.layout === "emblem")
        context.addIssue({
            code: "custom",
            message: "Emblems are for earned achievements",
        });
    const slots = design.blocks.map((block) => block.slot);
    const metrics = design.blocks.map((block) => block.metric);
    if (!slots.includes("hero") ||
        new Set(slots).size !== slots.length ||
        new Set(metrics).size !== metrics.length)
        context.addIssue({
            code: "custom",
            message: "One hero and unique slots and metrics are required",
        });
    if (metrics.some((metric) => !allowed.includes(metric)))
        context.addIssue({
            code: "custom",
            message: "Metric does not belong to this category",
        });
    if (design.layout === "ring" &&
        !["completionRate", "averageProgress", "rewindConsistency"].includes(design.blocks.find((block) => block.slot === "hero")?.metric ?? ""))
        context.addIssue({
            code: "custom",
            message: "Rings require a real percentage",
        });
});
exports.flexxFeedQuerySchema = zod_1.z
    .object({
    category: zod_1.z.enum(["all", ...exports.flexxCategories]).default("all"),
    cursor: zod_1.z.string().max(800).optional(),
})
    .strict();
// Explicit JSON schema keeps nullable/required rules compatible with strict providers.
exports.FLEXX_RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["designs"],
    properties: {
        designs: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: [
                    "category",
                    "layout",
                    "palette",
                    "headline",
                    "align",
                    "symbol",
                    "blocks",
                    "author",
                    "likedBy",
                    "questionnaire",
                    "editorial",
                ],
                properties: {
                    category: { type: "string", enum: [...exports.flexxCategories] },
                    layout: { type: "string", enum: [...exports.flexxLayouts] },
                    palette: { type: "string", enum: [...exports.flexxPalettes] },
                    headline: { type: "string" },
                    author: {
                        type: "object",
                        additionalProperties: false,
                        required: ["partnerIds"],
                        properties: {
                            partnerIds: {
                                type: "array",
                                items: { type: "string", enum: [...exports.flexxPartners] },
                            },
                        },
                    },
                    likedBy: {
                        type: "array",
                        items: { type: "string", enum: [...exports.flexxPartners] },
                    },
                    questionnaire: {
                        anyOf: [
                            { type: "null" },
                            {
                                type: "object",
                                additionalProperties: false,
                                required: ["question", "options"],
                                properties: {
                                    question: { type: "string" },
                                    options: { type: "array", items: { type: "string" } },
                                },
                            },
                        ],
                    },
                    editorial: {
                        anyOf: [
                            { type: "null" },
                            {
                                type: "object",
                                additionalProperties: false,
                                required: ["kind", "text"],
                                properties: {
                                    kind: {
                                        type: "string",
                                        enum: ["micro-action", "reflection", "reframe"],
                                    },
                                    text: { type: "string" },
                                },
                            },
                        ],
                    },
                    align: { type: "string", enum: ["left", "center"] },
                    symbol: {
                        type: "string",
                        enum: ["bolt", "flame", "spark", "rewind", "trophy"],
                    },
                    blocks: {
                        type: "array",
                        items: {
                            type: "object",
                            additionalProperties: false,
                            required: ["slot", "metric"],
                            properties: {
                                slot: { type: "string", enum: [...exports.flexxSlots] },
                                metric: { type: "string", enum: [...exports.flexxMetrics] },
                            },
                        },
                    },
                },
            },
        },
    },
};
