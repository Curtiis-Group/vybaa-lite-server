"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportContent = reportContent;
exports.blockUser = blockUser;
exports.unblockUser = unblockUser;
exports.listReports = listReports;
exports.updateReport = updateReport;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const content_moderation_util_1 = require("../utils/content-moderation.util");
const REPORT_REASONS = new Set([
    "harassment",
    "hate",
    "sexual",
    "violence",
    "spam",
    "other",
]);
async function reportContent(req, res) {
    const reporterId = req.userId;
    const { targetType, targetId, reason, details } = req.body;
    if (!targetType || !targetId || !REPORT_REASONS.has(reason || "")) {
        return res.status(400).json({
            code: "INVALID_REPORT",
            msg: "Choose a valid report reason and content.",
        });
    }
    try {
        let targetUserId;
        let activityId;
        let commentId;
        if (targetType === "activity") {
            const activity = await db_config_1.prisma.communityActivity.findUnique({
                where: { id: targetId },
                select: { userId: true, id: true },
            });
            if (!activity)
                return res.status(404).json({ msg: "Content not found" });
            targetUserId = activity.userId;
            activityId = activity.id;
        }
        else if (targetType === "comment") {
            const comment = await db_config_1.prisma.activityComment.findUnique({
                where: { id: targetId },
                select: { userId: true, id: true },
            });
            if (!comment)
                return res.status(404).json({ msg: "Content not found" });
            targetUserId = comment.userId;
            commentId = comment.id;
        }
        else if (targetType === "user") {
            const user = await db_config_1.prisma.user.findUnique({
                where: { id: targetId },
                select: { id: true },
            });
            if (!user)
                return res.status(404).json({ msg: "User not found" });
            targetUserId = user.id;
        }
        else {
            return res
                .status(400)
                .json({ code: "INVALID_REPORT", msg: "Unsupported content type." });
        }
        if (targetUserId === reporterId)
            return res.status(400).json({
                code: "INVALID_REPORT",
                msg: "You cannot report your own content.",
            });
        if (details &&
            (details.length > 1000 || (0, content_moderation_util_1.containsObjectionableContent)(details))) {
            return res.status(400).json({
                code: "CONTENT_REJECTED",
                msg: "Please remove abusive language from the report details.",
            });
        }
        const existing = await db_config_1.prisma.contentReport.findFirst({
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
        await db_config_1.prisma.contentReport.create({
            data: {
                reporterId,
                targetUserId,
                activityId,
                commentId,
                reason: reason,
                details: details?.trim() || null,
            },
        });
        return res.status(201).json({
            msg: "Thanks. We will review this report.",
            data: { reported: true },
        });
    }
    catch (error) {
        logger_util_1.default.error("Create moderation report failed", { userId: reporterId });
        return res.status(500).json({ msg: "Unable to submit report" });
    }
}
async function blockUser(req, res) {
    const blockerId = req.userId;
    const blockedId = String(req.params.userId || "").trim();
    if (!blockedId || blockedId === blockerId)
        return res.status(400).json({ msg: "Invalid user to block" });
    try {
        const blocked = await db_config_1.prisma.user.findUnique({
            where: { id: blockedId },
            select: { id: true },
        });
        if (!blocked)
            return res.status(404).json({ msg: "User not found" });
        await db_config_1.prisma.$transaction(async (tx) => {
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
    }
    catch (error) {
        logger_util_1.default.error("Block user failed", { userId: blockerId });
        return res.status(500).json({ msg: "Unable to block user" });
    }
}
async function unblockUser(req, res) {
    const blockerId = req.userId;
    const blockedId = String(req.params.userId || "").trim();
    try {
        await db_config_1.prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
        return res.json({
            msg: "User unblocked",
            data: { blocked: false, userId: blockedId },
        });
    }
    catch (error) {
        logger_util_1.default.error("Unblock user failed", { userId: blockerId });
        return res.status(500).json({ msg: "Unable to unblock user" });
    }
}
async function listReports(req, res) {
    const status = typeof req.query.status === "string" ? req.query.status : "OPEN";
    if (!["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"].includes(status)) {
        return res.status(400).json({ msg: "Invalid moderation status" });
    }
    try {
        const reports = await db_config_1.prisma.contentReport.findMany({
            where: {
                status: status,
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
    }
    catch (error) {
        logger_util_1.default.error("List moderation reports failed");
        return res.status(500).json({ msg: "Unable to load moderation reports" });
    }
}
async function updateReport(req, res) {
    const reportId = String(req.params.reportId || "").trim();
    const { status } = req.body;
    if (!reportId ||
        !["REVIEWING", "RESOLVED", "DISMISSED"].includes(status || "")) {
        return res.status(400).json({ msg: "Invalid report update" });
    }
    try {
        const report = await db_config_1.prisma.contentReport.update({
            where: { id: reportId },
            data: { status: status },
        });
        return res.json({ msg: "Moderation report updated", data: report });
    }
    catch (error) {
        return res.status(404).json({ msg: "Moderation report not found" });
    }
}
