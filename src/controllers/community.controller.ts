import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import { communityActivityService } from "../services/community-activity.service";
import logger from "../utils/logger.util";
import { CommunityMemberRole, CommunityActivityType } from "@prisma/client";

// Helper function to check if user is owner or mod of community
async function isOwnerOrMod(communityId: string, userId: string): Promise<boolean> {
  const member = await prisma.communityMember.findUnique({
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
async function isOwner(communityId: string, userId: string): Promise<boolean> {
  const community = await prisma.community.findUnique({
    where: { id: communityId },
  });

  return community?.ownerId === userId;
}

// Helper function to check if user is member of community
async function isMember(communityId: string, userId: string): Promise<boolean> {
  const member = await prisma.communityMember.findUnique({
    where: {
      communityId_userId: {
        communityId,
        userId,
      },
    },
  });

  return !!member;
}

// ==================== Community CRUD ====================

export async function createCommunity(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { name, description, coverImage, isPublic, category } = req.body;

    const community = await prisma.community.create({
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
  } catch (error) {
    logger.error("Create community error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getCommunities(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const isPublicParam = Array.isArray(req.query.isPublic) ? req.query.isPublic[0] : req.query.isPublic;
    const categoryParam = Array.isArray(req.query.category) ? req.query.category[0] : req.query.category;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "10")) || 10;
    const skip = (page - 1) * limit;

    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        msg: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    const where: any = {};
    if (isPublicParam !== undefined) {
      where.isPublic = isPublicParam === "true" || isPublicParam === "1";
    }
    if (categoryParam) {
      where.category = categoryParam;
    }

    const totalCount = await prisma.community.count({ where });

    const communities = await prisma.community.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
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

    // Check if user is member of each community
    const communitiesWithMembership = await Promise.all(
      communities.map(async (community) => {
        const isUserMember = await isMember(community.id, userId);
        return {
          ...community,
          createdAt: community.createdAt.toISOString(),
          updatedAt: community.updatedAt.toISOString(),
          isMember: isUserMember,
        };
      })
    );

    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.json({
      msg: "Communities retrieved successfully",
      data: communitiesWithMembership,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    logger.error("Get communities error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getCommunityById(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;

    const community = await prisma.community.findUnique({
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
    const member = await prisma.communityMember.findUnique({
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
  } catch (error) {
    logger.error("Get community by ID error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateCommunity(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;
    const { name, description, coverImage, isPublic, category } = req.body;

    // Check if user is owner
    if (!(await isOwner(communityId, userId))) {
      return res.status(403).json({ msg: "Only the owner can update the community" });
    }

    const community = await prisma.community.update({
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
  } catch (error) {
    logger.error("Update community error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function deleteCommunity(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;

    // Check if user is owner
    if (!(await isOwner(communityId, userId))) {
      return res.status(403).json({ msg: "Only the owner can delete the community" });
    }

    await prisma.community.delete({
      where: { id: communityId },
    });

    res.json({
      msg: "Community deleted successfully",
      data: null,
    });
  } catch (error) {
    logger.error("Delete community error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

// ==================== Membership ====================

export async function joinCommunity(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.body;

    // Check if community exists and is public
    const community = await prisma.community.findUnique({
      where: { id: communityId },
    });

    if (!community) {
      return res.status(404).json({ msg: "Community not found" });
    }

    if (!community.isPublic) {
      return res.status(403).json({ msg: "Cannot join private community" });
    }

    // Check if already a member
    const existingMember = await prisma.communityMember.findUnique({
      where: {
        communityId_userId: {
          communityId,
          userId,
        },
      },
    });

    if (existingMember) {
      return res.status(400).json({ msg: "Already a member of this community" });
    }

    const member = await prisma.communityMember.create({
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

    res.json({
      msg: "Joined community successfully",
      data: {
        ...member,
        joinedAt: member.joinedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Join community error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function leaveCommunity(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;

    // Check if user is owner
    if (await isOwner(communityId, userId)) {
      return res.status(400).json({ msg: "Owner cannot leave the community. Transfer ownership or delete the community instead." });
    }

    await prisma.communityMember.delete({
      where: {
        communityId_userId: {
          communityId,
          userId,
        },
      },
    });

    res.json({
      msg: "Left community successfully",
      data: null,
    });
  } catch (error) {
    logger.error("Leave community error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getCommunityMembers(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "20")) || 20;
    const skip = (page - 1) * limit;

    // Check if user is member
    if (!(await isMember(communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to view members" });
    }

    const totalCount = await prisma.communityMember.count({
      where: { communityId },
    });

    const members = await prisma.communityMember.findMany({
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
  } catch (error) {
    logger.error("Get community members error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateMemberRole(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;
    const { userId: targetUserId, role } = req.body;

    // Check if requester is owner or mod
    if (!(await isOwnerOrMod(communityId, userId))) {
      return res.status(403).json({ msg: "Only owners and moderators can update member roles" });
    }

    // Owner cannot change their own role
    if (targetUserId === userId && (await isOwner(communityId, userId))) {
      return res.status(400).json({ msg: "Owner cannot change their own role" });
    }

    const member = await prisma.communityMember.update({
      where: {
        communityId_userId: {
          communityId,
          userId: targetUserId,
        },
      },
      data: { role: role as CommunityMemberRole },
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

    res.json({
      msg: "Member role updated successfully",
      data: {
        ...member,
        joinedAt: member.joinedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Update member role error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

// ==================== Goal Templates ====================

export async function createTemplate(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;
    const { goalText, targetDays, reminderTime } = req.body;

    // Check if user is owner or mod
    if (!(await isOwnerOrMod(communityId, userId))) {
      return res.status(403).json({ msg: "Only owners and moderators can create templates" });
    }

    const template = await prisma.goalTemplate.create({
      data: {
        communityId,
        goalText,
        targetDays,
        reminderTime: reminderTime || null,
        createdBy: userId,
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
      },
    });

    // Create community activity for template creation
    await communityActivityService.createTemplateCreatedActivity(template.id, userId, communityId);

    res.json({
      msg: "Template created successfully",
      data: {
        ...template,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Create template error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getTemplates(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "20")) || 20;
    const skip = (page - 1) * limit;

    // Check if user is member
    if (!(await isMember(communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to view templates" });
    }

    const totalCount = await prisma.goalTemplate.count({
      where: { communityId },
    });

    const templates = await prisma.goalTemplate.findMany({
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
  } catch (error) {
    logger.error("Get templates error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getTemplateById(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params;

    const template = await prisma.goalTemplate.findUnique({
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
  } catch (error) {
    logger.error("Get template by ID error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateTemplate(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params;
    const { goalText, targetDays, reminderTime } = req.body;

    const template = await prisma.goalTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return res.status(404).json({ msg: "Template not found" });
    }

    // Check if user is owner or mod of community, or creator of template
    const isCommunityOwnerOrMod = await isOwnerOrMod(template.communityId, userId);
    const isTemplateCreator = template.createdBy === userId;

    if (!isCommunityOwnerOrMod && !isTemplateCreator) {
      return res.status(403).json({ msg: "Only owners, moderators, or template creator can update templates" });
    }

    const updatedTemplate = await prisma.goalTemplate.update({
      where: { id: templateId },
      data: {
        ...(goalText && { goalText }),
        ...(targetDays && { targetDays }),
        ...(reminderTime !== undefined && { reminderTime: reminderTime || null }),
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
      },
    });

    res.json({
      msg: "Template updated successfully",
      data: {
        ...updatedTemplate,
        createdAt: updatedTemplate.createdAt.toISOString(),
        updatedAt: updatedTemplate.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Update template error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getTemplateParticipants(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "20")) || 20;
    const skip = (page - 1) * limit;

    const template = await prisma.goalTemplate.findUnique({
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
      return res.status(403).json({ msg: "Must be a member to view template participants" });
    }

    // Get goals started from this template with user info and progress
    const [goals, totalCount] = await Promise.all([
      prisma.goal.findMany({
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
      prisma.goal.count({
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
  } catch (error) {
    logger.error("Get template participants error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function deleteTemplate(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params;

    const template = await prisma.goalTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      return res.status(404).json({ msg: "Template not found" });
    }

    // Check if user is owner or mod of community, or creator of template
    const isCommunityOwnerOrMod = await isOwnerOrMod(template.communityId, userId);
    const isTemplateCreator = template.createdBy === userId;

    if (!isCommunityOwnerOrMod && !isTemplateCreator) {
      return res.status(403).json({ msg: "Only owners, moderators, or template creator can delete templates" });
    }

    await prisma.goalTemplate.delete({
      where: { id: templateId },
    });

    res.json({
      msg: "Template deleted successfully",
      data: null,
    });
  } catch (error) {
    logger.error("Delete template error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function startGoalFromTemplate(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params;
    const { reminderTime } = req.body;

    const template = await prisma.goalTemplate.findUnique({
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
      return res.status(403).json({ msg: "Must be a member to start goals from templates" });
    }

    // Create goal from template
    const goal = await prisma.goal.create({
      data: {
        userId,
        goalText: template.goalText,
        targetDays: template.targetDays,
        reminderTime: reminderTime || template.reminderTime || null,
        templateId: template.id,
        communityId: template.communityId,
        startedAt: new Date(),
      },
    });

    res.json({
      msg: "Goal started from template successfully",
      data: {
        id: goal.id,
        goalText: goal.goalText,
        targetDays: goal.targetDays,
        currentDay: goal.currentDay,
        lastCheckInDate: goal.lastCheckInDate?.toISOString() || null,
        startedAt: goal.startedAt.toISOString(),
        reminderTime: goal.reminderTime,
        templateId: goal.templateId,
        communityId: goal.communityId,
        createdAt: goal.createdAt.toISOString(),
        updatedAt: goal.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Start goal from template error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

// ==================== Activity Feed ====================

export async function getActivityFeed(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "20")) || 20;
    const skip = (page - 1) * limit;

    // Check if user is member
    if (!(await isMember(communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to view activity feed" });
    }

    const totalCount = await prisma.communityActivity.count({
      where: { communityId },
    });

    const activities = await prisma.communityActivity.findMany({
      where: { communityId },
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
    const activitiesWithReactions = await Promise.all(
      activities.map(async (activity) => {
        const userReaction = await prisma.activityReaction.findUnique({
          where: {
            activityId_userId: {
              activityId: activity.id,
              userId,
            },
          },
        });

        return {
          ...activity,
          createdAt: activity.createdAt.toISOString(),
          hasUserReacted: !!userReaction,
        };
      })
    );

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
  } catch (error) {
    logger.error("Get activity feed error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function reactToActivity(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { activityId } = req.params;

    // Check if activity exists and user is member of community
    const activity = await prisma.communityActivity.findUnique({
      where: { id: activityId },
      include: {
        community: true,
      },
    });

    if (!activity) {
      return res.status(404).json({ msg: "Activity not found" });
    }

    if (!(await isMember(activity.communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to react to activities" });
    }

    // Check if already reacted
    const existingReaction = await prisma.activityReaction.findUnique({
      where: {
        activityId_userId: {
          activityId,
          userId,
        },
      },
    });

    if (existingReaction) {
      // Remove reaction (toggle off)
      await prisma.activityReaction.delete({
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
    await prisma.activityReaction.create({
      data: {
        activityId,
        userId,
      },
    });

    res.json({
      msg: "Reaction added successfully",
      data: { reacted: true },
    });
  } catch (error) {
    logger.error("React to activity error:", { error, userId: req.userId, activityId: req.params.activityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function createComment(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { activityId } = req.params;
    const { text } = req.body;

    // Check if activity exists and user is member of community
    const activity = await prisma.communityActivity.findUnique({
      where: { id: activityId },
      include: {
        community: true,
      },
    });

    if (!activity) {
      return res.status(404).json({ msg: "Activity not found" });
    }

    if (!(await isMember(activity.communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to comment on activities" });
    }

    const comment = await prisma.activityComment.create({
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

    res.json({
      msg: "Comment created successfully",
      data: {
        ...comment,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Create comment error:", { error, userId: req.userId, activityId: req.params.activityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getComments(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { activityId } = req.params;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "20")) || 20;
    const skip = (page - 1) * limit;

    // Check if activity exists and user is member of community
    const activity = await prisma.communityActivity.findUnique({
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

    const totalCount = await prisma.activityComment.count({
      where: { activityId },
    });

    const comments = await prisma.activityComment.findMany({
      where: { activityId },
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
  } catch (error) {
    logger.error("Get comments error:", { error, userId: req.userId, activityId: req.params.activityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function deleteComment(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { commentId } = req.params;

    const comment = await prisma.activityComment.findUnique({
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
    const isOwnerOrMod = await isOwnerOrMod(comment.activity.communityId, userId);

    if (!isCommentAuthor && !isOwnerOrMod) {
      return res.status(403).json({ msg: "Only comment author, owner, or moderators can delete comments" });
    }

    await prisma.activityComment.delete({
      where: { id: commentId },
    });

    res.json({
      msg: "Comment deleted successfully",
      data: null,
    });
  } catch (error) {
    logger.error("Delete comment error:", { error, userId: req.userId, commentId: req.params.commentId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

// ==================== Stats ====================

export async function getCommunityStats(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params;

    // Check if user is member
    if (!(await isMember(communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to view stats" });
    }

    const [memberCount, templateCount, activeGoalCount, recentActivityCount] = await Promise.all([
      prisma.communityMember.count({
        where: { communityId },
      }),
      prisma.goalTemplate.count({
        where: { communityId },
      }),
      prisma.goal.count({
        where: {
          communityId,
          lastCheckInDate: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
      prisma.communityActivity.count({
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
  } catch (error) {
    logger.error("Get community stats error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

// ==================== My Communities ====================

export async function getMyCommunities(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "10")) || 10;
    const skip = (page - 1) * limit;

    const totalCount = await prisma.communityMember.count({
      where: { userId },
    });

    const memberships = await prisma.communityMember.findMany({
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
  } catch (error) {
    logger.error("Get my communities error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
