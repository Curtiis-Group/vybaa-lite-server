import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { z } from "zod";

import { prisma } from "../config/db.config";
import { Env } from "../utils/env.util";
import { GoalV2ServiceError } from "./goal-v2.service";

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => DateTime.fromISO(value).isValid);
const cursorSchema = z
  .object({
    version: z.literal(1),
    anchorDate: localDate,
    direction: z.enum(["after", "before"]),
    boundary: z
      .object({ date: localDate, id: z.string().min(1).max(128) })
      .strict()
      .nullable(),
  })
  .strict();
type TimelineCursor = z.infer<typeof cursorSchema>;
type Direction = TimelineCursor["direction"];

export function timelineToday(timezone: string, now = new Date()): string {
  const local = DateTime.fromJSDate(now).setZone(timezone);
  return (local.isValid ? local : DateTime.fromJSDate(now).toUTC()).toFormat(
    "yyyy-MM-dd",
  );
}

function signature(payload: string, userId: string, goalId: string): Buffer {
  if (!Env.JWT_SECRET)
    throw new Error("JWT_SECRET is required for timeline cursors");
  return Buffer.from(
    createHmac("sha256", Env.JWT_SECRET)
      .update(`task-timeline:v1:${userId}:${goalId}:${payload}`)
      .digest("base64url"),
  );
}

export function encodeTimelineCursor(
  value: TimelineCursor,
  userId: string,
  goalId: string,
): string {
  const payload = Buffer.from(
    JSON.stringify(cursorSchema.parse(value)),
  ).toString("base64url");
  return `${payload}.${signature(payload, userId, goalId).toString()}`;
}

export function decodeTimelineCursor(
  cursor: string,
  userId: string,
  goalId: string,
): TimelineCursor {
  try {
    if (cursor.length > 512) throw new Error("Oversized cursor");
    const [payload, signed, extra] = cursor.split(".");
    if (!payload || !signed || extra) throw new Error("Malformed cursor");
    const expected = signature(payload, userId, goalId),
      actual = Buffer.from(signed);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new Error("Invalid signature");
    return cursorSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    throw new GoalV2ServiceError(
      "INVALID_CURSOR",
      "This timeline page is no longer available. Refresh the timeline.",
    );
  }
}

function boundaryWhere(
  direction: Direction,
  anchorDate: string,
  boundary: TimelineCursor["boundary"],
): Prisma.GoalOccurrenceWhereInput {
  if (!boundary)
    return {
      dueDate:
        direction === "before"
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

export async function listGoalTimeline(params: {
  goalId: string;
  userId: string;
  timezone: string;
  limit: number;
  anchorDate?: string;
  cursor?: string;
  direction?: Direction;
}) {
  if (!Number.isInteger(params.limit) || params.limit < 1 || params.limit > 50)
    throw new GoalV2ServiceError("INVALID_LIMIT", "Invalid timeline page size");
  const goal = await prisma.goalV2.findFirst({
    where: { id: params.goalId, userId: params.userId },
    select: { id: true },
  });
  if (!goal)
    throw new GoalV2ServiceError("GOAL_NOT_FOUND", "Task not found", 404);
  const cursor = params.cursor
    ? decodeTimelineCursor(params.cursor, params.userId, params.goalId)
    : null;
  const anchorDate =
    cursor?.anchorDate ?? params.anchorDate ?? timelineToday(params.timezone);
  if (!localDate.safeParse(anchorDate).success)
    throw new GoalV2ServiceError("INVALID_DATE", "Invalid timeline date");
  const direction = params.direction ?? cursor?.direction ?? "after";
  if (
    cursor &&
    (cursor.direction !== direction ||
      (params.anchorDate && params.anchorDate !== cursor.anchorDate))
  )
    throw new GoalV2ServiceError(
      "INVALID_CURSOR",
      "Timeline cursor does not match this request",
    );
  const boundary = cursor?.boundary ?? null;
  if (boundary) {
    const occurrence = await prisma.goalOccurrence.findFirst({
      where: {
        id: boundary.id,
        goalId: params.goalId,
        dueDate: new Date(boundary.date),
      },
      select: { id: true },
    });
    if (!occurrence)
      throw new GoalV2ServiceError(
        "INVALID_CURSOR",
        "This timeline changed. Refresh to see its latest order.",
      );
  }
  const descending = direction === "before";
  const rows = await prisma.goalOccurrence.findMany({
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
  const first = data[0],
    last = data[data.length - 1];
  const before = first
    ? { date: first.dueDate.toISOString().slice(0, 10), id: first.id }
    : boundary;
  const after = last
    ? { date: last.dueDate.toISOString().slice(0, 10), id: last.id }
    : boundary;
  const [previous, next] = await Promise.all([
    prisma.goalOccurrence.findFirst({
      where: {
        goalId: params.goalId,
        ...boundaryWhere("before", anchorDate, before),
      },
      select: { id: true },
    }),
    prisma.goalOccurrence.findFirst({
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
        ? encodeTimelineCursor(
            { version: 1, anchorDate, direction: "after", boundary: after },
            params.userId,
            params.goalId,
          )
        : null,
      previousCursor: previous
        ? encodeTimelineCursor(
            { version: 1, anchorDate, direction: "before", boundary: before },
            params.userId,
            params.goalId,
          )
        : null,
    },
  };
}
