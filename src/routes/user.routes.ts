import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import { updateProfileSchema } from "../validators/auth.validators";
import * as userController from "../controllers/user.controller";

const router: Router = Router();

// PUT /api/v1/users/me
router.put("/me", authMiddleware, validate(updateProfileSchema), userController.updateProfile);

// GET /api/v1/users/me
router.get("/me", authMiddleware, userController.getProfile);

export default router;
