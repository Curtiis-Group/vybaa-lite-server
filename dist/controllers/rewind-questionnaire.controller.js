"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startQuestionnaire = startQuestionnaire;
exports.answerQuestionnaire = answerQuestionnaire;
exports.finishQuestionnaire = finishQuestionnaire;
const rewind_questionnaire_service_1 = require("../services/rewind-questionnaire.service");
const rewind_routine_service_1 = require("../services/rewind-routine.service");
const subscription_access_service_1 = require("../services/subscription-access.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function handleError(error, res) {
    if ((0, subscription_access_service_1.handleSubscriptionAccessError)(error, res))
        return;
    if (error instanceof rewind_questionnaire_service_1.RewindQuestionnaireError) {
        res.status(error.statusCode).json({ msg: error.message });
        return;
    }
    if (error instanceof rewind_routine_service_1.RewindRoutineAvailabilityError) {
        res
            .status(409)
            .json({
            msg: "Your Rewind is outside its scheduled window. Check your routine for the next session.",
        });
        return;
    }
    logger_util_1.default.error("Rewind questionnaire request failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res
        .status(500)
        .json({
        msg: "Your Rewind could not be saved. Your answers are kept; please try again.",
    });
}
async function startQuestionnaire(req, res) {
    if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
    }
    try {
        res.json({
            data: await (0, rewind_questionnaire_service_1.startRewindQuestionnaire)(req.userId, req.clientApp),
        });
    }
    catch (error) {
        handleError(error, res);
    }
}
async function answerQuestionnaire(req, res) {
    if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
    }
    const params = rewind_questionnaire_service_1.questionnaireSessionParamsSchema.parse(req.params);
    const input = rewind_questionnaire_service_1.questionnaireAnswerInputSchema.parse(req.body);
    try {
        res.json({
            data: await (0, rewind_questionnaire_service_1.answerRewindQuestionnaire)(req.userId, params.sessionId, input),
        });
    }
    catch (error) {
        handleError(error, res);
    }
}
async function finishQuestionnaire(req, res) {
    if (!req.userId) {
        res.status(401).json({ msg: "Authentication required" });
        return;
    }
    const params = rewind_questionnaire_service_1.questionnaireSessionParamsSchema.parse(req.params);
    try {
        res.json({
            data: await (0, rewind_questionnaire_service_1.finishRewindQuestionnaire)(req.userId, params.sessionId),
        });
    }
    catch (error) {
        handleError(error, res);
    }
}
