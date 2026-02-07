import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import goalRoutes from "./goal.routes";
import insightsRoutes from "./insights.routes";
import uploadRoutes from "./upload.routes";
import notificationRoutes from "./notification.routes";
import achievementRoutes from "./achievement.routes";

const router: Router = Router();

// Mount auth routes at /api/v1/auth
router.use("/v1/auth", authRoutes);

// Mount user routes at /api/v1/users
router.use("/v1/users", userRoutes);

// Mount goal routes at /api/v1/goals
router.use("/v1/goals", goalRoutes);

// Mount insights routes at /api/v1/insights
router.use("/v1/insights", insightsRoutes);

// Mount upload routes at /api/v1/upload
router.use("/v1/upload", uploadRoutes);

// Mount notification routes at /api/v1/notifications
router.use("/v1/notifications", notificationRoutes);

// Mount achievement routes at /api/v1/achievements
router.use("/v1/achievements", achievementRoutes);

export default router;
