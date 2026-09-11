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
const authController = __importStar(require("../controllers/auth.controller"));
const router = (0, express_1.Router)();
// POST /api/v1/auth/login
router.post("/login", (0, validation_middleware_1.validate)(auth_validators_1.loginSchema), authController.login);
// POST /api/v1/auth/register
router.post("/register", (0, validation_middleware_1.validate)(auth_validators_1.registerSchema), authController.register);
// POST /api/v1/auth/google
router.post("/google", (0, validation_middleware_1.validate)(auth_validators_1.googleAuthSchema), authController.googleAuth);
// POST /api/v1/auth/apple
router.post("/apple", (0, validation_middleware_1.validate)(auth_validators_1.appleAuthSchema), authController.appleAuth);
// POST /api/v1/auth/session
router.post("/session", auth_middleware_1.authMiddleware, authController.getSession);
// POST /api/v1/auth/refresh-token
router.post("/refresh-token", (0, validation_middleware_1.validate)(auth_validators_1.refreshTokenSchema), authController.refreshToken);
// POST /api/v1/auth/logout
router.post("/logout", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(auth_validators_1.logoutSchema), authController.logout);
// POST /api/v1/auth/request-validation
router.post("/request-validation", (0, validation_middleware_1.validate)(auth_validators_1.requestPasswordResetSchema), authController.requestPasswordReset);
// POST /api/v1/auth/verify-recovery-code
router.post("/verify-recovery-code", (0, validation_middleware_1.validate)(auth_validators_1.verifyOTPSchema), authController.verifyRecoveryCode);
// POST /api/v1/auth/recover-account
router.post("/recover-account", (0, validation_middleware_1.validate)(auth_validators_1.resetPasswordSchema), authController.recoverAccount);
// POST /api/v1/auth/request-confirmation
router.post("/request-confirmation", (0, validation_middleware_1.validate)(auth_validators_1.requestConfirmationSchema), authController.requestConfirmation);
// POST /api/v1/auth/account-confirmation
router.post("/account-confirmation", (0, validation_middleware_1.validate)(auth_validators_1.accountConfirmationSchema), authController.accountConfirmation);
// GET /api/v1/auth/email-check/:email
router.get("/email-check/:email", (0, validation_middleware_1.validate)(auth_validators_1.emailParamSchema, "params"), authController.checkEmail);
// POST /api/v1/auth/change-password
router.post("/change-password", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(auth_validators_1.changePasswordSchema), authController.changePassword);
// POST /api/v1/auth/suggestions
router.post("/suggestions", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(auth_validators_1.suggestionsSchema), authController.getSuggestions);
// POST /api/v1/auth/onboarding
router.post("/onboarding", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(auth_validators_1.onboardingSchema), authController.completeOnboarding);
exports.default = router;
