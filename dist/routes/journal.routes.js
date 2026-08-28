"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const journalController = __importStar(require("../controllers/journal.controller"));
const router = (0, express_1.Router)();
// All routes require authentication
router.use(auth_middleware_1.authMiddleware);
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
exports.default = router;
