"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCommunity = createCommunity;
exports.getCommunities = getCommunities;
exports.getCommunityById = getCommunityById;
exports.updateCommunity = updateCommunity;
exports.deleteCommunity = deleteCommunity;
exports.joinCommunity = joinCommunity;
exports.leaveCommunity = leaveCommunity;
exports.getCommunityMembers = getCommunityMembers;
exports.updateMemberRole = updateMemberRole;
exports.createTemplate = createTemplate;
exports.getTemplates = getTemplates;
exports.getTemplateById = getTemplateById;
exports.updateTemplate = updateTemplate;
exports.getTemplateParticipants = getTemplateParticipants;
exports.deleteTemplate = deleteTemplate;
exports.startGoalFromTemplate = startGoalFromTemplate;
exports.getActivityFeed = getActivityFeed;
exports.reactToActivity = reactToActivity;
exports.createComment = createComment;
exports.getComments = getComments;
exports.deleteComment = deleteComment;
exports.getCommunityStats = getCommunityStats;
exports.getMyCommunities = getMyCommunities;
exports.createInvite = createInvite;
exports.getInviteByCode = getInviteByCode;
exports.joinByInviteCode = joinByInviteCode;
exports.getCommunityInvites = getCommunityInvites;
exports.revokeInvite = revokeInvite;
const client_1 = require("@prisma/client");
const luxon_1 = require("luxon");
const db_config_1 = require("../config/db.config");
const community_activity_service_1 = require("../services/community-activity.service");
const email_service_1 = require("../services/email.service");
const goal_v2_service_1 = require("../services/goal-v2.service");
const notification_service_1 = require("../services/notification.service");
const subscription_access_service_1 = require("../services/subscription-access.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const content_moderation_util_1 = require("../utils/content-moderation.util");
function getTemplateRewardMilestones(milestones, targetDays) {
    const rewards = [];
    for (const milestone of milestones) {
        if (milestone.triggerType === client_1.MilestoneTriggerType.PERCENTAGE) {
            rewards.push({
                name: milestone.name,
                points: milestone.points,
                triggerPercentage: milestone.triggerValue,
            });
            continue;
        }
        if (milestone.triggerType === client_1.MilestoneTriggerType.DAY) {
            rewards.push({
                name: milestone.name,
                points: milestone.points,
                triggerPercentage: (milestone.triggerValue / targetDays) * 100,
            });
            continue;
        }
        const start = milestone.sequenceStartDay ?? milestone.triggerValue;
        const end = milestone.sequenceEndDay ?? targetDays;
        let sequenceIndex = 0;
        for (let day = start; day <= end; day += milestone.triggerValue) {
            rewards.push({
                name: `${milestone.name} ${sequenceIndex + 1}`,
                points: milestone.points + milestone.sequenceBonusPoints * sequenceIndex,
                triggerPercentage: (day / targetDays) * 100,
            });
            sequenceIndex += 1;
        }
    }
    return rewards;
}
function getTemplateScheduleFields(schedule) {
    if (!schedule) {
        return { scheduleType: client_1.GoalScheduleType.DAILY, weekdays: [] };
    }
    const type = String(schedule.type);
    if (type === "WEEKLY") {
        return {
            scheduleType: client_1.GoalScheduleType.WEEKLY,
            weekdays: [Number(schedule.weekday)],
        };
    }
    if (type === "SELECTED_WEEKDAYS") {
        return {
            scheduleType: client_1.GoalScheduleType.SELECTED_WEEKDAYS,
            weekdays: Array.isArray(schedule.weekdays)
                ? schedule.weekdays.map(Number)
                : [],
        };
    }
    return {
        scheduleType: type === "ONE_TIME" ? client_1.GoalScheduleType.ONE_TIME : client_1.GoalScheduleType.DAILY,
        weekdays: [],
    };
}
function getTemplateTargetFields(target, targetDays) {
    if (target?.type === "QUANTITY") {
        return {
            targetType: client_1.GoalTargetType.QUANTITY,
            targetValue: Number(target.amount),
            unit: String(target.unit),
        };
    }
    if (target?.type === "UNTIL_DATE") {
        return {
            targetType: client_1.GoalTargetType.UNTIL_DATE,
            targetValue: targetDays,
            unit: null,
        };
    }
    return {
        targetType: client_1.GoalTargetType.CHECK_IN_COUNT,
        targetValue: Number(target?.count ?? targetDays),
        unit: null,
    };
}
function getDiscoveryScore(community, isJoined) {
    const memberScore = Math.min(community._count.members, 500) * 2;
    const templateScore = community._count.templates * 14;
    const activeGoalScore = community._count.goals * 8;
    const freshnessDays = Math.max(0, 30 - Math.floor((Date.now() - community.updatedAt.getTime()) / 86400000));
    const discoveryBoost = isJoined ? 0 : 1000;
    return (discoveryBoost +
        memberScore +
        templateScore +
        activeGoalScore +
        freshnessDays);
}
function getDiscoveryReason(community, isJoined) {
    if (isJoined) {
        return "Already in your circle";
    }
    if (community._count.goals >= 10) {
        return "Active goals right now";
    }
    if (community._count.templates >= 4) {
        return "Plenty to start from";
    }
    if (community._count.members >= 20) {
        return "People are gathering here";
    }
    return "New community to explore";
}
// Helper function to check if user is owner or mod of community
async function isOwnerOrMod(communityId, userId) {
    const member = await db_config_1.prisma.communityMember.findUnique({
        where: {
            communityId_userId: {
                communityId,
                userId,
            },
        },
    });
    return member?.role === "OWNER" || member?.role === "MOD";
}
// Helper function to check if user is owner of community
async function isOwner(communityId, userId) {
    const community = await db_config_1.prisma.community.findUnique({
        where: { id: communityId },
    });
    return community?.ownerId === userId;
}
// Helper function to check if user is member of community
async function isMember(communityId, userId) {
    const member = await db_config_1.prisma.communityMember.findUnique({
        where: {
            communityId_userId: {
                communityId,
                userId,
            },
        },
    });
    return !!member;
}
async function getBlockedUserIds(userId) {
    const [blocked, blocking] = await Promise.all([
        db_config_1.prisma.userBlock.findMany({
            where: { blockerId: userId },
            select: { blockedId: true },
        }),
        db_config_1.prisma.userBlock.findMany({
            where: { blockedId: userId },
            select: { blockerId: true },
        }),
    ]);
    return [
        ...blocked.map((item) => item.blockedId),
        ...blocking.map((item) => item.blockerId),
    ];
}
// ==================== Community CRUD ====================
async function createCommunity(req, res) {
    try {
        const userId = req.userId;
        const { name, description, coverImage, isPublic, category } = req.body;
        await (0, subscription_access_service_1.assertCanCreateCommunity)(userId, req.clientApp);
        const community = await db_config_1.prisma.community.create({
            data: {
                name,
                description,
                coverImage,
                isPublic: isPublic ?? true,
                category,
                ownerId: userId,
                members: {
                    create: {
                        userId,
                        role: "OWNER",
                    },
                },
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        members: true,
                        templates: true,
                    },
                },
            },
        });
        res.json({
            msg: "Community created successfully",
            data: {
                ...community,
                createdAt: community.createdAt.toISOString(),
                updatedAt: community.updatedAt.toISOString(),
            },
        });
    }
    catch (error) {
        if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
            return;
        logger_util_1.default.error("Create community error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getCommunities(req, res) {
    try {
        const userId = req.userId;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = Number(pageParam || "1") || 1;
        const limit = Number(limitParam || "10") || 10;
        const skip = (page - 1) * limit;
        if (page < 1 || limit < 1 || limit > 100) {
            return res.status(400).json({
                msg: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
            });
        }
        const memberships = await db_config_1.prisma.communityMember.findMany({
            where: { userId },
            select: {
                communityId: true,
                joinedAt: true,
                role: true,
            },
        });
        const membershipByCommunityId = new Map(memberships.map((membership) => [
            membership.communityId,
            {
                joinedAt: membership.joinedAt,
                role: membership.role,
            },
        ]));
        const communitiesForDiscovery = await db_config_1.prisma.community.findMany({
            where: { isPublic: true },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: { members: true, templates: true, goals: true },
                },
            },
        });
        const rankedCommunities = communitiesForDiscovery
            .map((community) => {
            const membership = membershipByCommunityId.get(community.id);
            const isJoined = !!membership;
            return {
                community,
                discoveryScore: getDiscoveryScore(community, isJoined),
                membership,
            };
        })
            .sort((left, right) => {
            if (right.discoveryScore !== left.discoveryScore) {
                return right.discoveryScore - left.discoveryScore;
            }
            return (right.community.updatedAt.getTime() -
                left.community.updatedAt.getTime());
        });
        const totalCount = rankedCommunities.length;
        const communities = rankedCommunities
            .slice(skip, skip + limit)
            .map(({ community, discoveryScore, membership }) => {
            const isJoined = !!membership;
            return {
                ...community,
                createdAt: community.createdAt.toISOString(),
                updatedAt: community.updatedAt.toISOString(),
                discoveryReason: getDiscoveryReason(community, isJoined),
                discoveryScore,
                isMember: isJoined,
                joinedAt: membership?.joinedAt.toISOString() || null,
                userRole: membership?.role || null,
            };
        });
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Communities retrieved successfully",
            data: communities,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get communities error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getCommunityById(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const community = await db_config_1.prisma.community.findUnique({
            where: { id: communityId },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        members: true,
                        templates: true,
                        goals: true,
                    },
                },
            },
        });
        if (!community) {
            return res.status(404).json({ msg: "Community not found" });
        }
        // Check if user is member
        const member = await db_config_1.prisma.communityMember.findUnique({
            where: {
                communityId_userId: {
                    communityId,
                    userId,
                },
            },
        });
        res.json({
            msg: "Community retrieved successfully",
            data: {
                ...community,
                createdAt: community.createdAt.toISOString(),
                updatedAt: community.updatedAt.toISOString(),
                isMember: !!member,
                userRole: member?.role || null,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get community by ID error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function updateCommunity(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const { name, description, coverImage, isPublic, category } = req.body;
        // Check if user is owner
        if (!(await isOwner(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Only the owner can update the community" });
        }
        const community = await db_config_1.prisma.community.update({
            where: { id: communityId },
            data: {
                ...(name && { name }),
                ...(description !== undefined && { description }),
                ...(coverImage !== undefined && { coverImage }),
                ...(isPublic !== undefined && { isPublic }),
                ...(category !== undefined && { category }),
            },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        members: true,
                        templates: true,
                        goals: true,
                    },
                },
            },
        });
        res.json({
            msg: "Community updated successfully",
            data: {
                ...community,
                createdAt: community.createdAt.toISOString(),
                updatedAt: community.updatedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Update community error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function deleteCommunity(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        // Check if user is owner
        if (!(await isOwner(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Only the owner can delete the community" });
        }
        // Get community info before deleting
        const community = await db_config_1.prisma.community.findUnique({
            where: { id: communityId },
            select: { name: true },
        });
        await db_config_1.prisma.community.delete({
            where: { id: communityId },
        });
        // Notify all members about community deletion
        if (community) {
            notification_service_1.notificationService
                .sendCommunityDeletedNotification(communityId, community.name)
                .catch((err) => logger_util_1.default.error("Error sending community deleted notification:", err));
        }
        res.json({
            msg: "Community deleted successfully",
            data: null,
        });
    }
    catch (error) {
        logger_util_1.default.error("Delete community error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
// ==================== Membership ====================
async function joinCommunity(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.body;
        // Check if community exists and is public
        const community = await db_config_1.prisma.community.findUnique({
            where: { id: communityId },
        });
        if (!community) {
            return res.status(404).json({ msg: "Community not found" });
        }
        if (!community.isPublic) {
            return res.status(403).json({ msg: "Cannot join private community" });
        }
        // Check if already a member
        const existingMember = await db_config_1.prisma.communityMember.findUnique({
            where: {
                communityId_userId: {
                    communityId,
                    userId,
                },
            },
        });
        if (existingMember) {
            return res
                .status(400)
                .json({ msg: "Already a member of this community" });
        }
        const member = await db_config_1.prisma.communityMember.create({
            data: {
                communityId,
                userId,
                role: "MEMBER",
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        // Notify owner and mods about new member
        const memberName = member.user.username || member.user.firstName || "Someone";
        notification_service_1.notificationService
            .sendMemberJoinedNotification(communityId, userId, memberName, community.name)
            .catch((err) => logger_util_1.default.error("Error sending member joined notification:", err));
        res.json({
            msg: "Joined community successfully",
            data: {
                ...member,
                joinedAt: member.joinedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Join community error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function leaveCommunity(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        // Check if user is owner
        if (await isOwner(communityId, userId)) {
            return res
                .status(400)
                .json({
                msg: "Owner cannot leave the community. Transfer ownership or delete the community instead.",
            });
        }
        // Get user info before deleting
        const leavingMember = await db_config_1.prisma.communityMember.findUnique({
            where: {
                communityId_userId: {
                    communityId,
                    userId,
                },
            },
            include: {
                user: {
                    select: {
                        username: true,
                        firstName: true,
                    },
                },
                community: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        await db_config_1.prisma.communityMember.delete({
            where: {
                communityId_userId: {
                    communityId,
                    userId,
                },
            },
        });
        // Create activity entry for leaving the community
        await community_activity_service_1.communityActivityService.createMemberLeftActivity(communityId, userId);
        // Notify owner and mods about member leaving
        if (leavingMember) {
            const memberName = leavingMember.user.username ||
                leavingMember.user.firstName ||
                "Someone";
            notification_service_1.notificationService
                .sendMemberLeftNotification(communityId, userId, memberName, leavingMember.community.name)
                .catch((err) => logger_util_1.default.error("Error sending member left notification:", err));
        }
        res.json({
            msg: "Left community successfully",
            data: null,
        });
    }
    catch (error) {
        logger_util_1.default.error("Leave community error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getCommunityMembers(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const skip = (page - 1) * limit;
        // Check if user is member
        if (!(await isMember(communityId, userId))) {
            return res.status(403).json({ msg: "Must be a member to view members" });
        }
        const totalCount = await db_config_1.prisma.communityMember.count({
            where: { communityId },
        });
        const members = await db_config_1.prisma.communityMember.findMany({
            where: { communityId },
            orderBy: [
                { role: "asc" }, // OWNER first, then MOD, then MEMBER
                { joinedAt: "asc" },
            ],
            skip,
            take: limit,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                        points: true, // Include total earned rewards
                    },
                },
            },
        });
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Members retrieved successfully",
            data: members.map((member) => ({
                ...member,
                joinedAt: member.joinedAt.toISOString(),
                totalRewards: member.user.points || 0, // Total earned rewards
            })),
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get community members error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function updateMemberRole(req, res) {
    try {
        const userId = req.userId;
        const { communityId: $communityId } = req.params;
        const communityId = String($communityId);
        const { userId: targetUserId, role } = req.body;
        // Check if requester is owner or mod
        if (!(await isOwnerOrMod(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Only owners and moderators can update member roles" });
        }
        // Owner cannot change their own role
        if (targetUserId === userId && (await isOwner(communityId, userId))) {
            return res
                .status(400)
                .json({ msg: "Owner cannot change their own role" });
        }
        const member = await db_config_1.prisma.communityMember.update({
            where: {
                communityId_userId: {
                    communityId,
                    userId: targetUserId,
                },
            },
            data: { role: role },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                community: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        // Notify user whose role was changed
        const changer = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, firstName: true },
        });
        const changerName = changer?.username || changer?.firstName || "Admin";
        notification_service_1.notificationService
            .sendRoleChangedNotification(targetUserId, role, member.community.name, communityId, changerName)
            .catch((err) => logger_util_1.default.error("Error sending role changed notification:", err));
        res.json({
            msg: "Member role updated successfully",
            data: {
                ...member,
                joinedAt: member.joinedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Update member role error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
// ==================== Goal Templates ====================
async function createTemplate(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const { goalText, milestones, reminderTime, reminderTimes, schedule, target, targetDays, } = req.body;
        // Check if user is owner or mod
        if (!(await isOwnerOrMod(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Only owners and moderators can create templates" });
        }
        const scheduleFields = getTemplateScheduleFields(schedule);
        const targetFields = getTemplateTargetFields(target, targetDays);
        const template = await db_config_1.prisma.goalTemplate.create({
            data: {
                communityId,
                createdBy: userId,
                goalText,
                reminderTime: reminderTime ?? null,
                reminderTimes: reminderTimes ?? (reminderTime ? [reminderTime] : []),
                ...scheduleFields,
                ...targetFields,
                targetDays,
                milestones: milestones && milestones.length > 0
                    ? {
                        create: milestones.map((m, index) => ({
                            name: m.name,
                            description: m.description || null,
                            triggerType: m.triggerType,
                            triggerValue: m.triggerValue,
                            points: m.points ?? 0,
                            sequenceBonusPoints: m.sequenceBonusPoints ?? 10,
                            sequenceStartDay: m.sequenceStartDay ?? null,
                            sequenceEndDay: m.sequenceEndDay ?? null,
                            order: m.order ?? index,
                        })),
                    }
                    : undefined,
            },
            include: {
                creator: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        startedGoals: true,
                    },
                },
                milestones: true,
            },
        });
        // Create community activity for template creation
        await community_activity_service_1.communityActivityService.createTemplateCreatedActivity(template.id, userId, communityId);
        // Notify all members about new template
        const creatorName = template.creator.username || template.creator.firstName || "Someone";
        const community = await db_config_1.prisma.community.findUnique({
            where: { id: communityId },
            select: { name: true },
        });
        if (community) {
            notification_service_1.notificationService
                .sendTemplateCreatedNotification(communityId, template.id, template.goalText || "", creatorName, community.name, userId)
                .catch((err) => logger_util_1.default.error("Error sending template created notification:", err));
        }
        res.json({
            msg: "Template created successfully",
            data: {
                ...template,
                createdAt: template.createdAt.toISOString(),
                updatedAt: template.updatedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Create template error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getTemplates(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const skip = (page - 1) * limit;
        // Check if user is member
        if (!(await isMember(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to view templates" });
        }
        const totalCount = await db_config_1.prisma.goalTemplate.count({
            where: { communityId },
        });
        const templates = await db_config_1.prisma.goalTemplate.findMany({
            where: { communityId },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
                creator: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        startedGoals: true,
                    },
                },
                milestones: {
                    orderBy: {
                        order: "asc",
                    },
                },
            },
        });
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Templates retrieved successfully",
            data: templates.map((template) => ({
                ...template,
                createdAt: template.createdAt.toISOString(),
                updatedAt: template.updatedAt.toISOString(),
            })),
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get templates error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getTemplateById(req, res) {
    try {
        const userId = req.userId;
        const { templateId } = req.params;
        const template = await db_config_1.prisma.goalTemplate.findUnique({
            where: { id: templateId },
            include: {
                community: {
                    select: {
                        id: true,
                        name: true,
                        isPublic: true,
                    },
                },
                creator: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        startedGoals: true,
                    },
                },
                milestones: {
                    orderBy: {
                        order: "asc",
                    },
                },
            },
        });
        if (!template) {
            return res.status(404).json({ msg: "Template not found" });
        }
        // Check if user is member of community
        if (!(await isMember(template.communityId, userId))) {
            return res.status(403).json({ msg: "Must be a member to view template" });
        }
        res.json({
            msg: "Template retrieved successfully",
            data: {
                ...template,
                createdAt: template.createdAt.toISOString(),
                updatedAt: template.updatedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get template by ID error:", {
            error,
            userId: req.userId,
            templateId: req.params.templateId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function updateTemplate(req, res) {
    try {
        const userId = req.userId;
        const { templateId } = req.params;
        const { goalText, milestones, reminderTime, reminderTimes, schedule, target, targetDays, } = req.body;
        const template = await db_config_1.prisma.goalTemplate.findUnique({
            where: { id: templateId },
        });
        if (!template) {
            return res.status(404).json({ msg: "Template not found" });
        }
        // Check if user is owner or mod of community, or creator of template
        const isCommunityOwnerOrMod = await isOwnerOrMod(template.communityId, userId);
        const isTemplateCreator = template.createdBy === userId;
        if (!isCommunityOwnerOrMod && !isTemplateCreator) {
            return res
                .status(403)
                .json({
                msg: "Only owners, moderators, or template creator can update templates",
            });
        }
        const scheduleFields = schedule
            ? getTemplateScheduleFields(schedule)
            : null;
        const targetFields = target
            ? getTemplateTargetFields(target, targetDays ?? template.targetDays)
            : null;
        const updatedTemplate = await db_config_1.prisma.$transaction(async (tx) => {
            const updated = await tx.goalTemplate.update({
                where: { id: templateId },
                data: {
                    ...(goalText && { goalText }),
                    ...(typeof targetDays === "number" && { targetDays }),
                    ...(reminderTime !== undefined && {
                        reminderTime: reminderTime || null,
                    }),
                    ...(reminderTimes !== undefined && { reminderTimes }),
                    ...(scheduleFields ?? {}),
                    ...(targetFields ?? {}),
                },
            });
            if (Array.isArray(milestones)) {
                const incomingIds = milestones
                    .filter((m) => !!m.id)
                    .map((m) => m.id);
                // If there are no incoming milestones, delete all existing milestones
                if (milestones.length === 0) {
                    await tx.templateMilestone.deleteMany({
                        where: { templateId },
                    });
                }
                else {
                    // Delete milestones that are not in the incoming list (only if we have at least one id)
                    if (incomingIds.length > 0) {
                        await tx.templateMilestone.deleteMany({
                            where: {
                                templateId,
                                id: {
                                    notIn: incomingIds,
                                },
                            },
                        });
                    }
                    else {
                        // No existing ids passed, clear all then recreate
                        await tx.templateMilestone.deleteMany({
                            where: { templateId },
                        });
                    }
                    // Upsert/create incoming milestones
                    for (let index = 0; index < milestones.length; index++) {
                        const m = milestones[index];
                        const order = typeof m.order === "number" ? m.order : index;
                        if (m.id) {
                            await tx.templateMilestone.update({
                                where: { id: m.id },
                                data: {
                                    name: m.name,
                                    description: m.description || null,
                                    triggerType: m.triggerType,
                                    triggerValue: m.triggerValue,
                                    points: m.points ?? 0,
                                    sequenceBonusPoints: m.sequenceBonusPoints ?? 10,
                                    sequenceStartDay: m.sequenceStartDay ?? null,
                                    sequenceEndDay: m.sequenceEndDay ?? null,
                                    order,
                                },
                            });
                        }
                        else {
                            await tx.templateMilestone.create({
                                data: {
                                    templateId,
                                    name: m.name,
                                    description: m.description || null,
                                    triggerType: m.triggerType,
                                    triggerValue: m.triggerValue,
                                    points: m.points ?? 0,
                                    sequenceBonusPoints: m.sequenceBonusPoints ?? 10,
                                    sequenceStartDay: m.sequenceStartDay ?? null,
                                    sequenceEndDay: m.sequenceEndDay ?? null,
                                    order,
                                },
                            });
                        }
                    }
                }
            }
            return tx.goalTemplate.findUniqueOrThrow({
                where: { id: templateId },
                include: {
                    creator: {
                        select: {
                            id: true,
                            username: true,
                            firstName: true,
                            lastName: true,
                            avatarUrl: true,
                        },
                    },
                    _count: {
                        select: {
                            startedGoals: true,
                        },
                    },
                    milestones: {
                        orderBy: {
                            order: "asc",
                        },
                    },
                },
            });
        });
        res.json({
            msg: "Template updated successfully",
            data: {
                ...updatedTemplate,
                createdAt: updatedTemplate.createdAt.toISOString(),
                updatedAt: updatedTemplate.updatedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Update template error:", {
            error,
            userId: req.userId,
            templateId: req.params.templateId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getTemplateParticipants(req, res) {
    try {
        const userId = req.userId;
        const { templateId } = req.params;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const skip = (page - 1) * limit;
        const template = await db_config_1.prisma.goalTemplate.findUnique({
            where: { id: templateId },
            include: {
                community: true,
            },
        });
        if (!template) {
            return res.status(404).json({ msg: "Template not found" });
        }
        // Check if user is member of community
        if (!(await isMember(template.communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to view template participants" });
        }
        // Get goals started from this template with user info and progress
        const [goals, totalCount] = await Promise.all([
            db_config_1.prisma.goal.findMany({
                where: {
                    templateId: templateId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            firstName: true,
                            lastName: true,
                            avatarUrl: true,
                        },
                    },
                },
                orderBy: {
                    startedAt: "desc",
                },
                take: limit,
                skip,
            }),
            db_config_1.prisma.goal.count({
                where: {
                    templateId: templateId,
                },
            }),
        ]);
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Template participants retrieved successfully",
            data: goals.map((goal) => ({
                goalId: goal.id,
                userId: goal.userId,
                user: goal.user,
                currentDay: goal.currentDay,
                targetDays: goal.targetDays,
                progress: Math.round((goal.currentDay / goal.targetDays) * 100),
                lastCheckInDate: goal.lastCheckInDate?.toISOString() || null,
                startedAt: goal.startedAt.toISOString(),
                isCompleted: goal.currentDay >= goal.targetDays,
            })),
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get template participants error:", {
            error,
            userId: req.userId,
            templateId: req.params.templateId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function deleteTemplate(req, res) {
    try {
        const userId = req.userId;
        const { templateId } = req.params;
        const template = await db_config_1.prisma.goalTemplate.findUnique({
            where: { id: templateId },
        });
        if (!template) {
            return res.status(404).json({ msg: "Template not found" });
        }
        // Check if user is owner or mod of community, or creator of template
        const isCommunityOwnerOrMod = await isOwnerOrMod(template.communityId, userId);
        const isTemplateCreator = template.createdBy === userId;
        if (!isCommunityOwnerOrMod && !isTemplateCreator) {
            return res
                .status(403)
                .json({
                msg: "Only owners, moderators, or template creator can delete templates",
            });
        }
        // Get template and community info before deleting
        const templateWithCommunity = await db_config_1.prisma.goalTemplate.findUnique({
            where: { id: templateId },
            include: {
                community: {
                    select: {
                        name: true,
                    },
                },
            },
        });
        await db_config_1.prisma.goalTemplate.delete({
            where: { id: templateId },
        });
        // Notify users who started goals from this template
        if (templateWithCommunity) {
            notification_service_1.notificationService
                .sendTemplateDeletedNotification(templateId, templateWithCommunity.goalText || "", templateWithCommunity.community.name, template.communityId)
                .catch((err) => logger_util_1.default.error("Error sending template deleted notification:", err));
        }
        res.json({
            msg: "Template deleted successfully",
            data: null,
        });
    }
    catch (error) {
        logger_util_1.default.error("Delete template error:", {
            error,
            userId: req.userId,
            templateId: req.params.templateId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function startGoalFromTemplate(req, res) {
    try {
        const userId = req.userId;
        const { templateId } = req.params;
        const { reminderTime, reminderTimes, rewardReleasePolicy, schedule: scheduleOverride, } = req.body;
        await (0, subscription_access_service_1.assertCanCreateGoal)(userId, req.clientApp);
        const template = await db_config_1.prisma.goalTemplate.findUnique({
            where: { id: templateId },
            include: {
                community: true,
                milestones: { orderBy: { order: "asc" } },
            },
        });
        if (!template) {
            return res.status(404).json({ msg: "Template not found" });
        }
        // Check if user is member of community
        if (!(await isMember(template.communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to start goals from templates" });
        }
        // Get user info for notification
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { firstName: true, timezone: true, username: true },
        });
        const timezone = user?.timezone ?? "UTC";
        const startDate = luxon_1.DateTime.now().setZone(timezone).toISODate() ?? new Date().toISOString().slice(0, 10);
        let schedule;
        if (scheduleOverride) {
            schedule = scheduleOverride;
        }
        else if (template.scheduleType === client_1.GoalScheduleType.ONE_TIME) {
            schedule = { date: startDate, type: "ONE_TIME" };
        }
        else if (template.scheduleType === client_1.GoalScheduleType.WEEKLY) {
            schedule = {
                startDate,
                type: "WEEKLY",
                weekday: template.weekdays[0] ?? luxon_1.DateTime.fromISO(startDate).weekday,
            };
        }
        else if (template.scheduleType === client_1.GoalScheduleType.SELECTED_WEEKDAYS) {
            schedule = {
                startDate,
                type: "SELECTED_WEEKDAYS",
                weekdays: template.weekdays.length
                    ? template.weekdays
                    : [luxon_1.DateTime.fromISO(startDate).weekday],
            };
        }
        else {
            schedule = { startDate, type: "DAILY" };
        }
        let target;
        if (template.targetType === client_1.GoalTargetType.QUANTITY) {
            target = {
                amount: template.targetValue ?? template.targetDays,
                type: "QUANTITY",
                unit: template.unit ?? "units",
            };
        }
        else if (template.targetType === client_1.GoalTargetType.UNTIL_DATE) {
            target = {
                endDate: luxon_1.DateTime.fromISO(startDate)
                    .plus({ days: Math.max(1, template.targetDays) - 1 })
                    .toISODate() ?? startDate,
                type: "UNTIL_DATE",
            };
        }
        else {
            target = {
                count: Math.max(1, Math.round(template.targetValue ?? template.targetDays)),
                type: "CHECK_IN_COUNT",
            };
        }
        const rewards = getTemplateRewardMilestones(template.milestones, Math.max(1, template.targetDays));
        const goal = await (0, goal_v2_service_1.createGoalV2)(userId, timezone, {
            communityId: template.communityId,
            missPolicy: { mode: "STRICT" },
            reminderTimes: reminderTimes ??
                (reminderTime
                    ? [reminderTime]
                    : template.reminderTimes.length
                        ? template.reminderTimes
                        : template.reminderTime
                            ? [template.reminderTime]
                            : []),
            rewardReleasePolicy: rewardReleasePolicy ?? "ON_COMPLETION",
            schedule,
            target,
            templateId: template.id,
            title: template.goalText ?? "Community goal",
        }, {
            rewardMilestones: rewards,
            rewardSource: client_1.GoalRewardPlanSource.COMMUNITY_TEMPLATE,
        });
        // Notify template creator (if not the same user)
        if (template.createdBy !== userId) {
            const starterName = user?.username || user?.firstName || "Someone";
            notification_service_1.notificationService
                .sendGoalStartedFromTemplateNotification(template.createdBy, starterName, template.goalText || "", template.community.name, template.communityId, goal.id)
                .catch((err) => logger_util_1.default.error("Error sending goal started notification:", err));
        }
        res.status(201).json({
            msg: "Goal started from template successfully",
            data: goal,
        });
    }
    catch (error) {
        if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
            return;
        logger_util_1.default.error("Start goal from template error:", {
            error,
            userId: req.userId,
            templateId: req.params.templateId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
// ==================== Activity Feed ====================
async function getActivityFeed(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const skip = (page - 1) * limit;
        // Check if user is member
        if (!(await isMember(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to view activity feed" });
        }
        const blockedUserIds = await getBlockedUserIds(userId);
        const feedWhere = { communityId, userId: { notIn: blockedUserIds } };
        const totalCount = await db_config_1.prisma.communityActivity.count({
            where: feedWhere,
        });
        const activities = await db_config_1.prisma.communityActivity.findMany({
            where: feedWhere,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: {
                    select: {
                        reactions: true,
                        comments: true,
                    },
                },
            },
        });
        // Check if user has reacted to each activity
        const activitiesWithReactions = await Promise.all(activities.map(async (activity) => {
            const userReaction = await db_config_1.prisma.activityReaction.findUnique({
                where: {
                    activityId_userId: {
                        activityId: activity.id,
                        userId,
                    },
                },
            });
            const createdAtDate = activity.createdAt;
            const hourBucket = new Date(Date.UTC(createdAtDate.getUTCFullYear(), createdAtDate.getUTCMonth(), createdAtDate.getUTCDate(), createdAtDate.getUTCHours(), 0, 0, 0)).toISOString();
            return {
                ...activity,
                createdAt: activity.createdAt.toISOString(),
                hasUserReacted: !!userReaction,
                hourBucket,
            };
        }));
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Activity feed retrieved successfully",
            data: activitiesWithReactions,
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get activity feed error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function reactToActivity(req, res) {
    try {
        const userId = req.userId;
        const { activityId } = req.params;
        // Check if activity exists and user is member of community
        const activity = await db_config_1.prisma.communityActivity.findUnique({
            where: { id: activityId },
            include: {
                community: true,
            },
        });
        if (!activity) {
            return res.status(404).json({ msg: "Activity not found" });
        }
        if (!(await isMember(activity.communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to react to activities" });
        }
        // Check if already reacted
        const existingReaction = await db_config_1.prisma.activityReaction.findUnique({
            where: {
                activityId_userId: {
                    activityId,
                    userId,
                },
            },
        });
        if (existingReaction) {
            // Remove reaction (toggle off)
            await db_config_1.prisma.activityReaction.delete({
                where: {
                    activityId_userId: {
                        activityId,
                        userId,
                    },
                },
            });
            return res.json({
                msg: "Reaction removed successfully",
                data: { reacted: false },
            });
        }
        // Add reaction
        await db_config_1.prisma.activityReaction.create({
            data: {
                activityId,
                userId,
            },
        });
        // Notify activity owner (if not the same user)
        if (activity.userId !== userId) {
            const reactor = await db_config_1.prisma.user.findUnique({
                where: { id: userId },
                select: { username: true, firstName: true },
            });
            const reactorName = reactor?.username || reactor?.firstName || "Someone";
            notification_service_1.notificationService
                .sendActivityReactionNotification(activity.userId, reactorName, activity.type, activity.community.name, activity.communityId, activityId)
                .catch((err) => logger_util_1.default.error("Error sending reaction notification:", err));
        }
        res.json({
            msg: "Reaction added successfully",
            data: { reacted: true },
        });
    }
    catch (error) {
        logger_util_1.default.error("React to activity error:", {
            error,
            userId: req.userId,
            activityId: req.params.activityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function createComment(req, res) {
    try {
        const userId = req.userId;
        const { activityId } = req.params;
        const { text } = req.body;
        if ((0, content_moderation_util_1.containsObjectionableContent)(text)) {
            return res.status(400).json({
                code: "CONTENT_REJECTED",
                msg: "This comment cannot be posted because it contains abusive content.",
            });
        }
        // Check if activity exists and user is member of community
        const activity = await db_config_1.prisma.communityActivity.findUnique({
            where: { id: activityId },
            include: {
                community: true,
            },
        });
        if (!activity) {
            return res.status(404).json({ msg: "Activity not found" });
        }
        if (!(await isMember(activity.communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to comment on activities" });
        }
        const comment = await db_config_1.prisma.activityComment.create({
            data: {
                activityId,
                userId,
                text,
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        // Notify activity owner (if not the same user)
        if (activity.userId !== userId) {
            const commenterName = comment.user.username || comment.user.firstName || "Someone";
            notification_service_1.notificationService
                .sendActivityCommentNotification(activity.userId, commenterName, text, activity.community.name, activity.communityId, activityId)
                .catch((err) => logger_util_1.default.error("Error sending comment notification:", err));
        }
        res.json({
            msg: "Comment created successfully",
            data: {
                ...comment,
                createdAt: comment.createdAt.toISOString(),
                updatedAt: comment.updatedAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Create comment error:", {
            error,
            userId: req.userId,
            activityId: req.params.activityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function getComments(req, res) {
    try {
        const userId = req.userId;
        const { activityId } = req.params;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const skip = (page - 1) * limit;
        // Check if activity exists and user is member of community
        const activity = await db_config_1.prisma.communityActivity.findUnique({
            where: { id: activityId },
            include: {
                community: true,
            },
        });
        if (!activity) {
            return res.status(404).json({ msg: "Activity not found" });
        }
        if (!(await isMember(activity.communityId, userId))) {
            return res.status(403).json({ msg: "Must be a member to view comments" });
        }
        const blockedUserIds = await getBlockedUserIds(userId);
        const commentsWhere = { activityId, userId: { notIn: blockedUserIds } };
        const totalCount = await db_config_1.prisma.activityComment.count({
            where: commentsWhere,
        });
        const comments = await db_config_1.prisma.activityComment.findMany({
            where: commentsWhere,
            orderBy: { createdAt: "asc" },
            skip,
            take: limit,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "Comments retrieved successfully",
            data: comments.map((comment) => ({
                ...comment,
                createdAt: comment.createdAt.toISOString(),
                updatedAt: comment.updatedAt.toISOString(),
            })),
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get comments error:", {
            error,
            userId: req.userId,
            activityId: req.params.activityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function deleteComment(req, res) {
    try {
        const userId = req.userId;
        const { commentId } = req.params;
        const comment = await db_config_1.prisma.activityComment.findUnique({
            where: { id: commentId },
            include: {
                activity: {
                    include: {
                        community: true,
                    },
                },
            },
        });
        if (!comment) {
            return res.status(404).json({ msg: "Comment not found" });
        }
        // Check if user is comment author, owner, or mod
        const isCommentAuthor = comment.userId === userId;
        const isOwnerOrModd = await isOwnerOrMod(comment?.activity?.communityId, userId);
        if (!isCommentAuthor && !isOwnerOrModd) {
            return res
                .status(403)
                .json({
                msg: "Only comment author, owner, or moderators can delete comments",
            });
        }
        await db_config_1.prisma.activityComment.delete({
            where: { id: commentId },
        });
        res.json({
            msg: "Comment deleted successfully",
            data: null,
        });
    }
    catch (error) {
        logger_util_1.default.error("Delete comment error:", {
            error,
            userId: req.userId,
            commentId: req.params.commentId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
// ==================== Stats ====================
async function getCommunityStats(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        // Check if user is member
        if (!(await isMember(communityId, userId))) {
            return res.status(403).json({ msg: "Must be a member to view stats" });
        }
        const [memberCount, templateCount, activeGoalCount, recentActivityCount] = await Promise.all([
            db_config_1.prisma.communityMember.count({
                where: { communityId },
            }),
            db_config_1.prisma.goalTemplate.count({
                where: { communityId },
            }),
            db_config_1.prisma.goal.count({
                where: {
                    communityId,
                    lastCheckInDate: {
                        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
                    },
                },
            }),
            db_config_1.prisma.communityActivity.count({
                where: {
                    communityId,
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                    },
                },
            }),
        ]);
        res.json({
            msg: "Community stats retrieved successfully",
            data: {
                memberCount,
                templateCount,
                activeGoalCount,
                recentActivityCount,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get community stats error:", {
            error,
            userId: req.userId,
            communityId: req.params.communityId,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
// ==================== My Communities ====================
async function getMyCommunities(req, res) {
    try {
        const userId = req.userId;
        const pageParam = Array.isArray(req.query.page)
            ? req.query.page[0]
            : req.query.page;
        const limitParam = Array.isArray(req.query.limit)
            ? req.query.limit[0]
            : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "10")) || 10;
        const skip = (page - 1) * limit;
        const totalCount = await db_config_1.prisma.communityMember.count({
            where: { userId },
        });
        const memberships = await db_config_1.prisma.communityMember.findMany({
            where: { userId },
            orderBy: { joinedAt: "desc" },
            skip,
            take: limit,
            include: {
                community: {
                    include: {
                        owner: {
                            select: {
                                id: true,
                                username: true,
                                firstName: true,
                                lastName: true,
                                avatarUrl: true,
                            },
                        },
                        _count: {
                            select: {
                                members: true,
                                templates: true,
                                goals: true,
                            },
                        },
                    },
                },
            },
        });
        const totalPages = Math.ceil(totalCount / limit);
        const hasNextPage = page < totalPages;
        const hasPrevPage = page > 1;
        res.json({
            msg: "My communities retrieved successfully",
            data: memberships.map((membership) => ({
                ...membership.community,
                createdAt: membership.community.createdAt.toISOString(),
                updatedAt: membership.community.updatedAt.toISOString(),
                role: membership.role,
                joinedAt: membership.joinedAt.toISOString(),
            })),
            pagination: {
                page,
                limit,
                totalCount,
                totalPages,
                hasNextPage,
                hasPrevPage,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get my communities error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
// ==================== Invite System ====================
/** Generate a short, unique, uppercase invite code */
async function generateInviteCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O, 0, I, 1 to avoid confusion
    let code;
    let exists = true;
    do {
        code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
        const existing = await db_config_1.prisma.communityInvite.findUnique({
            where: { code },
        });
        exists = !!existing;
    } while (exists);
    return code;
}
function buildCommunityInviteLink(code) {
    return `https://vybaa.app/invite/${code}`;
}
async function findActiveDuplicateInvite(params) {
    const now = new Date();
    if (!params.inviteeUsername && !params.inviteeEmail) {
        return null;
    }
    const invites = await db_config_1.prisma.communityInvite.findMany({
        where: {
            communityId: params.communityId,
            ...(params.inviteeUsername
                ? { inviteeUsername: params.inviteeUsername }
                : {}),
            ...(params.inviteeEmail ? { inviteeEmail: params.inviteeEmail } : {}),
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
    });
    return (invites.find((invite) => invite.maxUses === -1 || invite.uses < invite.maxUses) || null);
}
/** POST /communities/:communityId/invites - Create invite link/code or invite by username/email */
async function createInvite(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        const { inviteeUsername, inviteeEmail, maxUses, expiresInDays } = req.body;
        const normalizedUsername = inviteeUsername
            ? String(inviteeUsername).trim().replace(/^@/, "")
            : undefined;
        const normalizedEmail = inviteeEmail
            ? String(inviteeEmail).trim().toLowerCase()
            : undefined;
        // Must be member (or owner/mod) to create invite
        if (!(await isMember(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Must be a member to create invites" });
        }
        const community = await db_config_1.prisma.community.findUnique({
            where: { id: communityId },
            include: { owner: { select: { username: true, firstName: true } } },
        });
        if (!community)
            return res.status(404).json({ msg: "Community not found" });
        const inviter = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, firstName: true, lastName: true },
        });
        let inviteeUserId;
        if (normalizedUsername) {
            const target = await db_config_1.prisma.user.findFirst({
                where: {
                    username: { equals: normalizedUsername, mode: "insensitive" },
                },
                select: { id: true, username: true },
            });
            if (!target)
                return res
                    .status(404)
                    .json({ msg: `User @${normalizedUsername} not found` });
            if (await isMember(communityId, target.id)) {
                return res
                    .status(400)
                    .json({
                    msg: `@${target.username || normalizedUsername} is already a member`,
                });
            }
            inviteeUserId = target.id;
        }
        if (normalizedEmail) {
            const target = await db_config_1.prisma.user.findUnique({
                where: { email: normalizedEmail },
                select: { id: true },
            });
            if (target && (await isMember(communityId, target.id))) {
                return res
                    .status(400)
                    .json({ msg: `${normalizedEmail} is already a member` });
            }
            inviteeUserId = target?.id || inviteeUserId;
        }
        const duplicateInvite = await findActiveDuplicateInvite({
            communityId,
            inviteeUsername: normalizedUsername,
            inviteeEmail: normalizedEmail,
        });
        if (duplicateInvite) {
            return res.status(409).json({
                msg: "There is already an active invite for this recipient",
                data: {
                    id: duplicateInvite.id,
                    code: duplicateInvite.code,
                    communityId: duplicateInvite.communityId,
                    communityName: community.name,
                    inviteeUsername: duplicateInvite.inviteeUsername,
                    inviteeEmail: duplicateInvite.inviteeEmail,
                    maxUses: duplicateInvite.maxUses,
                    uses: duplicateInvite.uses,
                    expiresAt: duplicateInvite.expiresAt?.toISOString() || null,
                    createdAt: duplicateInvite.createdAt.toISOString(),
                    link: buildCommunityInviteLink(duplicateInvite.code),
                },
            });
        }
        const expiresAt = expiresInDays
            ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
            : undefined;
        const code = await generateInviteCode();
        const invite = await db_config_1.prisma.communityInvite.create({
            data: {
                communityId,
                code,
                createdBy: userId,
                inviteeEmail: normalizedEmail || undefined,
                inviteeUsername: normalizedUsername || undefined,
                inviteeUserId: inviteeUserId || undefined,
                maxUses: maxUses ?? -1,
                expiresAt: expiresAt,
            },
        });
        const link = buildCommunityInviteLink(invite.code);
        const inviterName = inviter?.username ||
            [inviter?.firstName, inviter?.lastName].filter(Boolean).join(" ") ||
            "Someone";
        if (inviteeUserId) {
            notification_service_1.notificationService
                .createNotification({
                userId: inviteeUserId,
                type: "system",
                title: `${inviterName} invited you`,
                message: `${inviterName} invited you to join ${community.name}.`,
                data: {
                    communityId,
                    communityName: community.name,
                    code,
                    link,
                    route: `/app/invite/${code}`,
                    type: "community_invite",
                },
            })
                .catch((err) => logger_util_1.default.error("Error sending invite notification:", err));
        }
        if (normalizedEmail) {
            email_service_1.emailService
                .sendCommunityInviteEmail({
                to: normalizedEmail,
                communityName: community.name,
                inviteCode: invite.code,
                inviteLink: link,
                inviterName,
            })
                .catch((err) => logger_util_1.default.error("Error sending community invite email:", err));
        }
        res.json({
            msg: "Invite created successfully",
            data: {
                id: invite.id,
                code: invite.code,
                communityId: invite.communityId,
                communityName: community.name,
                inviteeUsername: invite.inviteeUsername,
                inviteeEmail: invite.inviteeEmail,
                maxUses: invite.maxUses,
                uses: invite.uses,
                expiresAt: invite.expiresAt?.toISOString() || null,
                createdAt: invite.createdAt.toISOString(),
                // Deep link for sharing
                link,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Create invite error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/** GET /communities/invites/:code - Get invite details (public preview) */
async function getInviteByCode(req, res) {
    try {
        const { code } = req.params;
        const invite = await db_config_1.prisma.communityInvite.findUnique({
            where: { code: code?.toUpperCase() },
            include: {
                community: {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        coverImage: true,
                        _count: { select: { members: true } },
                    },
                },
                creator: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
            },
        });
        if (!invite)
            return res.status(404).json({ msg: "Invite not found or expired" });
        // Check expiry
        if (invite.expiresAt && invite.expiresAt < new Date()) {
            return res.status(410).json({ msg: "This invite has expired" });
        }
        // Check max uses
        if (invite.maxUses !== -1 && invite.uses >= invite.maxUses) {
            return res
                .status(410)
                .json({ msg: "This invite has reached its maximum uses" });
        }
        res.json({
            msg: "Invite found",
            data: {
                id: invite.id,
                code: invite.code,
                community: invite.community,
                invitedBy: invite.creator,
                expiresAt: invite.expiresAt?.toISOString() || null,
                createdAt: invite.createdAt.toISOString(),
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get invite error:", { error, code: req.params.code });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/** POST /communities/invites/:code/join - Join community via invite code */
async function joinByInviteCode(req, res) {
    try {
        const userId = req.userId;
        const { code } = req.params;
        const invite = await db_config_1.prisma.communityInvite.findUnique({
            where: { code: code?.toUpperCase() },
            include: {
                community: {
                    select: {
                        id: true,
                        name: true,
                        _count: { select: { members: true } },
                    },
                },
            },
        });
        if (!invite)
            return res.status(404).json({ msg: "Invite not found" });
        // Check expiry
        if (invite.expiresAt && invite.expiresAt < new Date()) {
            return res.status(410).json({ msg: "This invite has expired" });
        }
        // Check max uses
        if (invite.maxUses !== -1 && invite.uses >= invite.maxUses) {
            return res
                .status(410)
                .json({ msg: "This invite has reached its maximum uses" });
        }
        const communityId = invite.communityId;
        // Already a member?
        if (await isMember(communityId, userId)) {
            return res
                .status(400)
                .json({ msg: "You are already a member of this community" });
        }
        // If targeted invite, check it's for this user
        if (invite.inviteeUserId && invite.inviteeUserId !== userId) {
            return res
                .status(403)
                .json({ msg: "This invite is for a different user" });
        }
        if (invite.inviteeEmail) {
            const user = await db_config_1.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true },
            });
            if (user?.email.toLowerCase() !== invite.inviteeEmail.toLowerCase()) {
                return res
                    .status(403)
                    .json({ msg: "This invite is for a different email address" });
            }
        }
        // Add member
        const [member] = await db_config_1.prisma.$transaction([
            db_config_1.prisma.communityMember.create({
                data: { communityId, userId, role: "MEMBER" },
            }),
            db_config_1.prisma.communityInvite.update({
                where: { id: invite.id },
                data: { uses: { increment: 1 } },
            }),
        ]);
        // Get user for notifications
        const user = await db_config_1.prisma.user.findUnique({
            where: { id: userId },
            select: { username: true, firstName: true, lastName: true },
        });
        const displayName = user?.username ||
            [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
            "Someone";
        // Notify community owner/mods
        await notification_service_1.notificationService.sendMemberJoinedNotification(communityId, userId, displayName, invite.community.name);
        // Fetch the community with full info to return
        const community = await db_config_1.prisma.community.findUnique({
            where: { id: communityId },
            include: {
                owner: {
                    select: {
                        id: true,
                        username: true,
                        firstName: true,
                        lastName: true,
                        avatarUrl: true,
                    },
                },
                _count: { select: { members: true, templates: true, goals: true } },
            },
        });
        res.json({
            msg: `Joined "${invite.community.name}" successfully!`,
            data: {
                community: community
                    ? {
                        ...community,
                        createdAt: community.createdAt.toISOString(),
                        updatedAt: community.updatedAt.toISOString(),
                        isMember: true,
                        userRole: "MEMBER",
                    }
                    : null,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("Join by code error:", {
            error,
            userId: req.userId,
            code: req.params.code,
        });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/** GET /communities/:communityId/invites - List invites for a community (owner/mod only) */
async function getCommunityInvites(req, res) {
    try {
        const userId = req.userId;
        const { communityId } = req.params;
        if (!(await isOwnerOrMod(communityId, userId))) {
            return res
                .status(403)
                .json({ msg: "Only owners and moderators can view invites" });
        }
        const invites = await db_config_1.prisma.communityInvite.findMany({
            where: { communityId },
            orderBy: { createdAt: "desc" },
            include: {
                creator: { select: { id: true, username: true, firstName: true } },
                invitee: { select: { id: true, username: true, firstName: true } },
            },
        });
        res.json({
            msg: "Invites retrieved",
            data: invites.map((inv) => ({
                id: inv.id,
                code: inv.code,
                link: buildCommunityInviteLink(inv.code),
                invitedBy: inv.creator,
                invitee: inv.invitee || null,
                inviteeUsername: inv.inviteeUsername,
                inviteeEmail: inv.inviteeEmail,
                maxUses: inv.maxUses,
                uses: inv.uses,
                expiresAt: inv.expiresAt?.toISOString() || null,
                createdAt: inv.createdAt.toISOString(),
                isExpired: inv.expiresAt ? inv.expiresAt < new Date() : false,
                isMaxed: inv.maxUses !== -1 && inv.uses >= inv.maxUses,
            })),
        });
    }
    catch (error) {
        logger_util_1.default.error("Get invites error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/** DELETE /communities/invites/:inviteId - Revoke an invite */
async function revokeInvite(req, res) {
    try {
        const userId = req.userId;
        const { inviteId } = req.params;
        const invite = await db_config_1.prisma.communityInvite.findUnique({
            where: { id: inviteId },
        });
        if (!invite)
            return res.status(404).json({ msg: "Invite not found" });
        if (!(await isOwnerOrMod(invite.communityId, userId)) &&
            invite.createdBy !== userId) {
            return res
                .status(403)
                .json({ msg: "Not authorized to revoke this invite" });
        }
        await db_config_1.prisma.communityInvite.delete({ where: { id: inviteId } });
        res.json({ msg: "Invite revoked" });
    }
    catch (error) {
        logger_util_1.default.error("Revoke invite error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
