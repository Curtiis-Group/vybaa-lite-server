import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { journalService } from "../services/journal.service";
import logger from "../utils/logger.util";

/**
 * Get or create today's journal entry
 */
export async function getTodayJournal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const journal = await journalService.getOrCreateTodayEntry(userId);

    // Map 'content' to 'entry' for frontend compatibility
    const mappedJournal = {
      ...journal,
      entry: journal.content,
    };

    res.json({
      msg: "Today's journal retrieved successfully",
      data: { journal: mappedJournal },
    });
  } catch (error) {
    logger.error("Get today's journal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get journal entry by date
 */
export async function getJournalByDate(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const dateStr = String(req.params.date);

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ msg: "Invalid date format. Use YYYY-MM-DD" });
    }

    const journal = await journalService.getJournalByDate(userId, date);

    if (!journal) {
      return res.status(404).json({ msg: "Journal entry not found for this date" });
    }

    // Map 'content' to 'entry' for frontend compatibility
    const mappedJournal = {
      ...journal,
      entry: journal.content,
    };

    res.json({
      msg: "Journal entry retrieved successfully",
      data: { journal: mappedJournal },
    });
  } catch (error) {
    logger.error("Get journal by date error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get paginated journal entries
 */
export async function getJournals(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "20")) || 20;

    const result = await journalService.getJournalEntries(userId, page, limit);

    // Map 'content' to 'entry' for frontend compatibility
    const mappedJournals = result.journals.map(journal => ({
      ...journal,
      entry: journal.content,
    }));

    res.json({
      msg: "Journal entries retrieved successfully",
      data: mappedJournals,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("Get journals error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Create a new journal entry
 */
export async function createJournal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { date, entry, content, mood, tags } = req.body;
    
    // Accept both 'entry' and 'content' for backwards compatibility
    const journalContent = entry || content;

    if (!journalContent || typeof journalContent !== "string" || !journalContent.trim()) {
      return res.status(400).json({ msg: "Entry content is required" });
    }

    const journalDate = date ? new Date(date) : new Date();
    if (isNaN(journalDate.getTime())) {
      return res.status(400).json({ msg: "Invalid date format" });
    }

    const journal = await journalService.createJournal(userId, journalDate, journalContent.trim(), mood, tags);

    // Map 'content' to 'entry' for frontend compatibility
    const mappedJournal = {
      ...journal,
      entry: journal.content,
    };

    res.status(201).json({
      msg: "Journal entry created successfully",
      data: { journal: mappedJournal },
    });
  } catch (error: any) {
    if (error.code === "P2002") {
      return res.status(400).json({ msg: "You already have a journal entry for this date" });
    }
    logger.error("Create journal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Update a journal entry
 */
export async function updateJournal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const journalId = String(req.params.journalId);
    const { entry, content, mood, tags } = req.body;
    
    // Accept both 'entry' and 'content' for backwards compatibility
    const journalContent = entry || content;

    const result = await journalService.updateJournal(journalId, userId, journalContent, mood, tags);

    if (result.count === 0) {
      return res.status(404).json({ msg: "Journal entry not found" });
    }

    res.json({
      msg: "Journal entry updated successfully",
    });
  } catch (error) {
    logger.error("Update journal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Delete a journal entry
 */
export async function deleteJournal(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const journalId = String(req.params.journalId);

    const result = await journalService.deleteJournal(journalId, userId);

    if (result.count === 0) {
      return res.status(404).json({ msg: "Journal entry not found" });
    }

    res.json({
      msg: "Journal entry deleted successfully",
    });
  } catch (error) {
    logger.error("Delete journal error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get journal summary (AI-generated, cached for 24 hours)
 */
export async function getJournalSummary(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const result = await journalService.getJournalSummary(userId);

    res.json({
      msg: "Journal summary retrieved successfully",
      data: result,
    });
  } catch (error) {
    logger.error("Get journal summary error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get journal stats
 */
export async function getJournalStats(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    const stats = await journalService.getJournalStats(userId);

    res.json({
      msg: "Journal stats retrieved successfully",
      data: stats,
    });
  } catch (error) {
    logger.error("Get journal stats error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
