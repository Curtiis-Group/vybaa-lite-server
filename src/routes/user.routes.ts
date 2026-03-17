import { Router } from "express";
import { authMiddleware, optionalAuthMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { updateProfileSchema } from "../validators/auth.validators";
import * as userController from "../controllers/user.controller";
import * as usernameController from "../controllers/username.controller";
import * as rewardsController from "../controllers/rewards.controller";
import * as walletController from "../controllers/wallet.controller";

const router: Router = Router();

// PUT /api/v1/users/me
router.put("/me", authMiddleware, validate(updateProfileSchema), userController.updateProfile);

// GET /api/v1/users/me
router.get("/me", authMiddleware, userController.getProfile);

// GET /api/v1/users/username/availability - Check username change cooldown
router.get("/username/availability", optionalAuthMiddleware, userController.checkUsernameAvailability);

// GET /api/v1/users/username/check - Check if username is available (real-time)
router.get("/username/check", optionalAuthMiddleware, usernameController.checkUsernameChangeAvailability);

// POST /api/v1/users/fcm-token
router.post("/fcm-token", authMiddleware, userController.registerFCMToken);

// DELETE /api/v1/users/fcm-token
router.delete("/fcm-token", authMiddleware, userController.removeFCMToken);

// GET /api/v1/users/rewards
router.get("/rewards", authMiddleware, rewardsController.getRewards);

// GET /api/v1/users/wallet
router.get("/wallet", authMiddleware, walletController.getWallet);

// POST /api/v1/users/wallet/paystack/initialize
router.post(
  "/wallet/paystack/initialize",
  authMiddleware,
  walletController.initPaystackFunding,
);

// POST /api/v1/users/wallet/polar/initialize
router.post(
  "/wallet/polar/initialize",
  authMiddleware,
  walletController.initPolarFunding,
);

export default router;
