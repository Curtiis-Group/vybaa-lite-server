import { Request, Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import { sanitizeUsername, validateUsername } from "../utils/username.util";
import logger from "../utils/logger.util";

/**
 * Check if a username is available (not taken by another user)
 */
export async function checkUsernameExists(req: Request, res: Response) {
  try {
    const { username } = req.query;

    if (!username || typeof username !== 'string') {
      return res.status(400).json({ msg: "Username parameter required" });
    }

    // Sanitize and force lowercase
    const sanitized = sanitizeUsername(username);

    // Validate format
    const validation = validateUsername(sanitized);
    if (!validation.valid) {
      return res.json({
        msg: "Username validation",
        data: {
          available: false,
          reason: validation.error,
          exists: false,
        },
      });
    }

    // Check if username exists
    const existingUser = await prisma.user.findUnique({
      where: { username: sanitized },
      select: { id: true },
    });

    res.json({
      msg: "Username availability checked",
      data: {
        available: !existingUser,
        exists: !!existingUser,
        username: sanitized,
      },
    });
  } catch (error) {
    logger.error("Check username exists error:", { error, username: req.query.username });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Check if authenticated user can change their username
 */
export async function checkUsernameChangeAvailability(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { username } = req.query;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true, lastUsernameChangeAt: true },
    });

    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }

    // If checking availability of a specific username
    if (username && typeof username === 'string') {
      // Sanitize and force lowercase
      const sanitized = sanitizeUsername(username);

      // Check if it's their current username
      if (sanitized === user.username) {
        return res.json({
          msg: "This is your current username",
          data: {
            available: false,
            reason: "This is already your username",
            isCurrentUsername: true,
          },
        });
      }

      // Validate format
      const validation = validateUsername(sanitized);
      if (!validation.valid) {
        return res.json({
          msg: "Username validation",
          data: {
            available: false,
            reason: validation.error,
          },
        });
      }

      // Check if taken
      const existingUser = await prisma.user.findUnique({
        where: { username: sanitized },
        select: { id: true },
      });

      return res.json({
        msg: "Username availability checked",
        data: {
          available: !existingUser,
          exists: !!existingUser,
          username: sanitized,
        },
      });
    }

    // Just return cooldown status
    res.json({
      msg: "Username change availability",
      data: {
        currentUsername: user.username,
        lastChangeDate: user.lastUsernameChangeAt?.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Check username change availability error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
