import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "../config/db.config";
import { FLEXX_DESIGN_CONFIG } from "../config/flexx-design.config";
import { Env } from "../utils/env.util";
import logger from "../utils/logger.util";
import {
  flexxCategories,
  flexxDesignSchema,
  flexxPartners,
} from "../validators/flexx-design.validators";
import type { FlexxDesign } from "../validators/flexx-design.validators";

type Category = "all" | (typeof flexxCategories)[number];
const FALLBACK_EDITORIALS: Record<
  (typeof flexxCategories)[number],
  NonNullable<FlexxDesign["editorial"]>[]
> = {
  daily: [
    {
      kind: "micro-action",
      text: "Choose one small task that fits the day you actually have.",
    },
    {
      kind: "reframe",
      text: "A check-in can be a reset, not a report card.",
    },
    {
      kind: "reflection",
      text: "What made it easier to show up for yourself today?",
    },
  ],
  weekly: [
    {
      kind: "reflection",
      text: "Which part of your week felt most like the direction you want?",
    },
    {
      kind: "micro-action",
      text: "Keep one thing that worked; let the rest stay editable.",
    },
    {
      kind: "reframe",
      text: "A useful week is not always a perfectly productive one.",
    },
  ],
  streak: [
    {
      kind: "reframe",
      text: "A streak is a rhythm, not a promise to be perfect.",
    },
    {
      kind: "micro-action",
      text: "Make the next return easy: decide on one tiny first step.",
    },
    {
      kind: "reflection",
      text: "What helps you come back when a routine gets interrupted?",
    },
  ],
  rewind: [
    {
      kind: "reflection",
      text: "Name one moment from today before you decide what it meant.",
    },
    {
      kind: "micro-action",
      text: "Take one quiet minute and write what you need next.",
    },
    {
      kind: "reframe",
      text: "Your reflection can be honest without being perfectly worded.",
    },
  ],
  achievement: [
    {
      kind: "reflection",
      text: "Pause long enough to notice the effort behind this milestone.",
    },
    {
      kind: "reframe",
      text: "Let this be a marker of effort, not pressure to do more.",
    },
    {
      kind: "micro-action",
      text: "Choose one small way to celebrate how far you have come.",
    },
  ],
};
const cursorSchema = z
  .object({
    category: z.enum(["all", ...flexxCategories]),
    snapshot: z.string().datetime().optional(),
    page: z
      .number()
      .int()
      .min(1)
      .max(FLEXX_DESIGN_CONFIG.maxPages - 1),
  })
  .strict();

function fallbackEditorial(
  category: (typeof flexxCategories)[number],
  page: number,
  index: number,
): NonNullable<FlexxDesign["editorial"]> {
  const options = FALLBACK_EDITORIALS[category];
  const editorial = options[(index + page) % options.length];
  if (!editorial) throw new Error("Missing Flexx fallback editorial");
  return editorial;
}

function cursorSignature(payload: string, userId: string): string {
  if (!Env.JWT_SECRET)
    throw new Error("JWT_SECRET is required for Flexx cursors");
  return createHmac("sha256", Env.JWT_SECRET)
    .update(`flexx:v1:${userId}:${payload}`)
    .digest("base64url");
}

export function encodeFlexxCursor(
  category: Category,
  page: number,
  userId: string,
  snapshot?: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ category, page, snapshot }),
  ).toString("base64url");
  return `${payload}.${cursorSignature(payload, userId)}`;
}

export function decodeFlexxCursor(
  cursor: string | undefined,
  category: Category,
  userId: string,
): number {
  return decodeFlexxFeedCursor(cursor, category, userId).page;
}

export function decodeFlexxFeedCursor(
  cursor: string | undefined,
  category: Category,
  userId: string,
): { page: number; snapshot?: string } {
  if (!cursor) return { page: 0 };
  if (cursor.length > 800) throw new Error("Invalid Flexx cursor");
  const [payload, signature, extra] = cursor.split(".");
  if (!payload || !signature || extra) throw new Error("Invalid Flexx cursor");
  const expected = Buffer.from(cursorSignature(payload, userId));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("Invalid Flexx cursor");
  const decoded = cursorSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
  if (decoded.category !== category) throw new Error("Invalid Flexx cursor");
  return { page: decoded.page, snapshot: decoded.snapshot };
}

export function fallbackFlexxDesigns(
  category: Category,
  page: number,
): FlexxDesign[] {
  const categories = category === "all" ? flexxCategories : [category];
  const palettes = ["rose", "ink", "amber", "mint", "slate", "plum"] as const;
  const layouts = ["billboard", "split", "statement", "ledger"] as const;
  const metrics: Record<
    (typeof flexxCategories)[number],
    FlexxDesign["blocks"][number]["metric"][]
  > = {
    daily: ["totalCheckIns", "totalGoals", "currentStreak"],
    weekly: ["averageProgress", "totalCheckIns", "totalGoals"],
    streak: ["currentStreak", "longestStreak", "totalCheckIns"],
    rewind: ["rewindSessions", "rewindConsistency"],
    achievement: [],
  };
  return Array.from({ length: FLEXX_DESIGN_CONFIG.batchSize }, (_, index) => {
    const type = categories[index % categories.length] ?? "daily";
    const names = metrics[type];
    const slots = ["hero", "bottomLeft", "bottomRight"] as const;
    return flexxDesignSchema.parse({
      category: type,
      author: {
        partnerIds:
          index % 3 === 2
            ? ["ella", "lyra"]
            : [flexxPartners[index % flexxPartners.length]],
      },
      likedBy: [],
      questionnaire: null,
      editorial: fallbackEditorial(type, page, index),
      layout:
        type === "achievement"
          ? "emblem"
          : layouts[(index + page) % layouts.length],
      palette: palettes[(index + page * 3) % palettes.length],
      headline: {
        daily: "Showed up.",
        weekly: "The bigger picture.",
        streak: "Still going.",
        rewind: "Room to reflect.",
        achievement: "Earned, not given.",
      }[type],
      align: index % 2 ? "center" : "left",
      symbol: {
        daily: "bolt",
        weekly: "spark",
        streak: "flame",
        rewind: "rewind",
        achievement: "trophy",
      }[type],
      blocks: names.map((metric, position) => ({
        metric,
        slot: slots[position],
      })),
    });
  });
}

export function parseFlexxDesignBatch(
  value: unknown,
  category: Category,
): FlexxDesign[] {
  const parsed = z
    .object({
      designs: z.array(flexxDesignSchema).length(FLEXX_DESIGN_CONFIG.batchSize),
    })
    .strict()
    .parse(value);
  if (
    category !== "all" &&
    parsed.designs.some((design) => design.category !== category)
  )
    throw new Error("Generated category does not match the requested feed");
  if (
    category === "all" &&
    new Set(parsed.designs.map((design) => design.category)).size !==
      flexxCategories.length
  )
    throw new Error("Mixed Flexx batch must cover every category");
  if (
    parsed.designs.some((design) => !design.questionnaire && !design.editorial)
  )
    throw new Error("Every non-question Flexx design needs editorial content");
  const editorialCopy = parsed.designs.flatMap((design) =>
    design.editorial ? [design.editorial.text.toLocaleLowerCase("en-US")] : [],
  );
  if (new Set(editorialCopy).size !== editorialCopy.length)
    throw new Error("Flexx editorial copy must be distinct within a batch");
  const signatures = parsed.designs.map((design) => JSON.stringify(design));
  if (new Set(signatures).size !== signatures.length)
    throw new Error("Duplicate Flexx designs");
  if (
    new Set(parsed.designs.map((design) => design.palette)).size < 3 ||
    new Set(parsed.designs.map((design) => design.layout)).size <
      (category === "achievement" ? 1 : 3)
  )
    throw new Error("Flexx batch needs visual variety");
  return parsed.designs;
}

// Preserve old published collections, while never attributing a poster to a user.
export function parseSavedFlexxDesign(value: unknown): FlexxDesign {
  const record = z.record(z.unknown()).parse(value);
  if ("likedBy" in record)
    return flexxDesignSchema.parse({
      ...record,
      editorial: record.editorial ?? null,
    });
  const legacy = z
    .object({
      kind: z.enum(["self", "partner", "group"]),
      partnerId: z.enum(flexxPartners).nullable(),
    })
    .parse(record.author);
  const primary = legacy.partnerId ?? "ella";
  const partnerIds =
    legacy.kind === "group"
      ? [primary, primary === "ella" ? "lyra" : "ella"]
      : [primary];
  const { simulatedLikes: _oldCount, author: _oldAuthor, ...rest } = record;
  return flexxDesignSchema.parse({
    ...rest,
    palette: record.palette === "paper" ? "slate" : record.palette,
    author: { partnerIds },
    likedBy: [],
    questionnaire: null,
    editorial: record.editorial ?? null,
  });
}

export async function getFlexxDesignPage(params: {
  category: Category;
  page: number;
  userId: string;
  snapshot?: string;
}) {
  const { category, page, userId } = params;
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    page >= FLEXX_DESIGN_CONFIG.maxPages
  )
    throw new Error("Invalid Flexx page");
  const snapshot = z
    .string()
    .datetime()
    .parse(params.snapshot ?? new Date().toISOString());
  const collections = await prisma.flexxDesignCollection.findMany({
    where: { status: "READY", publishedAt: { lte: new Date(snapshot) } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: FLEXX_DESIGN_CONFIG.maxCollections,
    select: { id: true, designs: true },
  });
  const available = collections
    .flatMap((collection) => {
      let designs: FlexxDesign[];
      try {
        designs = z
          .array(z.unknown())
          .max(FLEXX_DESIGN_CONFIG.batchSize)
          .parse(collection.designs)
          .map(parseSavedFlexxDesign);
      } catch {
        logger.warn("Skipping invalid saved Flexx collection", {
          collectionId: collection.id,
        });
        return [];
      }
      return designs.map((design, index) => ({
        ...design,
        id: `collection:${collection.id}:${index}`,
      }));
    })
    .filter((design) => category === "all" || design.category === category);
  const start = page * FLEXX_DESIGN_CONFIG.batchSize;
  if (!available.length && page === 0) {
    return {
      version: 1,
      source: "fallback",
      designs: fallbackFlexxDesigns(category, 0).map((design, index) => ({
        ...design,
        id: `fallback:${category}:${index}`,
      })),
      nextCursor: null,
    };
  }
  return {
    version: 1,
    source: "ai",
    designs: available.slice(start, start + FLEXX_DESIGN_CONFIG.batchSize),
    nextCursor:
      start + FLEXX_DESIGN_CONFIG.batchSize < available.length &&
      page + 1 < FLEXX_DESIGN_CONFIG.maxPages
        ? encodeFlexxCursor(category, page + 1, userId, snapshot)
        : null,
  };
}
