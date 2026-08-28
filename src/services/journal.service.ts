import { prisma } from "../config/db.config";
import { geminiService } from "./gemini.service";
import logger from "../utils/logger.util";

class JournalService {
  /**
   * Get or create today's journal entry for a user
   */
  async getOrCreateTodayEntry(userId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of day

    let journal = await prisma.journal.findFirst({
      where: {
        userId,
        date: today,
      },
    });

    if (!journal) {
      journal = await prisma.journal.create({
        data: {
          userId,
          date: today,
          content: "",
        },
      });
      logger.info("Created new journal entry for today", { userId });
    }

    return journal;
  }

  /**
   * Get journal entry by specific date
   */
  async getJournalByDate(userId: string, date: Date) {
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    return prisma.journal.findFirst({
      where: {
        userId,
        date: dateOnly,
      },
    });
  }

  /**
   * Get one journal by its stable record ID, scoped to its owner.
   */
  async getJournalById(userId: string, journalId: string) {
    return prisma.journal.findFirst({
      where: {
        id: journalId,
        userId,
      },
    });
  }

  /**
   * Get paginated journal entries
   */
  async getJournalEntries(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;

    const [journals, total] = await Promise.all([
      prisma.journal.findMany({
        where: { userId },
        orderBy: { date: "desc" },
        skip,
        take: limit,
      }),
      prisma.journal.count({
        where: { userId },
      }),
    ]);

    return {
      journals,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + journals.length < total,
      },
    };
  }

  /**
   * Create a new journal entry
   */
  async createJournal(
    userId: string,
    date: Date,
    content: string,
    mood?: string,
    tags?: string[],
  ) {
    const dateOnly = new Date(date);
    dateOnly.setHours(0, 0, 0, 0);

    const journal = await prisma.journal.create({
      data: {
        userId,
        date: dateOnly,
        content,
        mood,
        tags: tags || [],
      },
    });

    logger.info("Journal entry created", { userId, journalId: journal.id });
    return journal;
  }

  /**
   * Update existing journal entry
   */
  async updateJournal(
    journalId: string,
    userId: string,
    content?: string,
    mood?: string,
    tags?: string[],
  ) {
    const updateData: any = {};
    if (content !== undefined) updateData.content = content;
    if (mood !== undefined) updateData.mood = mood;
    if (tags !== undefined) updateData.tags = tags;

    return prisma.journal.updateMany({
      where: {
        id: journalId,
        userId, // Ensure user owns this journal
      },
      data: updateData,
    });
  }

  /**
   * Delete a journal entry
   */
  async deleteJournal(journalId: string, userId: string) {
    return prisma.journal.deleteMany({
      where: {
        id: journalId,
        userId, // Ensure user owns this journal
      },
    });
  }

  /**
   * Get journal summary (AI-generated, cached for 24 hours)
   */
  async getJournalSummary(userId: string) {
    // Check cache first
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        lastJournalSummaryAt: true,
        journalSummary: true,
      },
    });

    const now = new Date();
    const lastSummaryAt = user?.lastJournalSummaryAt;
    const cachedSummary = user?.journalSummary;

    // Check if summary is still valid (less than 24 hours old)
    const isSummaryValid =
      lastSummaryAt &&
      now.getTime() - lastSummaryAt.getTime() < 24 * 60 * 60 * 1000;

    // If we have a valid cached summary, return it without calling Gemini
    if (isSummaryValid && cachedSummary) {
      logger.info("Returning cached journal summary", { userId });
      return {
        summary: cachedSummary,
        summaryGenerated: false,
      };
    }

    // Need to generate new summary - get last 30 entries
    const journals = await prisma.journal.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 30,
    });

    let summary: string;
    let summaryGenerated = false;

    if (journals.length > 0) {
      // Generate new AI summary
      summary = await geminiService.generateJournalSummary(
        journals.map((j) => ({
          date: j.date,
          content: j.content,
          mood: j.mood,
        })),
      );

      // Store summary and update timestamp
      await prisma.user.update({
        where: { id: userId },
        data: {
          journalSummary: summary,
          lastJournalSummaryAt: now,
        },
      });

      summaryGenerated = true;
      logger.info("New journal summary generated and cached", { userId });
    } else {
      // No journals yet - return fallback message
      summary =
        "You haven't written any journal entries yet. Start journaling to reflect on your thoughts and see insights about your journey.";
    }

    return {
      summary,
      summaryGenerated,
    };
  }

  /**
   * Get journal stats for user
   */
  async getJournalStats(userId: string) {
    const total = await prisma.journal.count({
      where: { userId },
    });

    const withMood = await prisma.journal.count({
      where: {
        userId,
        mood: { not: null },
      },
    });

    // Get current streak (consecutive days with entries)
    const journals = await prisma.journal.findMany({
      where: { userId },
      orderBy: { date: "desc" },
      take: 100,
    });

    let currentStreak = 0;
    if (journals.length > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (let i = 0; i < journals.length; i++) {
        const expectedDate = new Date(today);
        expectedDate.setDate(today.getDate() - i);
        expectedDate.setHours(0, 0, 0, 0);

        const journalDate = new Date(journals[i].date);
        journalDate.setHours(0, 0, 0, 0);

        if (journalDate.getTime() === expectedDate.getTime()) {
          currentStreak++;
        } else {
          break;
        }
      }
    }

    return {
      totalEntries: total,
      entriesWithMood: withMood,
      currentStreak,
    };
  }
}

export const journalService = new JournalService();
