import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as journalController from "../controllers/journal.controller";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get today's journal entry (or create empty one)
router.get("/today", journalController.getTodayJournal);

// Get journal entry by date
router.get("/date/:date", journalController.getJournalByDate);

// Get paginated journal entries
router.get("/", journalController.getJournals);

// Create journal entry
router.post("/", journalController.createJournal);

// Update journal entry
router.put("/:journalId", journalController.updateJournal);

// Delete journal entry
router.delete("/:journalId", journalController.deleteJournal);

// Get journal summary (AI-generated, cached 24h)
router.get("/summary", journalController.getJournalSummary);

// Get journal stats
router.get("/stats", journalController.getJournalStats);

// Get one journal entry by its stable record ID
router.get("/:journalId", journalController.getJournalById);

export default router;
