import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { achievementService } from "../services/achievement.service";
import { getAllBadgeDefinitions } from "../config/badges.config";
import logger from "../utils/logger.util";

/**
 * Get all achievements for the authenticated user
 */
export async function getAchievements(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const achievements = await achievementService.getUserAchievements(userId);

    res.json({
      msg: "Achievements retrieved successfully",
      data: achievements,
    });
  } catch (error) {
    logger.error("Get achievements error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get achievement stats for the authenticated user
 */
export async function getAchievementStats(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const stats = await achievementService.getUserAchievementStats(userId);

    res.json({
      msg: "Achievement stats retrieved successfully",
      data: stats,
    });
  } catch (error) {
    logger.error("Get achievement stats error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get all possible badge definitions (for showing locked badges)
 */
export async function getBadgeDefinitions(req: AuthRequest, res: Response) {
  try {
    const allBadges = getAllBadgeDefinitions();

    res.json({
      msg: "Badge definitions retrieved successfully",
      data: allBadges,
    });
  } catch (error) {
    logger.error("Get badge definitions error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
