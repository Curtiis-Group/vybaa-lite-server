"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const quick_task_suggestion_service_1 = require("../services/quick-task-suggestion.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (!req.userId) {
        res.status(401).json({ msg: "Sign in required" });
        return;
    }
    try {
        res.json({ data: await (0, quick_task_suggestion_service_1.listQuickTaskSuggestions)(req.userId) });
    }
    catch (error) {
        logger_util_1.default.error("Quick task suggestions unavailable", {
            errorName: error instanceof Error ? error.name : "UnknownError",
            userId: req.userId,
        });
        res
            .status(503)
            .json({ msg: "Suggestions are unavailable. You can still add a task." });
    }
});
exports.default = router;
