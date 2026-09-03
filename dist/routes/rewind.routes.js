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
const rewindIntelligenceController = __importStar(require("../controllers/rewind-intelligence.controller"));
const rewindController = __importStar(require("../controllers/rewind.controller"));
const rewindRoutineController = __importStar(require("../controllers/rewind-routine.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const rewind_validators_1 = require("../validators/rewind.validators");
const router = (0, express_1.Router)();
router.get("/routine", auth_middleware_1.authMiddleware, rewindRoutineController.getRewindRoutine);
router.put("/routine", auth_middleware_1.authMiddleware, rewindRoutineController.updateRewindRoutine);
router.get("/home-greeting", auth_middleware_1.authMiddleware, rewindIntelligenceController.getHomeGreeting);
router.get("/observations", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.listRewindRecordsSchema, "query"), rewindIntelligenceController.listObservations);
router.get("/observations/:observationId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.rewindObservationIdSchema, "params"), rewindIntelligenceController.getObservation);
router.delete("/observations/:observationId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.rewindObservationIdSchema, "params"), rewindIntelligenceController.dismissObservation);
router.get("/chats", auth_middleware_1.authMiddleware, rewindIntelligenceController.listChats);
router.get("/chats/:chatId/messages", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.rewindChatIdSchema, "params"), (0, validation_middleware_1.validate)(rewind_validators_1.listRewindRecordsSchema, "query"), rewindIntelligenceController.listChatMessages);
router.post("/chats/:chatId/messages", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.rewindChatIdSchema, "params"), (0, validation_middleware_1.validate)(rewind_validators_1.sendRewindChatMessageSchema), rewindIntelligenceController.sendChatMessage);
router.patch("/chats/:chatId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.rewindChatIdSchema, "params"), (0, validation_middleware_1.validate)(rewind_validators_1.updateRewindChatSchema), rewindIntelligenceController.updateChat);
router.post("/activity", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(rewind_validators_1.recordRewindActivitySchema), rewindIntelligenceController.recordActivity);
router.get("/sessions", auth_middleware_1.authMiddleware, rewindController.getPaginatedRewindSessions);
router.get("/insights", auth_middleware_1.authMiddleware, rewindController.getRewindInsights);
router.post("/sessions/:sessionId/add-to-journal", auth_middleware_1.authMiddleware, rewindController.addRewindSessionToJournal);
router.post("/sessions/:sessionId/recommendations/:recommendationId/accept", auth_middleware_1.authMiddleware, rewindController.acceptRecommendation);
router.post("/sessions/:sessionId/recommendations/:recommendationId/dismiss", auth_middleware_1.authMiddleware, rewindController.dismissRecommendation);
router.get("/sessions/:sessionId", auth_middleware_1.authMiddleware, rewindController.getRewindSession);
router.post("/live-token", auth_middleware_1.authMiddleware, rewindController.createLiveToken);
exports.default = router;
