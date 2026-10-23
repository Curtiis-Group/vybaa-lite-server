"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.timelineToday = timelineToday;
exports.encodeTimelineCursor = encodeTimelineCursor;
exports.decodeTimelineCursor = decodeTimelineCursor;
exports.listGoalTimeline = listGoalTimeline;
const node_crypto_1 = require("node:crypto");
const luxon_1 = require("luxon");
const zod_1 = require("zod");
const db_config_1 = require("../config/db.config");
const env_util_1 = require("../utils/env.util");
const goal_v2_service_1 = require("./goal-v2.service");
const localDate = zod_1.z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => luxon_1.DateTime.fromISO(value).isValid);
const cursorSchema = zod_1.z
    .object({
    version: zod_1.z.literal(1),
    anchorDate: localDate,
    direction: zod_1.z.enum(["after", "before"]),
    boundary: zod_1.z
        .object({ date: localDate, id: zod_1.z.string().min(1).max(128) })
        .strict()
        .nullable(),
})
    .strict();
function timelineToday(timezone, now = new Date()) {
    const local = luxon_1.DateTime.fromJSDate(now).setZone(timezone);
    return (local.isValid ? local : luxon_1.DateTime.fromJSDate(now).toUTC()).toFormat("yyyy-MM-dd");
}
function signature(payload, userId, goalId) {
    if (!env_util_1.Env.JWT_SECRET)
        throw new Error("JWT_SECRET is required for timeline cursors");
    return Buffer.from((0, node_crypto_1.createHmac)("sha256", env_util_1.Env.JWT_SECRET)
        .update(`task-timeline:v1:${userId}:${goalId}:${payload}`)
        .digest("base64url"));
}
function encodeTimelineCursor(value, userId, goalId) {
    const payload = Buffer.from(JSON.stringify(cursorSchema.parse(value))).toString("base64url");
    return `${payload}.${signature(payload, userId, goalId).toString()}`;
}
function decodeTimelineCursor(cursor, userId, goalId) {
    try {
        if (cursor.length > 512)
            throw new Error("Oversized cursor");
        const [payload, signed, extra] = cursor.split(".");
        if (!payload || !signed || extra)
            throw new Error("Malformed cursor");
        const expected = signature(payload, userId, goalId), actual = Buffer.from(signed);
        if (actual.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(actual, expected))
            throw new Error("Invalid signature");
        return cursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    }
    catch {
        throw new goal_v2_service_1.GoalV2ServiceError("INVALID_CURSOR", "This timeline page is no longer available. Refresh the timeline.");
    }
}
function boundaryWhere(direction, anchorDate, boundary) {
    if (!boundary)
        return {
            dueDate: direction === "before"
                ? { lt: new Date(anchorDate) }
                : { gte: new Date(anchorDate) },
        };
    const date = new Date(boundary.date);
    return {
        OR: [
            { dueDate: direction === "before" ? { lt: date } : { gt: date } },
            {
                dueDate: date,
                id: direction === "before" ? { lt: boundary.id } : { gt: boundary.id },
            },
        ],
    };
}
async function listGoalTimeline(params) {
    if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 50)
        throw new goal_v2_service_1.GoalV2ServiceError("INVALID_LIMIT", "Invalid timeline page size");
    const goal = await db_config_1.prisma.goalV2.findFirst({
        where: { id: params.goalId, userId: params.userId },
        select: { id: true },
    });
    if (!goal)
        throw new goal_v2_service_1.GoalV2ServiceError("GOAL_NOT_FOUND", "Task not found", 404);
    const cursor = params.cursor
        ? decodeTimelineCursor(params.cursor, params.userId, params.goalId)
        : null;
    const anchorDate = cursor?.anchorDate ?? params.anchorDate ?? timelineToday(params.timezone);
    if (!localDate.safeParse(anchorDate).success)
        throw new goal_v2_service_1.GoalV2ServiceError("INVALID_DATE", "Invalid timeline date");
    const direction = params.direction ?? cursor?.direction ?? "after";
    if (cursor &&
        (cursor.direction !== direction ||
            (params.anchorDate && params.anchorDate !== cursor.anchorDate)))
        throw new goal_v2_service_1.GoalV2ServiceError("INVALID_CURSOR", "Timeline cursor does not match this request");
    const boundary = cursor?.boundary ?? null;
    if (boundary) {
        const occurrence = await db_config_1.prisma.goalOccurrence.findFirst({
            where: {
                id: boundary.id,
                goalId: params.goalId,
                dueDate: new Date(boundary.date),
            },
            select: { id: true },
        });
        if (!occurrence)
            throw new goal_v2_service_1.GoalV2ServiceError("INVALID_CURSOR", "This timeline changed. Refresh to see its latest order.");
    }
    const descending = direction === "before";
    const rows = await db_config_1.prisma.goalOccurrence.findMany({
        where: {
            goalId: params.goalId,
            ...boundaryWhere(direction, anchorDate, boundary),
        },
        include: { progress: true },
        orderBy: [
            { dueDate: descending ? "desc" : "asc" },
            { id: descending ? "desc" : "asc" },
        ],
        take: params.limit,
    });
    const data = descending ? [...rows].reverse() : rows;
    const first = data[0], last = data[data.length - 1];
    const before = first
        ? { date: first.dueDate.toISOString().slice(0, 10), id: first.id }
        : boundary;
    const after = last
        ? { date: last.dueDate.toISOString().slice(0, 10), id: last.id }
        : boundary;
    const [previous, next] = await Promise.all([
        db_config_1.prisma.goalOccurrence.findFirst({
            where: {
                goalId: params.goalId,
                ...boundaryWhere("before", anchorDate, before),
            },
            select: { id: true },
        }),
        db_config_1.prisma.goalOccurrence.findFirst({
            where: {
                goalId: params.goalId,
                ...boundaryWhere("after", anchorDate, after),
            },
            select: { id: true },
        }),
    ]);
    return {
        data,
        pagination: {
            anchorDate,
            hasMore: Boolean(next),
            hasNextPage: Boolean(next),
            hasPreviousPage: Boolean(previous),
            nextCursor: next
                ? encodeTimelineCursor({ version: 1, anchorDate, direction: "after", boundary: after }, params.userId, params.goalId)
                : null,
            previousCursor: previous
                ? encodeTimelineCursor({ version: 1, anchorDate, direction: "before", boundary: before }, params.userId, params.goalId)
                : null,
        },
    };
}
