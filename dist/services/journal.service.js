"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.journalService = void 0;
const db_config_1 = require("../config/db.config");
const gemini_service_1 = require("./gemini.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
class JournalService {
    /**
     * Get or create today's journal entry for a user
     */
    async getOrCreateTodayEntry(userId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Set to start of day
        let journal = await db_config_1.prisma.journal.findFirst({
            where: {
                userId,
                date: today,
            },
        });
        if (!journal) {
            journal = await db_config_1.prisma.journal.create({
                data: {
                    userId,
                    date: today,
                    content: "",
                },
            });
            logger_util_1.default.info("Created new journal entry for today", { userId });
        }
        return journal;
    }
    /**
     * Get journal entry by specific date
     */
    async getJournalByDate(userId, date) {
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);
        return db_config_1.prisma.journal.findFirst({
            where: {
                userId,
                date: dateOnly,
            },
        });
    }
    /**
     * Get one journal by its stable record ID, scoped to its owner.
     */
    async getJournalById(userId, journalId) {
        return db_config_1.prisma.journal.findFirst({
            where: {
                id: journalId,
                userId,
            },
        });
    }
    /**
     * Get paginated journal entries
     */
    async getJournalEntries(userId, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const [journals, total] = await Promise.all([
            db_config_1.prisma.journal.findMany({
                where: { userId },
                orderBy: { date: "desc" },
                skip,
                take: limit,
            }),
            db_config_1.prisma.journal.count({
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
    async createJournal(userId, date, content, mood, tags) {
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);
        const journal = await db_config_1.prisma.journal.create({
            data: {
                userId,
                date: dateOnly,
                content,
                mood,
                tags: tags || [],
            },
        });
        logger_util_1.default.info("Journal entry created", { userId, journalId: journal.id });
        return journal;
    }
    /**
     * Update existing journal entry
     */
    async updateJournal(journalId, userId, content, mood, tags) {
        const updateData = {};
        if (content !== undefined)
            updateData.content = content;
        if (mood !== undefined)
            updateData.mood = mood;
        if (tags !== undefined)
            updateData.tags = tags;
        return db_config_1.prisma.journal.updateMany({
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
    async deleteJournal(journalId, userId) {
        return db_config_1.prisma.journal.deleteMany({
            where: {
                id: journalId,
                userId, // Ensure user owns this journal
            },
        });
    }
    /**
     * Get journal summary (AI-generated, cached for 24 hours)
     */
    async getJournalSummary(userId) {
        // Check cache first
        const user = await db_config_1.prisma.user.findUnique({
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
        const isSummaryValid = lastSummaryAt &&
            now.getTime() - lastSummaryAt.getTime() < 24 * 60 * 60 * 1000;
        // If we have a valid cached summary, return it without calling Gemini
        if (isSummaryValid && cachedSummary) {
            logger_util_1.default.info("Returning cached journal summary", { userId });
            return {
                summary: cachedSummary,
                summaryGenerated: false,
            };
        }
        // Need to generate new summary - get last 30 entries
        const journals = await db_config_1.prisma.journal.findMany({
            where: { userId },
            orderBy: { date: "desc" },
            take: 30,
        });
        let summary;
        let summaryGenerated = false;
        if (journals.length > 0) {
            // Generate new AI summary
            summary = await gemini_service_1.geminiService.generateJournalSummary(journals.map((j) => ({
                date: j.date,
                content: j.content,
                mood: j.mood,
            })));
            // Store summary and update timestamp
            await db_config_1.prisma.user.update({
                where: { id: userId },
                data: {
                    journalSummary: summary,
                    lastJournalSummaryAt: now,
                },
            });
            summaryGenerated = true;
            logger_util_1.default.info("New journal summary generated and cached", { userId });
        }
        else {
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
    async getJournalStats(userId) {
        const total = await db_config_1.prisma.journal.count({
            where: { userId },
        });
        const withMood = await db_config_1.prisma.journal.count({
            where: {
                userId,
                mood: { not: null },
            },
        });
        // Get current streak (consecutive days with entries)
        const journals = await db_config_1.prisma.journal.findMany({
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
                }
                else {
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
exports.journalService = new JournalService();
