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
const auth_validators_1 = require("../validators/auth.validators");
const userController = __importStar(require("../controllers/user.controller"));
const usernameController = __importStar(require("../controllers/username.controller"));
const rewardsController = __importStar(require("../controllers/rewards.controller"));
const router = (0, express_1.Router)();
// PUT /api/v1/users/me
router.put("/me", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(auth_validators_1.updateProfileSchema), userController.updateProfile);
// GET /api/v1/users/me
router.get("/me", auth_middleware_1.authMiddleware, userController.getProfile);
// GET /api/v1/users/username/availability - Check username change cooldown
router.get("/username/availability", auth_middleware_1.authMiddleware, userController.checkUsernameAvailability);
// GET /api/v1/users/username/check - Check if username is available (real-time)
router.get("/username/check", auth_middleware_1.authMiddleware, usernameController.checkUsernameChangeAvailability);
// POST /api/v1/users/fcm-token
router.post("/fcm-token", auth_middleware_1.authMiddleware, userController.registerFCMToken);
// DELETE /api/v1/users/fcm-token
router.delete("/fcm-token", auth_middleware_1.authMiddleware, userController.removeFCMToken);
// GET /api/v1/users/rewards
router.get("/rewards", auth_middleware_1.authMiddleware, rewardsController.getRewards);
exports.default = router;
