import { prisma } from "../config/db.config";
import { geminiService, type ChillResponse } from "./gemini.service";
import logger from "../utils/logger.util";

class ChillService {
  /**
   * Create a chill session and get AI suggestions
   */
  async createSession(
    userId: string,
    emotion: string
  ): Promise<{ sessionId: string; suggestions: ChillResponse }> {
    try {
      // Get AI suggestions
      const suggestions = await geminiService.generateChillSuggestions(emotion);

      // Create session record
      const session = await prisma.chillSession.create({
        data: {
          userId,
          emotion,
          duration: 0, // Will be updated when user selects
          completed: false,
        },
      });

      logger.info("Chill session created:", { sessionId: session.id, userId });

      return {
        sessionId: session.id,
        suggestions,
      };
    } catch (error) {
      logger.error("Error creating chill session:", error);
      throw error;
    }
  }

  /**
   * Update session duration when user selects a time
   */
  async updateSessionDuration(sessionId: string, userId: string, duration: number) {
    return prisma.chillSession.updateMany({
      where: {
        id: sessionId,
        userId, // Ensure user owns this session
      },
      data: {
        duration,
      },
    });
  }

  /**
   * Mark session as completed and update user mood
   */
  async completeSession(sessionId: string, userId: string, postSessionMood?: string) {
    const updateResult = await prisma.chillSession.updateMany({
      where: {
        id: sessionId,
        userId, // Ensure user owns this session
        completed: false, // Only complete if not already completed
      },
      data: {
        completed: true,
        completedAt: new Date(),
        postSessionMood: postSessionMood || null,
      },
    });

    // Update user's current mood based on completed sessions
    if (updateResult.count > 0 && postSessionMood) {
      await this.updateUserMood(userId);
    }

    return updateResult;
  }

  /**
   * Update user's current mood based on recent completed sessions
   * Uses weighted average: more recent sessions have more weight
   */
  private async updateUserMood(userId: string) {
    try {
      const recentSessions = await prisma.chillSession.findMany({
        where: {
          userId,
          completed: true,
          postSessionMood: { not: null },
        },
        orderBy: { completedAt: "desc" },
        take: 10, // Last 10 completed sessions
      });

      if (recentSessions.length === 0) return;

      // Get the most recent post-session mood (simple approach)
      // Could be enhanced with weighted average or sentiment analysis
      const latestMood = recentSessions[0].postSessionMood;
      
      if (latestMood) {
        await prisma.user.update({
          where: { id: userId },
          data: { currentMood: latestMood },
        });
        
        logger.info("User mood updated from chill session", { userId, mood: latestMood });
      }
    } catch (error) {
      logger.error("Error updating user mood:", error);
      // Don't throw - mood update is not critical
    }
  }

  /**
   * Get user's chill session history
   */
  async getUserSessions(userId: string, limit: number = 50) {
    return prisma.chillSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Get AI-generated summary only (cached for 24 hours)
   */
  async getEmotionSummary(userId: string) {
    // Check if we need to generate a new summary (only every 24 hours)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        lastEmotionSummaryAt: true,
        emotionSummary: true,
      },
    });

    const now = new Date();
    const lastSummaryAt = user?.lastEmotionSummaryAt;
    const cachedSummary = user?.emotionSummary;
    
    // Check if summary is still valid (less than 24 hours old)
    const isSummaryValid = lastSummaryAt && 
      (now.getTime() - lastSummaryAt.getTime()) < 24 * 60 * 60 * 1000; // 24 hours

    // If we have a valid cached summary, return it without calling Gemini
    if (isSummaryValid && cachedSummary) {
      logger.info("Returning cached emotion summary", { userId });
      return {
        summary: cachedSummary,
        summaryGenerated: false,
      };
    }

    // Need to generate new summary - get sessions for context
    const sessions = await this.getUserSessions(userId, 100);
    const completedSessions = sessions.filter((s) => s.completed);

    let summary: string;
    let summaryGenerated = false;

    if (completedSessions.length > 0) {
      // Generate new AI summary
      summary = await geminiService.generateEmotionSummary(
        completedSessions.map((s) => ({
          emotion: s.emotion,
          postMood: s.postSessionMood,
          date: s.completedAt || s.createdAt,
        }))
      );

      // Store summary and update timestamp
      await prisma.user.update({
        where: { id: userId },
        data: {
          emotionSummary: summary,
          lastEmotionSummaryAt: now,
        },
      });

      summaryGenerated = true;
      logger.info("New emotion summary generated and cached", { userId });
    } else {
      // No sessions yet - return fallback message
      summary = "You haven't completed any chill sessions yet. Start your first session to see insights about your emotional journey.";
      
      // Don't cache the fallback message
    }

    return {
      summary,
      summaryGenerated,
    };
  }

  /**
   * Get paginated sessions
   */
  async getPaginatedSessions(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    
    const [sessions, total] = await Promise.all([
      prisma.chillSession.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.chillSession.count({
        where: { userId },
      }),
    ]);

    return {
      sessions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + sessions.length < total,
      },
    };
  }

  /**
   * Get session stats for user
   */
  async getUserStats(userId: string) {
    const sessions = await prisma.chillSession.findMany({
      where: { userId },
    });

    const completedSessions = sessions.filter((s) => s.completed);
    const totalMinutes = completedSessions.reduce((sum, s) => sum + s.duration, 0);

    return {
      totalSessions: sessions.length,
      completedSessions: completedSessions.length,
      totalMinutes,
      averageDuration:
        completedSessions.length > 0
          ? Math.round(totalMinutes / completedSessions.length)
          : 0,
    };
  }
}

export const chillService = new ChillService();
