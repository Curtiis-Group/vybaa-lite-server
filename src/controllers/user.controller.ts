import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";
import { canChangeUsername, sanitizeUsername, validateUsername } from "../utils/username.util";
import { formatUserResponse } from "./auth.controller";

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { firstName, lastName, username, profileImageId, currentMood, lifeGoal, rewindPersona } = req.body;

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
        const cooldownCheck = canChangeUsername(currentUser.lastUsernameChangeAt);
        if (!cooldownCheck.canChange) {
          return res.status(400).json({ 
            msg: `You can change your username again in ${cooldownCheck.daysRemaining} day(s)`,
            data: {
              canChange: false,
              daysRemaining: cooldownCheck.daysRemaining,
              nextAvailableDate: cooldownCheck.nextAvailableDate.toISOString(),
            }
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
    if (currentMood !== undefined) updateData.currentMood = currentMood;
    if (lifeGoal !== undefined) updateData.lifeGoal = lifeGoal;
    if (rewindPersona !== undefined) updateData.rewindPersona = rewindPersona;

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

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

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Add token if it doesn't exist
    const tokens = user.fcmTokens || [];
    if (!tokens.includes(fcmToken)) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          fcmTokens: [...tokens, fcmToken],
        },
      });
      logger.info("FCM token registered", { userId, token: fcmToken.substring(0, 20) + "..." });
    } else {
      logger.debug("FCM token already registered", { userId });
    }

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

    // Get current user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmTokens: true },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // Remove token
    const tokens = user.fcmTokens || [];
    const updatedTokens = tokens.filter((t) => t !== fcmToken);

    await prisma.user.update({
      where: { id: userId },
      data: {
        fcmTokens: updatedTokens,
      },
    });

    logger.info("FCM token removed", { userId, token: fcmToken.substring(0, 20) + "..." });

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
export async function checkUsernameAvailability(req: AuthRequest, res: Response) {
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
    logger.error("Check username availability error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
