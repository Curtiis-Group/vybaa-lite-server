"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeFlexxCursor = encodeFlexxCursor;
exports.decodeFlexxCursor = decodeFlexxCursor;
exports.decodeFlexxFeedCursor = decodeFlexxFeedCursor;
exports.fallbackFlexxDesigns = fallbackFlexxDesigns;
exports.parseFlexxDesignBatch = parseFlexxDesignBatch;
exports.parseSavedFlexxDesign = parseSavedFlexxDesign;
exports.getFlexxDesignPage = getFlexxDesignPage;
const node_crypto_1 = require("node:crypto");
const zod_1 = require("zod");
const db_config_1 = require("../config/db.config");
const flexx_design_config_1 = require("../config/flexx-design.config");
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const flexx_design_validators_1 = require("../validators/flexx-design.validators");
const FALLBACK_EDITORIALS = {
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
const cursorSchema = zod_1.z
    .object({
    category: zod_1.z.enum(["all", ...flexx_design_validators_1.flexxCategories]),
    snapshot: zod_1.z.string().datetime().optional(),
    page: zod_1.z
        .number()
        .int()
        .min(1)
        .max(flexx_design_config_1.FLEXX_DESIGN_CONFIG.maxPages - 1),
})
    .strict();
function fallbackEditorial(category, page, index) {
    const options = FALLBACK_EDITORIALS[category];
    const editorial = options[(index + page) % options.length];
    if (!editorial)
        throw new Error("Missing Flexx fallback editorial");
    return editorial;
}
function cursorSignature(payload, userId) {
    if (!env_util_1.Env.JWT_SECRET)
        throw new Error("JWT_SECRET is required for Flexx cursors");
    return (0, node_crypto_1.createHmac)("sha256", env_util_1.Env.JWT_SECRET)
        .update(`flexx:v1:${userId}:${payload}`)
        .digest("base64url");
}
function encodeFlexxCursor(category, page, userId, snapshot) {
    const payload = Buffer.from(JSON.stringify({ category, page, snapshot })).toString("base64url");
    return `${payload}.${cursorSignature(payload, userId)}`;
}
function decodeFlexxCursor(cursor, category, userId) {
    return decodeFlexxFeedCursor(cursor, category, userId).page;
}
function decodeFlexxFeedCursor(cursor, category, userId) {
    if (!cursor)
        return { page: 0 };
    if (cursor.length > 800)
        throw new Error("Invalid Flexx cursor");
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra)
        throw new Error("Invalid Flexx cursor");
    const expected = Buffer.from(cursorSignature(payload, userId));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(actual, expected))
        throw new Error("Invalid Flexx cursor");
    const decoded = cursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (decoded.category !== category)
        throw new Error("Invalid Flexx cursor");
    return { page: decoded.page, snapshot: decoded.snapshot };
}
function fallbackFlexxDesigns(category, page) {
    const categories = category === "all" ? flexx_design_validators_1.flexxCategories : [category];
    const palettes = ["rose", "ink", "amber", "mint", "slate", "plum"];
    const layouts = ["billboard", "split", "statement", "ledger"];
    const metrics = {
        daily: ["totalCheckIns", "totalGoals", "currentStreak"],
        weekly: ["averageProgress", "totalCheckIns", "totalGoals"],
        streak: ["currentStreak", "longestStreak", "totalCheckIns"],
        rewind: ["rewindSessions", "rewindConsistency"],
        achievement: [],
    };
    return Array.from({ length: flexx_design_config_1.FLEXX_DESIGN_CONFIG.batchSize }, (_, index) => {
        const type = categories[index % categories.length] ?? "daily";
        const names = metrics[type];
        const slots = ["hero", "bottomLeft", "bottomRight"];
        return flexx_design_validators_1.flexxDesignSchema.parse({
            category: type,
            author: {
                partnerIds: index % 3 === 2
                    ? ["ella", "lyra"]
                    : [flexx_design_validators_1.flexxPartners[index % flexx_design_validators_1.flexxPartners.length]],
            },
            likedBy: [],
            questionnaire: null,
            editorial: fallbackEditorial(type, page, index),
            layout: type === "achievement"
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
function parseFlexxDesignBatch(value, category) {
    const parsed = zod_1.z
        .object({
        designs: zod_1.z.array(flexx_design_validators_1.flexxDesignSchema).length(flexx_design_config_1.FLEXX_DESIGN_CONFIG.batchSize),
    })
        .strict()
        .parse(value);
    if (category !== "all" &&
        parsed.designs.some((design) => design.category !== category))
        throw new Error("Generated category does not match the requested feed");
    if (category === "all" &&
        new Set(parsed.designs.map((design) => design.category)).size !==
            flexx_design_validators_1.flexxCategories.length)
        throw new Error("Mixed Flexx batch must cover every category");
    if (parsed.designs.some((design) => !design.questionnaire && !design.editorial))
        throw new Error("Every non-question Flexx design needs editorial content");
    const editorialCopy = parsed.designs.flatMap((design) => design.editorial ? [design.editorial.text.toLocaleLowerCase("en-US")] : []);
    if (new Set(editorialCopy).size !== editorialCopy.length)
        throw new Error("Flexx editorial copy must be distinct within a batch");
    const signatures = parsed.designs.map((design) => JSON.stringify(design));
    if (new Set(signatures).size !== signatures.length)
        throw new Error("Duplicate Flexx designs");
    if (new Set(parsed.designs.map((design) => design.palette)).size < 3 ||
        new Set(parsed.designs.map((design) => design.layout)).size <
            (category === "achievement" ? 1 : 3))
        throw new Error("Flexx batch needs visual variety");
    return parsed.designs;
}
// Preserve old published collections, while never attributing a poster to a user.
function parseSavedFlexxDesign(value) {
    const record = zod_1.z.record(zod_1.z.unknown()).parse(value);
    if ("likedBy" in record)
        return flexx_design_validators_1.flexxDesignSchema.parse({
            ...record,
            editorial: record.editorial ?? null,
        });
    const legacy = zod_1.z
        .object({
        kind: zod_1.z.enum(["self", "partner", "group"]),
        partnerId: zod_1.z.enum(flexx_design_validators_1.flexxPartners).nullable(),
    })
        .parse(record.author);
    const primary = legacy.partnerId ?? "ella";
    const partnerIds = legacy.kind === "group"
        ? [primary, primary === "ella" ? "lyra" : "ella"]
        : [primary];
    const { simulatedLikes: _oldCount, author: _oldAuthor, ...rest } = record;
    return flexx_design_validators_1.flexxDesignSchema.parse({
        ...rest,
        palette: record.palette === "paper" ? "slate" : record.palette,
        author: { partnerIds },
        likedBy: [],
        questionnaire: null,
        editorial: record.editorial ?? null,
    });
}
async function getFlexxDesignPage(params) {
    const { category, page, userId } = params;
    if (!Number.isInteger(page) ||
        page < 0 ||
        page >= flexx_design_config_1.FLEXX_DESIGN_CONFIG.maxPages)
        throw new Error("Invalid Flexx page");
    const snapshot = zod_1.z
        .string()
        .datetime()
        .parse(params.snapshot ?? new Date().toISOString());
    const collections = await db_config_1.prisma.flexxDesignCollection.findMany({
        where: { status: "READY", publishedAt: { lte: new Date(snapshot) } },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        take: flexx_design_config_1.FLEXX_DESIGN_CONFIG.maxCollections,
        select: { id: true, designs: true },
    });
    const available = collections
        .flatMap((collection) => {
        let designs;
        try {
            designs = zod_1.z
                .array(zod_1.z.unknown())
                .max(flexx_design_config_1.FLEXX_DESIGN_CONFIG.batchSize)
                .parse(collection.designs)
                .map(parseSavedFlexxDesign);
        }
        catch {
            logger_util_1.default.warn("Skipping invalid saved Flexx collection", {
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
    const start = page * flexx_design_config_1.FLEXX_DESIGN_CONFIG.batchSize;
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
        designs: available.slice(start, start + flexx_design_config_1.FLEXX_DESIGN_CONFIG.batchSize),
        nextCursor: start + flexx_design_config_1.FLEXX_DESIGN_CONFIG.batchSize < available.length &&
            page + 1 < flexx_design_config_1.FLEXX_DESIGN_CONFIG.maxPages
            ? encodeFlexxCursor(category, page + 1, userId, snapshot)
            : null,
    };
}
