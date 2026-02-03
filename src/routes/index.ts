import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import goalRoutes from "./goal.routes";

const router: Router = Router();

// Mount auth routes at /api/v1/auth
router.use("/v1/auth", authRoutes);

// Mount user routes at /api/v1/users
router.use("/v1/users", userRoutes);

// Mount goal routes at /api/v1/goals
router.use("/v1/goals", goalRoutes);

export default router;
