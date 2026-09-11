import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  accountConfirmationSchema,
  appleAuthSchema,
  changePasswordSchema,
  emailParamSchema,
  googleAuthSchema,
  loginSchema,
  logoutSchema,
  onboardingSchema,
  refreshTokenSchema,
  registerSchema,
  requestConfirmationSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  suggestionsSchema,
  verifyOTPSchema,
} from "../validators/auth.validators";
import * as authController from "../controllers/auth.controller";

const router: Router = Router();

// POST /api/v1/auth/login
router.post("/login", validate(loginSchema), authController.login);

// POST /api/v1/auth/register
router.post("/register", validate(registerSchema), authController.register);

// POST /api/v1/auth/google
router.post("/google", validate(googleAuthSchema), authController.googleAuth);

// POST /api/v1/auth/apple
router.post("/apple", validate(appleAuthSchema), authController.appleAuth);

// POST /api/v1/auth/session
router.post("/session", authMiddleware, authController.getSession);

// POST /api/v1/auth/refresh-token
router.post("/refresh-token", validate(refreshTokenSchema), authController.refreshToken);

// POST /api/v1/auth/logout
router.post("/logout", authMiddleware, validate(logoutSchema), authController.logout);

// POST /api/v1/auth/request-validation
router.post("/request-validation", validate(requestPasswordResetSchema), authController.requestPasswordReset);

// POST /api/v1/auth/verify-recovery-code
router.post("/verify-recovery-code", validate(verifyOTPSchema), authController.verifyRecoveryCode);

// POST /api/v1/auth/recover-account
router.post("/recover-account", validate(resetPasswordSchema), authController.recoverAccount);

// POST /api/v1/auth/request-confirmation
router.post("/request-confirmation", validate(requestConfirmationSchema), authController.requestConfirmation);

// POST /api/v1/auth/account-confirmation
router.post("/account-confirmation", validate(accountConfirmationSchema), authController.accountConfirmation);

// GET /api/v1/auth/email-check/:email
router.get("/email-check/:email", validate(emailParamSchema, "params"), authController.checkEmail);

// POST /api/v1/auth/change-password
router.post("/change-password", authMiddleware, validate(changePasswordSchema), authController.changePassword);

// POST /api/v1/auth/suggestions
router.post("/suggestions", authMiddleware, validate(suggestionsSchema), authController.getSuggestions);

// POST /api/v1/auth/onboarding
router.post("/onboarding", authMiddleware, validate(onboardingSchema), authController.completeOnboarding);

export default router;
