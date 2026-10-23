"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const goal_subtask_service_1 = require("../services/goal-subtask.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const goal_subtask_validators_1 = require("../validators/goal-subtask.validators");
const router = (0, express_1.Router)({ mergeParams: true });
const parentParams = goal_subtask_validators_1.subtaskParamsSchema.pick({ goalId: true });
function handleError(error, res) {
    if (error instanceof zod_1.ZodError) {
        res
            .status(400)
            .json({ msg: error.issues[0]?.message ?? "Invalid subtask" });
        return;
    }
    if (error instanceof goal_subtask_service_1.SubtaskError) {
        res.status(error.status).json({ msg: error.message });
        return;
    }
    logger_util_1.default.error("Subtask request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(500).json({ msg: "Could not save subtasks. Please try again." });
}
router.get("/", async (req, res) => {
    if (!req.userId) {
        res.status(401).json({ msg: "Sign in required" });
        return;
    }
    try {
        const { goalId } = parentParams.parse(req.params);
        res.json({ data: await (0, goal_subtask_service_1.listSubtasks)(req.userId, goalId) });
    }
    catch (error) {
        handleError(error, res);
    }
});
router.post("/", async (req, res) => {
    if (!req.userId) {
        res.status(401).json({ msg: "Sign in required" });
        return;
    }
    try {
        const { goalId } = parentParams.parse(req.params);
        const parsed = goal_subtask_validators_1.createSubtaskSchema.parse(req.body);
        if (!parsed.id || !parsed.title)
            throw new goal_subtask_service_1.SubtaskError(400, "A title and request ID are required");
        const input = { id: parsed.id, title: parsed.title };
        res
            .status(201)
            .json({ data: await (0, goal_subtask_service_1.createSubtask)(req.userId, goalId, input) });
    }
    catch (error) {
        handleError(error, res);
    }
});
router.patch("/:subtaskId", async (req, res) => {
    if (!req.userId) {
        res.status(401).json({ msg: "Sign in required" });
        return;
    }
    try {
        const { goalId, subtaskId } = goal_subtask_validators_1.subtaskParamsSchema.parse(req.params);
        const parsed = goal_subtask_validators_1.updateSubtaskSchema.parse(req.body);
        if (parsed.revision === undefined)
            throw new goal_subtask_service_1.SubtaskError(400, "A subtask revision is required");
        const input = { ...parsed, revision: parsed.revision };
        res.json({
            data: await (0, goal_subtask_service_1.updateSubtask)(req.userId, goalId, subtaskId, input),
        });
    }
    catch (error) {
        handleError(error, res);
    }
});
exports.default = router;
