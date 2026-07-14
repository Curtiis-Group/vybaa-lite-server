"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const subscription_controller_1 = require("../controllers/subscription.controller");
const auth_middleware_1 = require("../middleware/auth.middleware");
const router = (0, express_1.Router)();
router.get("/config", subscription_controller_1.getSubscriptionConfig);
router.get("/status", auth_middleware_1.authMiddleware, subscription_controller_1.getSubscriptionStatus);
exports.default = router;
