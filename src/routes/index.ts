import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import goalRoutes from "./goal.routes";
import insightsRoutes from "./insights.routes";

const router: Router = Router();

// Mount auth routes at /api/v1/auth
router.use("/v1/auth", authRoutes);

// Mount user routes at /api/v1/users
router.use("/v1/users", userRoutes);

// Mount goal routes at /api/v1/goals
router.use("/v1/goals", goalRoutes);

// Mount insights routes at /api/v1/insights
router.use("/v1/insights", insightsRoutes);

export default router;
