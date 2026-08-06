import { RewindFrequency, RewindIntent } from "@prisma/client";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  getRewindRoutineOverview,
  saveRewindRoutine,
} from "../services/rewind-routine.service";
import logger from "../utils/logger.util";
import {
  assertCanUseRewindFrequency,
  handleSubscriptionAccessError,
} from "../services/subscription-access.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRewindFrequency(value: unknown): value is RewindFrequency {
  return typeof value === "string" && Object.values(RewindFrequency).includes(value as RewindFrequency);
}

function isRewindIntent(value: unknown): value is RewindIntent {
  return typeof value === "string" && Object.values(RewindIntent).includes(value as RewindIntent);
}

function getStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function serializeOccurrence(
  session: Awaited<ReturnType<typeof getRewindRoutineOverview>> extends infer Overview
    ? Overview extends { currentSession: infer Session }
      ? Session
      : never
    : never,
) {
  if (!session) return null;

  return {
    id: session.id,
    scheduledFor: session.scheduledFor?.toISOString() ?? null,
    status: session.status,
    windowEndsAt: session.windowEndsAt?.toISOString() ?? null,
  };
}

export async function getRewindRoutine(req: AuthRequest, res: Response) {
  try {
    const overview = await getRewindRoutineOverview({ userId: req.userId! });
    if (!overview) {
      return res.status(404).json({ msg: "User not found" });
    }

    return res.json({
      msg: "Rewind routine retrieved",
      data: {
        currentSession: serializeOccurrence(overview.currentSession),
        latestSession: serializeOccurrence(overview.latestSession),
        nextSession: serializeOccurrence(overview.nextSession),
        routine: overview.routine,
        timezone: overview.timezone,
      },
    });
  } catch (error) {
    logger.error("Get Rewind routine error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    return res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateRewindRoutine(req: AuthRequest, res: Response) {
  try {
    if (!isRecord(req.body)) {
      return res.status(400).json({ msg: "Invalid Rewind routine" });
    }

    const { customIntent, frequency, intent, times, timezone } = req.body;
    if (
      !isRewindFrequency(frequency) ||
      !isRewindIntent(intent) ||
      typeof timezone !== "string"
    ) {
      return res.status(400).json({ msg: "Invalid Rewind routine" });
    }

    await assertCanUseRewindFrequency(
      req.userId!,
      req.clientApp,
      frequency,
    );

    const routine = await saveRewindRoutine({
      userId: req.userId!,
      input: {
        customIntent: typeof customIntent === "string" ? customIntent : null,
        frequency,
        intent,
        times: getStringArray(times),
        timezone,
      },
    });
    const overview = await getRewindRoutineOverview({ userId: req.userId! });

    return res.json({
      msg: "Rewind routine updated",
      data: {
        currentSession: serializeOccurrence(overview?.currentSession ?? null),
        latestSession: serializeOccurrence(overview?.latestSession ?? null),
        nextSession: serializeOccurrence(overview?.nextSession ?? null),
        routine,
        timezone: overview?.timezone ?? timezone,
      },
    });
  } catch (error) {
    if (handleSubscriptionAccessError(error, res)) return res;
    const message = error instanceof Error ? error.message : "Invalid Rewind routine";
    if (
      message === "A valid IANA timezone is required" ||
      message.includes("Custom Rewind") ||
      message.includes("Custom Rewind intention")
    ) {
      return res.status(400).json({ msg: message });
    }

    logger.error("Update Rewind routine error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      userId: req.userId,
    });
    return res.status(500).json({ msg: "Internal server error" });
  }
}
