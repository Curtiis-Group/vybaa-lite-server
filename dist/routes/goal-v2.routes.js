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
const goalController = __importStar(require("../controllers/goal-v2.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const goal_v2_validators_1 = require("../validators/goal-v2.validators");
const router = (0, express_1.Router)();
router.use(auth_middleware_1.authMiddleware);
router.get("/", (0, validation_middleware_1.validate)(goal_v2_validators_1.listGoalsV2QuerySchema, "query"), goalController.list);
router.post("/quick-setup", (0, validation_middleware_1.validate)(goal_v2_validators_1.quickGoalSetupSchema), goalController.quickSetup);
router.get("/alarm-manifest", goalController.alarmManifest);
router.put("/alarm-registration", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalAlarmRegistrationSchema), goalController.alarmRegistration);
router.post("/", (0, validation_middleware_1.validate)(goal_v2_validators_1.createGoalV2Schema), goalController.create);
router.get("/legacy", goalController.listLegacy);
router.post("/legacy/:goalId/reopen", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.reopenLegacy);
router.patch("/legacy/:goalId/archive", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.archiveLegacy);
router.delete("/legacy/:goalId", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.deleteLegacy);
router.get("/:goalId", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.detail);
router.patch("/:goalId", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.updateGoalV2Schema), goalController.update);
router.delete("/:goalId", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.permanentlyDelete);
router.get("/:goalId/occurrences", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.listGoalOccurrencesQuerySchema, "query"), goalController.occurrences);
router.post("/:goalId/occurrences/:occurrenceId/progress", (0, validation_middleware_1.validate)(goal_v2_validators_1.occurrenceIdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.recordGoalProgressSchema), goalController.recordProgress);
router.patch("/:goalId/occurrences/:occurrenceId/progress", (0, validation_middleware_1.validate)(goal_v2_validators_1.occurrenceIdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.recordGoalProgressSchema), goalController.correctProgress);
router.delete("/:goalId/occurrences/:occurrenceId/progress", (0, validation_middleware_1.validate)(goal_v2_validators_1.occurrenceIdParamSchema, "params"), goalController.undoProgress);
router.patch("/:goalId/occurrences/:occurrenceId/reschedule", (0, validation_middleware_1.validate)(goal_v2_validators_1.occurrenceIdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.rescheduleOccurrenceSchema), goalController.reschedule);
router.post("/:goalId/pause", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.pause);
router.post("/:goalId/resume", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.resumeGoalSchema), goalController.resume);
router.post("/:goalId/abandon", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.abandon);
router.post("/:goalId/archive", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.archive);
router.post("/:goalId/reopen", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), goalController.reopen);
router.patch("/:goalId/conclusion/review", (0, validation_middleware_1.validate)(goal_v2_validators_1.goalV2IdParamSchema, "params"), (0, validation_middleware_1.validate)(goal_v2_validators_1.conclusionReviewSchema), goalController.updateReview);
exports.default = router;
