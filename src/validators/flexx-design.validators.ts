import { z } from "zod";

export const flexxPartners = [
  "ella",
  "lyra",
  "jake",
  "ariel",
  "tobi",
  "neeja",
] as const;
export const flexxAuthorSchema = z
  .object({
    partnerIds: z.array(z.enum(flexxPartners)).min(1).max(3),
  })
  .strict()
  .refine(
    (author) => new Set(author.partnerIds).size === author.partnerIds.length,
    "Authors must be distinct known partners",
  );
export const flexxQuestionSchema = z
  .object({
    question: z.string().trim().min(8).max(180),
    options: z.array(z.string().trim().min(1).max(64)).min(2).max(4),
  })
  .strict()
  .refine(
    (question) => new Set(question.options).size === question.options.length,
    "Answers must be distinct",
  );

export const flexxCategories = [
  "daily",
  "weekly",
  "streak",
  "rewind",
  "achievement",
] as const;
export const flexxLayouts = [
  "billboard",
  "split",
  "ledger",
  "ring",
  "statement",
  "emblem",
  "questionnaire",
] as const;
export const flexxPalettes = [
  "ink",
  "rose",
  "mint",
  "amber",
  "slate",
  "plum",
] as const;
export const flexxMetrics = [
  "totalGoals",
  "totalCheckIns",
  "currentStreak",
  "longestStreak",
  "completionRate",
  "averageProgress",
  "rewindSessions",
  "rewindConsistency",
] as const;
export const flexxSlots = [
  "hero",
  "aside",
  "bottomLeft",
  "bottomRight",
] as const;

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
} satisfies Record<(typeof flexxCategories)[number], string[]>;

// AI chooses a composition; it never supplies user values, HTML, CSS or URLs.
export const flexxDesignSchema = z
  .object({
    category: z.enum(flexxCategories),
    layout: z.enum(flexxLayouts),
    palette: z.enum(flexxPalettes),
    headline: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .regex(/^[\p{L}\s.,!?&'’—-]+$/u),
    align: z.enum(["left", "center"]),
    symbol: z.enum(["bolt", "flame", "spark", "rewind", "trophy"]),
    author: flexxAuthorSchema,
    likedBy: z
      .array(z.enum(flexxPartners))
      .max(6)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Duplicate partner reactions",
      ),
    questionnaire: flexxQuestionSchema.nullable(),
    blocks: z
      .array(
        z
          .object({
            slot: z.enum(flexxSlots),
            metric: z.enum(flexxMetrics),
          })
          .strict(),
      )
      .max(4),
  })
  .strict()
  .superRefine((design, context) => {
    const allowed: string[] = metricsByCategory[design.category];
    if (design.questionnaire) {
      if (
        design.category !== "rewind" ||
        design.layout !== "questionnaire" ||
        design.blocks.length
      )
        context.addIssue({
          code: "custom",
          message:
            "Questionnaires use a Rewind questionnaire layout without stats",
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
    if (
      !slots.includes("hero") ||
      new Set(slots).size !== slots.length ||
      new Set(metrics).size !== metrics.length
    )
      context.addIssue({
        code: "custom",
        message: "One hero and unique slots and metrics are required",
      });
    if (metrics.some((metric) => !allowed.includes(metric)))
      context.addIssue({
        code: "custom",
        message: "Metric does not belong to this category",
      });
    if (
      design.layout === "ring" &&
      !["completionRate", "averageProgress", "rewindConsistency"].includes(
        design.blocks.find((block) => block.slot === "hero")?.metric ?? "",
      )
    )
      context.addIssue({
        code: "custom",
        message: "Rings require a real percentage",
      });
  });

export type FlexxDesign = z.infer<typeof flexxDesignSchema>;
export const flexxFeedQuerySchema = z
  .object({
    category: z.enum(["all", ...flexxCategories]).default("all"),
    cursor: z.string().max(800).optional(),
  })
  .strict();

// Explicit JSON schema keeps nullable/required rules compatible with strict providers.
export const FLEXX_RESPONSE_SCHEMA: Record<string, unknown> = {
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
        ],
        properties: {
          category: { type: "string", enum: [...flexxCategories] },
          layout: { type: "string", enum: [...flexxLayouts] },
          palette: { type: "string", enum: [...flexxPalettes] },
          headline: { type: "string" },
          author: {
            type: "object",
            additionalProperties: false,
            required: ["partnerIds"],
            properties: {
              partnerIds: {
                type: "array",
                items: { type: "string", enum: [...flexxPartners] },
              },
            },
          },
          likedBy: {
            type: "array",
            items: { type: "string", enum: [...flexxPartners] },
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
                slot: { type: "string", enum: [...flexxSlots] },
                metric: { type: "string", enum: [...flexxMetrics] },
              },
            },
          },
        },
      },
    },
  },
};
