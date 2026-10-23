"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middleware/auth.middleware");
const flexx_design_service_1 = require("../services/flexx-design.service");
const flexx_design_validators_1 = require("../validators/flexx-design.validators");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const flexx_questionnaire_service_1 = require("../services/flexx-questionnaire.service");
const router = (0, express_1.Router)();
router.get("/designs", auth_middleware_1.authMiddleware, async (req, res) => {
    if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
    }
    const parsed = flexx_design_validators_1.flexxFeedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ msg: "Invalid Flexx feed query" });
        return;
    }
    let cursor;
    try {
        cursor = (0, flexx_design_service_1.decodeFlexxFeedCursor)(parsed.data.cursor, parsed.data.category, req.userId);
    }
    catch {
        res.status(400).json({ msg: "Invalid Flexx cursor" });
        return;
    }
    try {
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
            data: await (0, flexx_design_service_1.getFlexxDesignPage)({
                category: parsed.data.category,
                ...cursor,
                userId: req.userId,
            }),
        });
    }
    catch (error) {
        logger_util_1.default.error("Flexx design feed failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        res
            .status(503)
            .json({ msg: "More designs are unavailable. Please retry." });
    }
});
router.get("/questionnaire/answers", auth_middleware_1.authMiddleware, async (req, res) => {
    if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
    }
    try {
        res.setHeader("Cache-Control", "private, no-store");
        res.json({ data: await (0, flexx_questionnaire_service_1.listFlexxAnswers)(req.userId) });
    }
    catch (error) {
        if (error instanceof flexx_questionnaire_service_1.FlexxAnswerError) {
            res.status(error.statusCode).json({ msg: error.message });
            return;
        }
        logger_util_1.default.error("Unable to load Flexx answers", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        res
            .status(503)
            .json({ msg: "Couldn't load your answers. Please retry." });
    }
});
router.post("/questionnaire/answers", auth_middleware_1.authMiddleware, async (req, res) => {
    if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
    }
    const input = flexx_questionnaire_service_1.flexxAnswerInputSchema.safeParse(req.body);
    if (!input.success) {
        res.status(400).json({ msg: "Invalid questionnaire answer" });
        return;
    }
    try {
        res.setHeader("Cache-Control", "private, no-store");
        res.json({ data: await (0, flexx_questionnaire_service_1.saveFlexxAnswer)(req.userId, input.data) });
    }
    catch (error) {
        if (error instanceof flexx_questionnaire_service_1.FlexxAnswerError) {
            res.status(error.statusCode).json({ msg: error.message });
            return;
        }
        logger_util_1.default.error("Unable to save Flexx answer", {
            errorName: error instanceof Error ? error.name : "UnknownError",
        });
        res.status(503).json({ msg: "Couldn't save your answer. Please retry." });
    }
});
exports.default = router;
