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
const goalController = __importStar(require("../controllers/legacy-goal.controller"));
const router = (0, express_1.Router)();
// GET /api/v1/goals - Get all user's goals
router.get("/", auth_middleware_1.authMiddleware, goalController.listLegacyGoals);
// GET /api/v1/goals/current - Get user's current active goal
router.get("/current", auth_middleware_1.authMiddleware, goalController.getCurrentLegacyGoal);
// GET /api/v1/goals/:goalId - Get a specific goal
router.get("/:goalId", auth_middleware_1.authMiddleware, goalController.getLegacyGoal);
function requireGoalV2(_req, res) {
    res.status(426).json({
        code: "GOAL_V2_REQUIRED",
        msg: "Goal changes now require the standardized v2 goal experience",
    });
}
router.post("/", auth_middleware_1.authMiddleware, requireGoalV2);
router.put("/:goalId", auth_middleware_1.authMiddleware, requireGoalV2);
router.post("/check-in", auth_middleware_1.authMiddleware, requireGoalV2);
router.post("/reset", auth_middleware_1.authMiddleware, requireGoalV2);
router.post("/bulk-delete", auth_middleware_1.authMiddleware, requireGoalV2);
router.delete("/:goalId", auth_middleware_1.authMiddleware, requireGoalV2);
exports.default = router;
