"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayJournal = getTodayJournal;
exports.getJournalByDate = getJournalByDate;
exports.getJournals = getJournals;
exports.createJournal = createJournal;
exports.updateJournal = updateJournal;
exports.deleteJournal = deleteJournal;
exports.getJournalSummary = getJournalSummary;
exports.getJournalStats = getJournalStats;
const journal_service_1 = require("../services/journal.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Get or create today's journal entry
 */
async function getTodayJournal(req, res) {
    try {
        const userId = req.userId;
        const journal = await journal_service_1.journalService.getOrCreateTodayEntry(userId);
        res.json({
            msg: "Today's journal retrieved successfully",
            data: journal,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get today's journal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get journal entry by date
 */
async function getJournalByDate(req, res) {
    try {
        const userId = req.userId;
        const dateStr = String(req.params.date);
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            return res.status(400).json({ msg: "Invalid date format. Use YYYY-MM-DD" });
        }
        const journal = await journal_service_1.journalService.getJournalByDate(userId, date);
        if (!journal) {
            return res.status(404).json({ msg: "Journal entry not found for this date" });
        }
        res.json({
            msg: "Journal entry retrieved successfully",
            data: journal,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get journal by date error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get paginated journal entries
 */
async function getJournals(req, res) {
    try {
        const userId = req.userId;
        const pageParam = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
        const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
        const page = parseInt(String(pageParam || "1")) || 1;
        const limit = parseInt(String(limitParam || "20")) || 20;
        const result = await journal_service_1.journalService.getJournalEntries(userId, page, limit);
        res.json({
            msg: "Journal entries retrieved successfully",
            data: result.journals,
            pagination: result.pagination,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get journals error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Create a new journal entry
 */
async function createJournal(req, res) {
    try {
        const userId = req.userId;
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
        const journal = await journal_service_1.journalService.createJournal(userId, journalDate, journalContent.trim(), mood, tags);
        res.status(201).json({
            msg: "Journal entry created successfully",
            data: { journal },
        });
    }
    catch (error) {
        if (error.code === "P2002") {
            return res.status(400).json({ msg: "You already have a journal entry for this date" });
        }
        logger_util_1.default.error("Create journal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Update a journal entry
 */
async function updateJournal(req, res) {
    try {
        const userId = req.userId;
        const journalId = String(req.params.journalId);
        const { entry, content, mood, tags } = req.body;
        // Accept both 'entry' and 'content' for backwards compatibility
        const journalContent = entry || content;
        const result = await journal_service_1.journalService.updateJournal(journalId, userId, journalContent, mood, tags);
        if (result.count === 0) {
            return res.status(404).json({ msg: "Journal entry not found" });
        }
        res.json({
            msg: "Journal entry updated successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Update journal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Delete a journal entry
 */
async function deleteJournal(req, res) {
    try {
        const userId = req.userId;
        const journalId = String(req.params.journalId);
        const result = await journal_service_1.journalService.deleteJournal(journalId, userId);
        if (result.count === 0) {
            return res.status(404).json({ msg: "Journal entry not found" });
        }
        res.json({
            msg: "Journal entry deleted successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Delete journal error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get journal summary (AI-generated, cached for 24 hours)
 */
async function getJournalSummary(req, res) {
    try {
        const userId = req.userId;
        const result = await journal_service_1.journalService.getJournalSummary(userId);
        res.json({
            msg: "Journal summary retrieved successfully",
            data: result,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get journal summary error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get journal stats
 */
async function getJournalStats(req, res) {
    try {
        const userId = req.userId;
        const stats = await journal_service_1.journalService.getJournalStats(userId);
        res.json({
            msg: "Journal stats retrieved successfully",
            data: stats,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get journal stats error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
