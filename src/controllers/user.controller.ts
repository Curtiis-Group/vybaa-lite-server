import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import { toPrismaClientApp } from "../types/client-app.type";
import logger from "../utils/logger.util";
import {
  canChangeUsername,
  sanitizeUsername,
  validateUsername,
} from "../utils/username.util";
import {
  isValidRewindTimezone,
  refreshFutureRewindOccurrences,
} from "../services/rewind-routine.service";
import { refreshGoalV2RemindersForUser } from "../services/goal-v2-reminder.service";
import { formatUserResponse } from "./auth.controller";

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const {
      firstName,
      lastName,
      username,
      profileImageId,
      rewindPersona,
      rewindPersonalizationEnabled,
      rewindProactiveChatEnabled,
      rewindProactiveChatExplainedAt,
      timezone,
    } = req.body;

    const updateData: any = {};

    // Handle username change with 7-day cooldown
    if (username !== undefined) {
      // Get current user to check last username change
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, lastUsernameChangeAt: true },
      });

      if (!currentUser) {
        return res.status(404).json({ msg: "User not found" });
      }

      // Check if username is actually changing
      if (username !== currentUser.username) {
        // Sanitize and force lowercase
        const sanitizedUsername = sanitizeUsername(username);

        // Validate username format
        const validation = validateUsername(sanitizedUsername);
        if (!validation.valid) {
          return res.status(400).json({ msg: validation.error });
        }

        // Check 7-day cooldown
        const cooldownCheck = canChangeUsername(
          currentUser.lastUsernameChangeAt,
        );
        if (!cooldownCheck.canChange) {
          return res.status(400).json({
            msg: `You can change your username again in ${cooldownCheck.daysRemaining} day(s)`,
            data: {
              canChange: false,
              daysRemaining: cooldownCheck.daysRemaining,
              nextAvailableDate: cooldownCheck.nextAvailableDate.toISOString(),
            },
          });
        }

        // Username is valid and cooldown passed
        updateData.username = sanitizedUsername;
        updateData.lastUsernameChangeAt = new Date();
      }
    }

    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (profileImageId !== undefined) {
      // If you have an image storage system, map profileImageId to avatarUrl
      // For now, we'll just store it as avatarUrl
      updateData.avatarUrl = profileImageId;
    }
    if (rewindPersona !== undefined) updateData.rewindPersona = rewindPersona;
    if (rewindPersonalizationEnabled !== undefined) {
      updateData.rewindPersonalizationEnabled = rewindPersonalizationEnabled;
    }
    if (rewindProactiveChatEnabled !== undefined) {
      updateData.rewindProactiveChatEnabled = rewindProactiveChatEnabled;
    }
    if (rewindProactiveChatExplainedAt !== undefined) {
      updateData.rewindProactiveChatExplainedAt = rewindProactiveChatExplainedAt
        ? new Date(rewindProactiveChatExplainedAt)
        : null;
    }
    if (timezone !== undefined) {
      if (typeof timezone !== "string" || !isValidRewindTimezone(timezone)) {
        return res
          .status(400)
          .json({ msg: "A valid IANA timezone is required" });
      }
      updateData.timezone = timezone;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    if (timezone !== undefined || rewindPersona !== undefined) {
      await refreshFutureRewindOccurrences({ userId });
    }
    if (timezone !== undefined) {
      await refreshGoalV2RemindersForUser(userId);
    }

    res.json({
      msg: "Profile updated successfully",
      data: formatUserResponse(user),
    });
  } catch (error: any) {
    logger.error("Update profile error:", { error, userId: req.userId });
    if (error.code === "P2002") {
      return res.status(400).json({ msg: "Username already taken" });
    }
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getProfile(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      msg: "User retrieved",
      data: formatUserResponse(user),
    });
  } catch (error) {
    logger.error("Get user error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function deleteAccount(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({
        where: {
          OR: [{ senderId: userId }, { recipientId: userId }],
        },
      });

      await tx.goal.updateMany({
        where: {
          template: { createdBy: userId },
        },
        data: { templateId: null },
      });

      await tx.goalTemplate.deleteMany({
        where: { createdBy: userId },
      });

      await tx.goal.deleteMany({
        where: { userId },
      });

      await tx.user.delete({
        where: { id: userId },
      });
    });

    logger.info("Account deleted", { userId });
    res.json({ msg: "Account deleted successfully" });
  } catch (error) {
    logger.error("Delete account error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

export async function getPublicProfile(req: AuthRequest, res: Response) {
  try {
    const rawUsername = Array.isArray(req.params.username)
      ? req.params.username[0]
      : req.params.username;
    const username = sanitizeUsername(rawUsername);

    if (!username) {
      return res.status(400).json({ msg: "Valid username is required" });
    }

    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        currentMood: true,
        createdAt: true,
        points: true,
        _count: {
          select: {
            achievements: true,
            communityMemberships: true,
            goals: true,
            journals: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    res.json({
      msg: "Public profile retrieved",
      data: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        currentMood: user.currentMood,
        joinedAt: user.createdAt.toISOString(),
        playPoints: Math.round(user.points ?? 0),
        stats: {
          achievementCount: user._count.achievements,
          communityCount: user._count.communityMemberships,
          goalCount: user._count.goals,
          journalCount: user._count.journals,
        },
      },
    });
  } catch (error) {
    logger.error("Get public profile error:", {
      error,
      username: req.params.username,
      viewerId: req.userId,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Register or update FCM token for push notifications
 */
export async function registerFCMToken(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(400).json({ msg: "Valid FCM token is required" });
    }

    const clientApp = toPrismaClientApp(req.clientApp);
    await prisma.fcmDevice.upsert({
      where: { clientApp_token: { clientApp, token: fcmToken } },
      create: { clientApp, token: fcmToken, userId },
      update: { userId },
    });
    logger.info("FCM token registered", {
      clientApp: req.clientApp,
      userId,
    });

    res.json({
      msg: "FCM token registered successfully",
    });
  } catch (error) {
    logger.error("Register FCM token error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Remove FCM token (e.g., on logout)
 */
export async function removeFCMToken(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== "string") {
      return res.status(400).json({ msg: "Valid FCM token is required" });
    }

    const clientApp = toPrismaClientApp(req.clientApp);
    await prisma.fcmDevice.deleteMany({
      where: { clientApp, token: fcmToken, userId },
    });
    if (req.clientApp === "vybaa") {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { fcmTokens: true },
      });
      if (user) {
        await prisma.user.update({
          where: { id: userId },
          data: {
            fcmTokens: user.fcmTokens.filter((token) => token !== fcmToken),
          },
        });
      }
    }

    logger.info("FCM token removed", {
      clientApp: req.clientApp,
      userId,
    });

    res.json({
      msg: "FCM token removed successfully",
    });
  } catch (error) {
    logger.error("Remove FCM token error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Check if user can change username (7-day cooldown check)
 */
export async function checkUsernameAvailability(
  req: AuthRequest,
  res: Response,
) {
  try {
    const userId = req.userId;

    // Allow unauthenticated usage (e.g. signup flow) by returning defaults
    if (!userId) {
      return res.json({
        msg: "Username change availability checked",
        data: {
          canChange: true,
          daysRemaining: 0,
          nextAvailableDate: new Date().toISOString(),
        },
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastUsernameChangeAt: true, username: true },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    const cooldownCheck = canChangeUsername(user.lastUsernameChangeAt);

    res.json({
      msg: "Username change availability checked",
      data: {
        canChange: cooldownCheck.canChange,
        daysRemaining: cooldownCheck.daysRemaining,
        nextAvailableDate: cooldownCheck.nextAvailableDate.toISOString(),
        currentUsername: user.username,
      },
    });
  } catch (error) {
    logger.error("Check username availability error:", {
      error,
      userId: req.userId,
    });
    res.status(500).json({ msg: "Internal server error" });
  }
}
