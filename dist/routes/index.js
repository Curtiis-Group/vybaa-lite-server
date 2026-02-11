"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_routes_1 = __importDefault(require("./auth.routes"));
const user_routes_1 = __importDefault(require("./user.routes"));
const goal_routes_1 = __importDefault(require("./goal.routes"));
const insights_routes_1 = __importDefault(require("./insights.routes"));
const upload_routes_1 = __importDefault(require("./upload.routes"));
const notification_routes_1 = __importDefault(require("./notification.routes"));
const achievement_routes_1 = __importDefault(require("./achievement.routes"));
const chill_routes_1 = __importDefault(require("./chill.routes"));
const journal_routes_1 = __importDefault(require("./journal.routes"));
const router = (0, express_1.Router)();
// Health check endpoint
router.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});
// Root endpoint
router.get("/", (req, res) => {
    res.status(200).json({
        message: "Vybaa API Server",
        version: "1.0.0",
        status: "running"
    });
});
// Mount auth routes at /api/v1/auth
router.use("/v1/auth", auth_routes_1.default);
// Mount user routes at /api/v1/users
router.use("/v1/users", user_routes_1.default);
// Mount goal routes at /api/v1/goals
router.use("/v1/goals", goal_routes_1.default);
// Mount insights routes at /api/v1/insights
router.use("/v1/insights", insights_routes_1.default);
// Mount upload routes at /api/v1/upload
router.use("/v1/upload", upload_routes_1.default);
// Mount notification routes at /api/v1/notifications
router.use("/v1/notifications", notification_routes_1.default);
// Mount achievement routes at /api/v1/achievements
router.use("/v1/achievements", achievement_routes_1.default);
// Mount chill routes at /api/v1/chill
router.use("/v1/chill", chill_routes_1.default);
// Mount journal routes at /api/v1/journals
router.use("/v1/journals", journal_routes_1.default);
exports.default = router;
