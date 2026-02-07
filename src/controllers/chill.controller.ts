import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { chillService } from "../services/chill.service";
import logger from "../utils/logger.util";

/**
 * Create a chill session and get AI suggestions
 */
export async function createChillSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { emotion } = req.body;

    if (!emotion || typeof emotion !== "string" || emotion.trim().length === 0) {
      return res.status(400).json({ msg: "Emotion text is required" });
    }

    const result = await chillService.createSession(userId, emotion.trim());

    res.json({
      msg: "Chill session created successfully",
      data: {
        sessionId: result.sessionId,
        suggestedTimes: result.suggestions.suggestedTimes,
      },
    });
  } catch (error) {
    logger.error("Create chill session error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Update session duration when user selects a time
 */
export async function updateSessionDuration(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params.sessionId);
    const { duration } = req.body;

    if (!duration || typeof duration !== "number" || duration <= 0) {
      return res.status(400).json({ msg: "Valid duration is required" });
    }

    await chillService.updateSessionDuration(sessionId, userId, duration);

    res.json({
      msg: "Session duration updated",
    });
  } catch (error) {
    logger.error("Update session duration error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Mark a chill session as completed
 */
export async function completeChillSession(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const sessionId = String(req.params.sessionId);
    const { postSessionMood } = req.body;

    await chillService.completeSession(sessionId, userId, postSessionMood);

    res.json({
      msg: "Chill session completed successfully",
    });
  } catch (error) {
    logger.error("Complete chill session error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get user's chill session history
 */
export async function getChillSessions(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const limit = parseInt(String(limitParam || "20")) || 20;

    const sessions = await chillService.getUserSessions(userId, limit);

    res.json({
      msg: "Chill sessions retrieved successfully",
      data: sessions,
    });
  } catch (error) {
    logger.error("Get chill sessions error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get user's chill session stats
 */
export async function getChillStats(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const stats = await chillService.getUserStats(userId);

    res.json({
      msg: "Chill stats retrieved successfully",
      data: stats,
    });
  } catch (error) {
    logger.error("Get chill stats error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get AI-generated summary only (cached for 24 hours)
 */
export async function getEmotionSummary(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const result = await chillService.getEmotionSummary(userId);

    res.json({
      msg: "Emotion summary retrieved successfully",
      data: result,
    });
  } catch (error) {
    logger.error("Get emotion summary error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get paginated sessions
 */
export async function getPaginatedSessions(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    
    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "10")) || 10;

    const result = await chillService.getPaginatedSessions(userId, page, limit);

    res.json({
      msg: "Sessions retrieved successfully",
      data: result,
    });
  } catch (error) {
    logger.error("Get paginated sessions error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
