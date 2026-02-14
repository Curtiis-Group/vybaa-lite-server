import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { updateProfileSchema } from "../validators/auth.validators";
import * as userController from "../controllers/user.controller";
import * as usernameController from "../controllers/username.controller";

const router: Router = Router();

// PUT /api/v1/users/me
router.put("/me", authMiddleware, validate(updateProfileSchema), userController.updateProfile);

// GET /api/v1/users/me
router.get("/me", authMiddleware, userController.getProfile);

// GET /api/v1/users/username/availability - Check username change cooldown
router.get("/username/availability", authMiddleware, userController.checkUsernameAvailability);

// GET /api/v1/users/username/check - Check if username is available (real-time)
router.get("/username/check", authMiddleware, usernameController.checkUsernameChangeAvailability);

// POST /api/v1/users/fcm-token
router.post("/fcm-token", authMiddleware, userController.registerFCMToken);

// DELETE /api/v1/users/fcm-token
router.delete("/fcm-token", authMiddleware, userController.removeFCMToken);

export default router;
