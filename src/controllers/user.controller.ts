import { Response } from "express";
import { prisma } from "../config/db.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";
import { formatUserResponse } from "./auth.controller";

export async function updateProfile(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { firstName, lastName, username, profileImageId } = req.body;

    const updateData: any = {};

    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (username !== undefined) updateData.username = username;
    if (profileImageId !== undefined) {
      // If you have an image storage system, map profileImageId to avatarUrl
      // For now, we'll just store it as avatarUrl
      updateData.avatarUrl = profileImageId;
    }

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
