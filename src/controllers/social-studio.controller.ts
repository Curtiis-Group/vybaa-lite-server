import type { Request, Response } from "express";
import { DateTime } from "luxon";

import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import {
  beginXOAuth,
  completeXOAuth,
  discardSocialDraft,
  disconnectXAccount,
  generateSocialPostDraft,
  generateSocialReplyDraft,
  getSocialStudio,
  publishSocialDraft,
  refreshSocialSuggestions,
  SocialStudioError,
  updateSocialActivityConsent,
  syncXMentions,
  updateSocialDraft,
  updateSocialPreferences,
} from "../services/social-studio.service";
import logger from "../utils/logger.util";

function sendSocialError(
  error: unknown,
  req: AuthRequest,
  res: Response,
  operation: string,
): void {
  if (error instanceof SocialStudioError) {
    res.status(error.status).json({ code: error.code, msg: error.message });
    return;
  }

  logger.error("Social Studio request failed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
    operation,
    userId: req.userId,
  });
  res
    .status(500)
    .json({ msg: "The Social Studio request could not be completed." });
}

export async function getStudio(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const studio = await getSocialStudio(req.userId!);
    res.json({ data: studio, msg: "Social Studio retrieved" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "get studio");
  }
}

export async function startXOAuth(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const authorizationUrl = await beginXOAuth({
      disclosureAccepted: req.body.disclosureAccepted,
      returnUrl: req.body.returnUrl,
      userId: req.userId!,
    });
    res.json({ data: { authorizationUrl }, msg: "X authorization started" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "start X authorization");
  }
}

export async function xOAuthCallback(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    const callbackUrl = await completeXOAuth({
      code: readQueryString(req.query.code),
      error: readQueryString(req.query.error),
      state: readQueryString(req.query.state),
    });
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, callbackUrl);
  } catch (error: unknown) {
    logger.error("X OAuth callback failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res.redirect(302, "https://vybaa.app/app/social?xSocial=failed");
  }
}

function readQueryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readRouteParam(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

export async function updatePreferences(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const timezone = await resolveTimezone(req, req.userId!);
    const preferences = await updateSocialPreferences({
      input: req.body,
      timezone,
      userId: req.userId!,
    });
    res.json({ data: preferences, msg: "Social preferences updated" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "update preferences");
  }
}

export async function updateActivityConsent(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const preferences = await updateSocialActivityConsent({
      accepted: req.body.accepted,
      userId: req.userId!,
    });
    res.json({ data: preferences, msg: "Social activity consent updated" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "update social activity consent");
  }
}

export async function refreshSuggestions(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const result = await refreshSocialSuggestions(
      req.userId!,
      req.body.force,
    );
    res.json({ data: result, msg: "Social suggestions refreshed" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "refresh social suggestions");
  }
}

async function resolveTimezone(
  req: AuthRequest,
  userId: string,
): Promise<string> {
  const headerTimezone = req.headers["x-user-tz"];
  const candidate =
    typeof headerTimezone === "string" ? headerTimezone.trim() : "";
  if (candidate && DateTime.now().setZone(candidate).isValid) {
    return candidate;
  }

  const user = await prisma.user.findUnique({
    select: { timezone: true },
    where: { id: userId },
  });
  return user?.timezone && DateTime.now().setZone(user.timezone).isValid
    ? user.timezone
    : "UTC";
}

export async function disconnectX(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    await disconnectXAccount(req.userId!);
    res.json({ msg: "X account disconnected" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "disconnect X");
  }
}

export async function syncMentions(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const syncedCount = await syncXMentions(req.userId!);
    res.json({ data: { syncedCount }, msg: "X mentions synced" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "sync mentions");
  }
}

export async function generatePostDraft(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const draft = await generateSocialPostDraft({
      brief: req.body.brief,
      type: req.body.type,
      userId: req.userId!,
    });
    res.status(201).json({ data: draft, msg: "Social draft generated" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "generate post draft");
  }
}

export async function generateReplyDraft(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const draft = await generateSocialReplyDraft({
      mentionId: readRouteParam(req.params.mentionId),
      userId: req.userId!,
    });
    res.status(201).json({ data: draft, msg: "Reply draft generated" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "generate reply draft");
  }
}

export async function updateDraft(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const draft = await updateSocialDraft({
      draftId: readRouteParam(req.params.draftId),
      segments: req.body.segments,
      userId: req.userId!,
    });
    res.json({ data: draft, msg: "Social draft updated" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "update draft");
  }
}

export async function discardDraft(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    await discardSocialDraft({
      draftId: readRouteParam(req.params.draftId),
      userId: req.userId!,
    });
    res.json({ msg: "Social draft removed" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "discard draft");
  }
}

export async function publishDraft(
  req: AuthRequest,
  res: Response,
): Promise<void> {
  try {
    const draft = await publishSocialDraft({
      draftId: readRouteParam(req.params.draftId),
      userId: req.userId!,
    });
    res.json({ data: draft, msg: "Draft published to X" });
  } catch (error: unknown) {
    sendSocialError(error, req, res, "publish draft");
  }
}
