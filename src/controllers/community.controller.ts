import { CommunityMemberRole } from "@prisma/client";
import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import { communityActivityService } from "../services/community-activity.service";
import { emailService } from "../services/email.service";
import { notificationService } from "../services/notification.service";
import logger from "../utils/logger.util";

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

// Communities are invite-only: this now returns only the communities the user has joined
export async function getCommunities(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "10")) || 10;
    const skip = (page - 1) * limit;

    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        msg: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    // Only return communities this user is a member of
    const totalCount = await prisma.communityMember.count({ where: { userId } });

    const memberships = await prisma.communityMember.findMany({
      where: { userId },
      orderBy: { joinedAt: "desc" },
      skip,
      take: limit,
      include: {
        community: {
          include: {
            owner: {
              select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
            },
            _count: {
              select: { members: true, templates: true, goals: true },
            },
          },
        },
      },
    });

    const communities = memberships.map((m) => ({
      ...m.community,
      createdAt: m.community.createdAt.toISOString(),
      updatedAt: m.community.updatedAt.toISOString(),
      isMember: true,
      userRole: m.role,
      joinedAt: m.joinedAt.toISOString(),
    }));

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
  } catch (error) {
    logger.error("Get communities error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getCommunityById(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params as { communityId: string};

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
    const { communityId } = req.params as { communityId: string};
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
    const { communityId } = req.params as { communityId: string};

    // Check if user is owner
    if (!(await isOwner(communityId, userId))) {
      return res.status(403).json({ msg: "Only the owner can delete the community" });
    }

    // Get community info before deleting
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { name: true },
    });

    await prisma.community.delete({
      where: { id: communityId },
    });

    // Notify all members about community deletion
    if (community) {
      notificationService.sendCommunityDeletedNotification(
        communityId,
        community.name
      ).catch((err) => logger.error("Error sending community deleted notification:", err));
    }

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

    // Notify owner and mods about new member
    const memberName = member.user.username || member.user.firstName || "Someone";
    notificationService.sendMemberJoinedNotification(
      communityId,
      userId,
      memberName,
      community.name
    ).catch((err) => logger.error("Error sending member joined notification:", err));

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
    const { communityId } = req.params as { communityId: string};

    // Check if user is owner
    if (await isOwner(communityId, userId)) {
      return res.status(400).json({ msg: "Owner cannot leave the community. Transfer ownership or delete the community instead." });
    }

    // Get user info before deleting
    const leavingMember = await prisma.communityMember.findUnique({
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

    await prisma.communityMember.delete({
      where: {
        communityId_userId: {
          communityId,
          userId,
        },
      },
    });

    // Create activity entry for leaving the community
    await communityActivityService.createMemberLeftActivity(communityId, userId);

    // Notify owner and mods about member leaving
    if (leavingMember) {
      const memberName = leavingMember.user.username || leavingMember.user.firstName || "Someone";
      notificationService.sendMemberLeftNotification(
        communityId,
        userId,
        memberName,
        leavingMember.community.name
      ).catch((err) => logger.error("Error sending member left notification:", err));
    }

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
    const { communityId } = req.params  as { communityId: string};
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
  } catch (error) {
    logger.error("Get community members error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateMemberRole(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId: $communityId } = req.params;
    const communityId = String($communityId)
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
        community: {
          select: {
            name: true,
          },
        },
      },
    });

    // Notify user whose role was changed
    const changer = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, firstName: true },
    });
    const changerName = changer?.username || changer?.firstName || "Admin";
    notificationService.sendRoleChangedNotification(
      targetUserId,
      role,
      member.community.name,
      changerName
    ).catch((err) => logger.error("Error sending role changed notification:", err));

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
   const { communityId } = req.params  as { communityId: string};
    const { goalText, targetDays, reminderTime, milestones } = req.body;

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
        milestones:
          milestones && milestones.length > 0
            ? {
                create: milestones.map((m: any, index: number) => ({
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
    await communityActivityService.createTemplateCreatedActivity(template.id, userId, communityId);

    // Notify all members about new template
    const creatorName = template.creator.username || template.creator.firstName || "Someone";
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      select: { name: true },
    });
    if (community) {
      notificationService.sendTemplateCreatedNotification(
        communityId,
        template.id,
        template.goalText || "",
        creatorName,
        community.name,
        userId
      ).catch((err) => logger.error("Error sending template created notification:", err));
    }

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
   const { communityId } = req.params  as { communityId: string};
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
  } catch (error) {
    logger.error("Get templates error:", { error, userId: req.userId, communityId: req.params.communityId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getTemplateById(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params   as { templateId: string};

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
  } catch (error) {
    logger.error("Get template by ID error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function updateTemplate(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params   as { templateId: string};
    const { goalText, targetDays, reminderTime, milestones } = req.body;

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

    const updatedTemplate = await prisma.$transaction(async (tx) => {
      const updated = await tx.goalTemplate.update({
        where: { id: templateId },
        data: {
          ...(goalText && { goalText }),
          ...(typeof targetDays === "number" && { targetDays }),
          ...(reminderTime !== undefined && { reminderTime: reminderTime || null }),
        },
      });

      if (Array.isArray(milestones)) {
        const incomingIds = milestones.filter((m: any) => !!m.id).map((m: any) => m.id as string);

        // If there are no incoming milestones, delete all existing milestones
        if (milestones.length === 0) {
          await tx.templateMilestone.deleteMany({
            where: { templateId },
          });
        } else {
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
          } else {
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
            } else {
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
  } catch (error) {
    logger.error("Update template error:", { error, userId: req.userId, templateId: req.params.templateId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getTemplateParticipants(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { templateId } = req.params   as { templateId: string};
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
    const { templateId } = req.params   as { templateId: string};

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

    // Get template and community info before deleting
    const templateWithCommunity = await prisma.goalTemplate.findUnique({
      where: { id: templateId },
      include: {
        community: {
          select: {
            name: true,
          },
        },
      },
    });

    await prisma.goalTemplate.delete({
      where: { id: templateId },
    });

    // Notify users who started goals from this template
    if (templateWithCommunity) {
      notificationService.sendTemplateDeletedNotification(
        templateId,
        templateWithCommunity.goalText || "",
        templateWithCommunity.community.name
      ).catch((err) => logger.error("Error sending template deleted notification:", err));
    }

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
    const { templateId } = req.params   as { templateId: string};
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

    // Get user info for notification
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, firstName: true },
    });

    // Create goal from template
    const goal = await prisma.goal.create({
      data: {
        userId,
        goalText: template?.goalText!,
        targetDays: template.targetDays,
        reminderTime: reminderTime || template.reminderTime || null,
        templateId: template.id,
        communityId: template.communityId,
        startedAt: new Date(),
      },
    });

    // Notify template creator (if not the same user)
    if (template.createdBy !== userId) {
      const starterName = user?.username || user?.firstName || "Someone";
      notificationService.sendGoalStartedFromTemplateNotification(
        template.createdBy,
        starterName,
        template.goalText || "",
        template.community.name,
        goal.id
      ).catch((err) => logger.error("Error sending goal started notification:", err));
    }

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
   const { communityId } = req.params  as { communityId: string};
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

        const createdAtDate = activity.createdAt;
        const hourBucket = new Date(
          Date.UTC(
            createdAtDate.getUTCFullYear(),
            createdAtDate.getUTCMonth(),
            createdAtDate.getUTCDate(),
            createdAtDate.getUTCHours(),
            0,
            0,
            0
          )
        ).toISOString();

        return {
          ...activity,
          createdAt: activity.createdAt.toISOString(),
          hasUserReacted: !!userReaction,
          hourBucket,
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
    const { activityId } = req.params   as { activityId: string};

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

    // Notify activity owner (if not the same user)
    if (activity.userId !== userId) {
      const reactor = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, firstName: true },
      });
      const reactorName = reactor?.username || reactor?.firstName || "Someone";
      notificationService.sendActivityReactionNotification(
        activity.userId,
        reactorName,
        activity.type,
        activity.community.name,
        activityId
      ).catch((err) => logger.error("Error sending reaction notification:", err));
    }

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
    const { activityId } = req.params   as { activityId: string};
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

    // Notify activity owner (if not the same user)
    if (activity.userId !== userId) {
      const commenterName = comment.user.username || comment.user.firstName || "Someone";
      notificationService.sendActivityCommentNotification(
        activity.userId,
        commenterName,
        text,
        activity.community.name,
        activityId
      ).catch((err) => logger.error("Error sending comment notification:", err));
    }

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
    const { activityId } = req.params   as { activityId: string};
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
    const { commentId } = req.params   as { commentId: string};

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
    const isOwnerOrModd = await isOwnerOrMod((comment as any)?.activity?.communityId, userId);

    if (!isCommentAuthor && !isOwnerOrModd) {
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
   const { communityId } = req.params  as { communityId: string};

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

// ==================== Invite System ====================

/** Generate a short, unique, uppercase invite code */
async function generateInviteCode(): Promise<string> {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O, 0, I, 1 to avoid confusion
  let code: string;
  let exists = true;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    const existing = await prisma.communityInvite.findUnique({ where: { code } });
    exists = !!existing;
  } while (exists);
  return code;
}

function buildCommunityInviteLink(code: string): string {
  return `https://vybaa.app/invite/${code}`;
}

async function findActiveDuplicateInvite(params: {
  communityId: string;
  inviteeUsername?: string;
  inviteeEmail?: string;
}) {
  const now = new Date();

  if (!params.inviteeUsername && !params.inviteeEmail) {
    return null;
  }

  const invites = await prisma.communityInvite.findMany({
    where: {
      communityId: params.communityId,
      ...(params.inviteeUsername ? { inviteeUsername: params.inviteeUsername } : {}),
      ...(params.inviteeEmail ? { inviteeEmail: params.inviteeEmail } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "desc" },
  });

  return invites.find((invite) => invite.maxUses === -1 || invite.uses < invite.maxUses) || null;
}

/** POST /communities/:communityId/invites - Create invite link/code or invite by username/email */
export async function createInvite(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { communityId } = req.params  as { communityId: string};
    const { inviteeUsername, inviteeEmail, maxUses, expiresInDays } = req.body;
    const normalizedUsername = inviteeUsername
      ? String(inviteeUsername).trim().replace(/^@/, "")
      : undefined;
    const normalizedEmail = inviteeEmail
      ? String(inviteeEmail).trim().toLowerCase()
      : undefined;

    // Must be member (or owner/mod) to create invite
    if (!(await isMember(communityId, userId))) {
      return res.status(403).json({ msg: "Must be a member to create invites" });
    }

    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: { owner: { select: { username: true, firstName: true } } },
    });
    if (!community) return res.status(404).json({ msg: "Community not found" });

    const inviter = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, firstName: true, lastName: true },
    });

    let inviteeUserId: string | undefined;
    if (normalizedUsername) {
      const target = await prisma.user.findFirst({
        where: { username: { equals: normalizedUsername, mode: "insensitive" } },
        select: { id: true, username: true },
      });
      if (!target) return res.status(404).json({ msg: `User @${normalizedUsername} not found` });
      if (await isMember(communityId, target.id)) {
        return res.status(400).json({ msg: `@${target.username || normalizedUsername} is already a member` });
      }
      inviteeUserId = target.id;
    }

    if (normalizedEmail) {
      const target = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true },
      });

      if (target && await isMember(communityId, target.id)) {
        return res.status(400).json({ msg: `${normalizedEmail} is already a member` });
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

    const invite = await prisma.communityInvite.create({
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
    const inviterName =
      inviter?.username ||
      [inviter?.firstName, inviter?.lastName].filter(Boolean).join(" ") ||
      "Someone";

    if (inviteeUserId) {
      notificationService.createNotification({
        userId: inviteeUserId,
        type: "system" as any,
        title: `${inviterName} invited you`,
        message: `${inviterName} invited you to join ${community.name}.`,
        data: { communityId, communityName: community.name, code, link, type: "community_invite" },
      }).catch((err) => logger.error("Error sending invite notification:", err));
    }

    if (normalizedEmail) {
      emailService.sendCommunityInviteEmail({
        to: normalizedEmail,
        communityName: community.name,
        inviteCode: invite.code,
        inviteLink: link,
        inviterName,
      }).catch((err) => logger.error("Error sending community invite email:", err));
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
  } catch (error) {
    logger.error("Create invite error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/** GET /communities/invites/:code - Get invite details (public preview) */
export async function getInviteByCode(req: AuthRequest, res: Response) {
  try {
    const { code } = req.params as any;

    const invite = await prisma.communityInvite.findUnique({
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
          select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true },
        },
      },
    });

    if (!invite) return res.status(404).json({ msg: "Invite not found or expired" });

    // Check expiry
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(410).json({ msg: "This invite has expired" });
    }

    // Check max uses
    if (invite.maxUses !== -1 && invite.uses >= invite.maxUses) {
      return res.status(410).json({ msg: "This invite has reached its maximum uses" });
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
  } catch (error) {
    logger.error("Get invite error:", { error, code: req.params.code });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/** POST /communities/invites/:code/join - Join community via invite code */
export async function joinByInviteCode(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { code } = req.params as any;

    const invite = await prisma.communityInvite.findUnique({
      where: { code: code!?.toUpperCase() },
      include: {
        community: { select: { id: true, name: true, _count: { select: { members: true } } } },
      },
    });

    if (!invite) return res.status(404).json({ msg: "Invite not found" });

    // Check expiry
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(410).json({ msg: "This invite has expired" });
    }

    // Check max uses
    if (invite.maxUses !== -1 && invite.uses >= invite.maxUses) {
      return res.status(410).json({ msg: "This invite has reached its maximum uses" });
    }

    const communityId = invite.communityId;

    // Already a member?
    if (await isMember(communityId, userId)) {
      return res.status(400).json({ msg: "You are already a member of this community" });
    }

    // If targeted invite, check it's for this user
    if (invite.inviteeUserId && invite.inviteeUserId !== userId) {
      return res.status(403).json({ msg: "This invite is for a different user" });
    }

    if (invite.inviteeEmail) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      if (user?.email.toLowerCase() !== invite.inviteeEmail.toLowerCase()) {
        return res.status(403).json({ msg: "This invite is for a different email address" });
      }
    }

    // Add member
    const [member] = await prisma.$transaction([
      prisma.communityMember.create({
        data: { communityId, userId, role: "MEMBER" },
      }),
      prisma.communityInvite.update({
        where: { id: invite.id },
        data: { uses: { increment: 1 } },
      }),
    ]);

    // Get user for notifications
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, firstName: true, lastName: true },
    });

    const displayName =
      user?.username ||
      [user?.firstName, user?.lastName].filter(Boolean).join(" ") ||
      "Someone";

    // Notify community owner/mods
    await notificationService.sendMemberJoinedNotification(
      communityId,
      userId,
      displayName,
      invite.community.name
    );

    // Fetch the community with full info to return
    const community = await prisma.community.findUnique({
      where: { id: communityId },
      include: {
        owner: { select: { id: true, username: true, firstName: true, lastName: true, avatarUrl: true } },
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
  } catch (error) {
    logger.error("Join by code error:", { error, userId: req.userId, code: req.params.code });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/** GET /communities/:communityId/invites - List invites for a community (owner/mod only) */
export async function getCommunityInvites(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
   const { communityId } = req.params  as { communityId: string};

    if (!(await isOwnerOrMod(communityId, userId))) {
      return res.status(403).json({ msg: "Only owners and moderators can view invites" });
    }

    const invites = await prisma.communityInvite.findMany({
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
  } catch (error) {
    logger.error("Get invites error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/** DELETE /communities/invites/:inviteId - Revoke an invite */
export async function revokeInvite(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { inviteId } = req.params as any;

    const invite = await prisma.communityInvite.findUnique({ where: { id: inviteId } });
    if (!invite) return res.status(404).json({ msg: "Invite not found" });

    if (!(await isOwnerOrMod(invite.communityId, userId)) && invite.createdBy !== userId) {
      return res.status(403).json({ msg: "Not authorized to revoke this invite" });
    }

    await prisma.communityInvite.delete({ where: { id: inviteId } });
    res.json({ msg: "Invite revoked" });
  } catch (error) {
    logger.error("Revoke invite error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
