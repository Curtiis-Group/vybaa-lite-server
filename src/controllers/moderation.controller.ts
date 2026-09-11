import type { ModerationReportStatus } from "@prisma/client";
import type { Response } from "express";
import { prisma } from "../config/db.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import { emailService } from "../services/email.service";
import logger from "../utils/logger.util";

const REPORT_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1_000;

type ReportEvidence = {
  activityId?: string;
  commentId?: string;
  evidenceSnapshot: string;
  targetUserId: string;
  targetType: "activity" | "comment" | "user";
};

type ReportRequest = {
  details?: string;
  reason: string;
  targetId: string;
  targetType: ReportEvidence["targetType"];
};

async function resolveReportEvidence(
  targetType: ReportEvidence["targetType"],
  targetId: string,
): Promise<ReportEvidence | null> {
  if (targetType === "activity") {
    const activity = await prisma.communityActivity.findUnique({
      where: { id: targetId },
      select: {
        communityId: true,
        id: true,
        metadata: true,
        type: true,
        userId: true,
      },
    });
    if (!activity) return null;
    return {
      activityId: activity.id,
      evidenceSnapshot: JSON.stringify(activity),
      targetType,
      targetUserId: activity.userId,
    };
  }
  if (targetType === "comment") {
    const comment = await prisma.activityComment.findUnique({
      where: { id: targetId },
      select: { activityId: true, id: true, text: true, userId: true },
    });
    if (!comment) return null;
    return {
      commentId: comment.id,
      evidenceSnapshot: JSON.stringify(comment),
      targetType,
      targetUserId: comment.userId,
    };
  }
  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { firstName: true, id: true, username: true },
  });
  if (!user) return null;
  return {
    evidenceSnapshot: JSON.stringify(user),
    targetType,
    targetUserId: user.id,
  };
}

function notifyModerationTeam(params: {
  createdAt: Date;
  reason: string;
  reportId: string;
  targetType: string;
}): void {
  const responseDueAt = new Date(
    params.createdAt.getTime() + REPORT_RESPONSE_WINDOW_MS,
  ).toISOString();
  void emailService
    .sendModerationAlertEmail({ ...params, responseDueAt })
    .catch((error: unknown) => {
      logger.error("Moderation alert delivery failed", {
        error,
        reportId: params.reportId,
      });
    });
}

export async function reportContent(req: AuthRequest, res: Response) {
  const reporterId = req.userId!;
  const { targetType, targetId, reason, details } = req.body as ReportRequest;

  try {
    const evidence = await resolveReportEvidence(targetType, targetId);
    if (!evidence) return res.status(404).json({ msg: "Content not found" });

    if (evidence.targetUserId === reporterId)
      return res.status(400).json({
        code: "INVALID_REPORT",
        msg: "You cannot report your own content.",
      });
    const existing = await prisma.contentReport.findFirst({
      where: {
        reporterId,
        targetUserId: evidence.targetUserId,
        activityId: evidence.activityId,
        commentId: evidence.commentId,
        status: { in: ["OPEN", "REVIEWING"] },
      },
      select: { id: true },
    });
    if (existing)
      return res.status(200).json({
        msg: "Thanks. This content is already under review.",
        data: { reported: true },
      });

    const report = await prisma.contentReport.create({
      data: {
        reporterId,
        targetUserId: evidence.targetUserId,
        activityId: evidence.activityId,
        commentId: evidence.commentId,
        evidenceSnapshot: evidence.evidenceSnapshot,
        reason,
        details: details?.trim() ?? null,
      },
    });
    notifyModerationTeam({
      createdAt: report.createdAt,
      reason,
      reportId: report.id,
      targetType,
    });
    return res.status(201).json({
      msg: "Thanks. We will review this report.",
      data: { reported: true },
    });
  } catch (error) {
    logger.error("Create moderation report failed", { userId: reporterId });
    return res.status(500).json({ msg: "Unable to submit report" });
  }
}

export async function blockUser(req: AuthRequest, res: Response) {
  const blockerId = req.userId!;
  const blockedId = String(req.params.userId || "").trim();
  const { details, reason, targetId, targetType } =
    req.body as Partial<ReportRequest>;
  if (!blockedId || blockedId === blockerId)
    return res.status(400).json({ msg: "Invalid user to block" });

  try {
    const blocked = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!blocked) return res.status(404).json({ msg: "User not found" });
    const evidence =
      targetType && targetId
        ? await resolveReportEvidence(targetType, targetId)
        : await resolveReportEvidence("user", blockedId);
    if (!evidence || evidence.targetUserId !== blockedId) {
      return res.status(400).json({
        code: "INVALID_BLOCK_EVIDENCE",
        msg: "The selected content does not belong to this user.",
      });
    }
    const createdReport = await prisma.$transaction(async (tx) => {
      await tx.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });
      // A block is also a moderation signal so the developer can review abuse.
      const existingReport = await tx.contentReport.findFirst({
        where: {
          reporterId: blockerId,
          targetUserId: blockedId,
          activityId: evidence.activityId,
          commentId: evidence.commentId,
          status: { in: ["OPEN", "REVIEWING"] },
        },
        select: { id: true },
      });
      if (existingReport) return null;
      return tx.contentReport.create({
        data: {
          reporterId: blockerId,
          targetUserId: blockedId,
          activityId: evidence.activityId,
          commentId: evidence.commentId,
          evidenceSnapshot: evidence.evidenceSnapshot,
          reason: reason ?? "other",
          details: details?.trim() ?? "User was blocked from the feed.",
        },
        select: { createdAt: true, id: true },
      });
    });
    if (createdReport) {
      notifyModerationTeam({
        createdAt: createdReport.createdAt,
        reason: reason ?? "other",
        reportId: createdReport.id,
        targetType: evidence.targetType,
      });
    }
    return res.status(201).json({
      msg: "User blocked",
      data: { blocked: true, userId: blockedId },
    });
  } catch (error) {
    logger.error("Block user failed", { userId: blockerId });
    return res.status(500).json({ msg: "Unable to block user" });
  }
}

export async function unblockUser(req: AuthRequest, res: Response) {
  const blockerId = req.userId!;
  const blockedId = String(req.params.userId || "").trim();
  try {
    await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
    return res.json({
      msg: "User unblocked",
      data: { blocked: false, userId: blockedId },
    });
  } catch (error) {
    logger.error("Unblock user failed", { userId: blockerId });
    return res.status(500).json({ msg: "Unable to unblock user" });
  }
}

export async function listReports(req: AuthRequest, res: Response) {
  const status =
    typeof req.query.status === "string" ? req.query.status : "OPEN";
  if (!["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"].includes(status)) {
    return res.status(400).json({ msg: "Invalid moderation status" });
  }

  try {
    const reports = await prisma.contentReport.findMany({
      where: {
        status: status as "OPEN" | "REVIEWING" | "RESOLVED" | "DISMISSED",
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        reporter: { select: { id: true, username: true } },
        targetUser: { select: { id: true, username: true, firstName: true } },
        activity: { select: { id: true, communityId: true, metadata: true } },
        comment: { select: { id: true, activityId: true, text: true } },
      },
    });
    const now = Date.now();
    return res.json({
      msg: "Moderation reports retrieved",
      data: reports.map((report) => ({
        ...report,
        isOverdue:
          ["OPEN", "REVIEWING"].includes(report.status) &&
          report.createdAt.getTime() + REPORT_RESPONSE_WINDOW_MS < now,
        responseDueAt: new Date(
          report.createdAt.getTime() + REPORT_RESPONSE_WINDOW_MS,
        ).toISOString(),
      })),
    });
  } catch (error) {
    logger.error("List moderation reports failed");
    return res.status(500).json({ msg: "Unable to load moderation reports" });
  }
}

export async function updateReport(req: AuthRequest, res: Response) {
  const reportId = String(req.params.reportId || "").trim();
  const { action, note, status } = req.body as {
    action?: string;
    note?: string;
    status?: string;
  };
  if (
    !reportId ||
    !["REVIEWING", "RESOLVED", "DISMISSED"].includes(status || "")
  ) {
    return res.status(400).json({ msg: "Invalid report update" });
  }
  if (status === "RESOLVED" && action !== "REMOVE_CONTENT_AND_SUSPEND") {
    return res.status(400).json({
      msg: "Resolving a violation requires content removal and account suspension.",
    });
  }
  if (note && note.length > 2_000) {
    return res.status(400).json({ msg: "Moderator note is too long" });
  }

  try {
    const existing = await prisma.contentReport.findUnique({
      where: { id: reportId },
    });
    if (!existing)
      return res.status(404).json({ msg: "Moderation report not found" });

    const report = await prisma.$transaction(async (tx) => {
      if (action === "REMOVE_CONTENT_AND_SUSPEND") {
        if (existing.commentId) {
          await tx.activityComment.deleteMany({
            where: { id: existing.commentId },
          });
        } else if (existing.activityId) {
          await tx.communityActivity.deleteMany({
            where: { id: existing.activityId },
          });
        }
        await tx.user.update({
          where: { id: existing.targetUserId },
          data: { refreshToken: null, suspendedAt: new Date() },
        });
      }
      return tx.contentReport.update({
        where: { id: reportId },
        data: {
          moderatorAction: action ?? null,
          moderatorNote: note?.trim() ?? null,
          reviewedAt: new Date(),
          status: status as ModerationReportStatus,
        },
      });
    });
    return res.json({ msg: "Moderation report updated", data: report });
  } catch (error) {
    return res.status(404).json({ msg: "Moderation report not found" });
  }
}
