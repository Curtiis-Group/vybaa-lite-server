"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const realtime_controller_1 = require("../controllers/realtime.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.post("/token", auth_middleware_1.authMiddleware, realtime_controller_1.createRealtimeToken);
exports.default = router;
