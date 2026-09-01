import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";
import { containsObjectionableContent } from "../utils/content-moderation.util";

const REPORT_REASONS = new Set([
  "harassment",
  "hate",
  "sexual",
  "violence",
  "spam",
  "other",
]);

export async function reportContent(req: AuthRequest, res: Response) {
  const reporterId = req.userId!;
  const { targetType, targetId, reason, details } = req.body as Record<
    string,
    string | undefined
  >;

  if (!targetType || !targetId || !REPORT_REASONS.has(reason || "")) {
    return res.status(400).json({
      code: "INVALID_REPORT",
      msg: "Choose a valid report reason and content.",
    });
  }

  try {
    let targetUserId: string;
    let activityId: string | undefined;
    let commentId: string | undefined;

    if (targetType === "activity") {
      const activity = await prisma.communityActivity.findUnique({
        where: { id: targetId },
        select: { userId: true, id: true },
      });
      if (!activity) return res.status(404).json({ msg: "Content not found" });
      targetUserId = activity.userId;
      activityId = activity.id;
    } else if (targetType === "comment") {
      const comment = await prisma.activityComment.findUnique({
        where: { id: targetId },
        select: { userId: true, id: true },
      });
      if (!comment) return res.status(404).json({ msg: "Content not found" });
      targetUserId = comment.userId;
      commentId = comment.id;
    } else if (targetType === "user") {
      const user = await prisma.user.findUnique({
        where: { id: targetId },
        select: { id: true },
      });
      if (!user) return res.status(404).json({ msg: "User not found" });
      targetUserId = user.id;
    } else {
      return res
        .status(400)
        .json({ code: "INVALID_REPORT", msg: "Unsupported content type." });
    }

    if (targetUserId === reporterId)
      return res.status(400).json({
        code: "INVALID_REPORT",
        msg: "You cannot report your own content.",
      });
    if (
      details &&
      (details.length > 1_000 || containsObjectionableContent(details))
    ) {
      return res.status(400).json({
        code: "CONTENT_REJECTED",
        msg: "Please remove abusive language from the report details.",
      });
    }

    const existing = await prisma.contentReport.findFirst({
      where: {
        reporterId,
        targetUserId,
        activityId,
        commentId,
        status: { in: ["OPEN", "REVIEWING"] },
      },
      select: { id: true },
    });
    if (existing)
      return res.status(200).json({
        msg: "Thanks. This content is already under review.",
        data: { reported: true },
      });

    await prisma.contentReport.create({
      data: {
        reporterId,
        targetUserId,
        activityId,
        commentId,
        reason: reason!,
        details: details?.trim() || null,
      },
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
  if (!blockedId || blockedId === blockerId)
    return res.status(400).json({ msg: "Invalid user to block" });

  try {
    const blocked = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true },
    });
    if (!blocked) return res.status(404).json({ msg: "User not found" });
    await prisma.$transaction(async (tx) => {
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
          activityId: null,
          commentId: null,
          status: { in: ["OPEN", "REVIEWING"] },
        },
        select: { id: true },
      });
      if (!existingReport) {
        await tx.contentReport.create({
          data: {
            reporterId: blockerId,
            targetUserId: blockedId,
            reason: "other",
            details: "User was blocked from the feed.",
          },
        });
      }
    });
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
    return res.json({ msg: "Moderation reports retrieved", data: reports });
  } catch (error) {
    logger.error("List moderation reports failed");
    return res.status(500).json({ msg: "Unable to load moderation reports" });
  }
}

export async function updateReport(req: AuthRequest, res: Response) {
  const reportId = String(req.params.reportId || "").trim();
  const { status } = req.body as { status?: string };
  if (
    !reportId ||
    !["REVIEWING", "RESOLVED", "DISMISSED"].includes(status || "")
  ) {
    return res.status(400).json({ msg: "Invalid report update" });
  }

  try {
    const report = await prisma.contentReport.update({
      where: { id: reportId },
      data: { status: status as "REVIEWING" | "RESOLVED" | "DISMISSED" },
    });
    return res.json({ msg: "Moderation report updated", data: report });
  } catch (error) {
    return res.status(404).json({ msg: "Moderation report not found" });
  }
}
