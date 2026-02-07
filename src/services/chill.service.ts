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
   * Mark session as completed
   */
  async completeSession(sessionId: string, userId: string) {
    return prisma.chillSession.updateMany({
      where: {
        id: sessionId,
        userId, // Ensure user owns this session
        completed: false, // Only complete if not already completed
      },
      data: {
        completed: true,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Get user's chill session history
   */
  async getUserSessions(userId: string, limit: number = 20) {
    return prisma.chillSession.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
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
