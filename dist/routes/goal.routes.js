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
const validation_middleware_1 = require("../middleware/validation.middleware");
const goal_validators_1 = require("../validators/goal.validators");
const goalController = __importStar(require("../controllers/goal.controller"));
const router = (0, express_1.Router)();
// GET /api/v1/goals - Get all user's goals
router.get("/", auth_middleware_1.authMiddleware, goalController.getAllGoals);
// GET /api/v1/goals/current - Get user's current active goal
router.get("/current", auth_middleware_1.authMiddleware, goalController.getCurrentGoal);
// GET /api/v1/goals/:goalId - Get a specific goal
router.get("/:goalId", auth_middleware_1.authMiddleware, goalController.getGoalById);
// POST /api/v1/goals - Create/start a goal
router.post("/", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(goal_validators_1.createGoalSchema), goalController.createGoal);
// PUT /api/v1/goals/:goalId - Update a goal
router.put("/:goalId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(goal_validators_1.updateGoalSchema), goalController.updateGoal);
// POST /api/v1/goals/check-in - Mark "I showed up today"
router.post("/check-in", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(goal_validators_1.checkInSchema), goalController.checkIn);
// POST /api/v1/goals/reset - Reset to Day 0
router.post("/reset", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(goal_validators_1.resetGoalSchema), goalController.resetGoal);
// POST /api/v1/goals/bulk-delete - Bulk delete goals
router.post("/bulk-delete", auth_middleware_1.authMiddleware, goalController.bulkDeleteGoals);
// DELETE /api/v1/goals/:goalId - Delete a goal
router.delete("/:goalId", auth_middleware_1.authMiddleware, goalController.deleteGoal);
exports.default = router;
