import { Router } from "express";
import authRoutes from "./auth.routes";
import userRoutes from "./user.routes";
import goalRoutes from "./goal.routes";
import insightsRoutes from "./insights.routes";
import uploadRoutes from "./upload.routes";
import notificationRoutes from "./notification.routes";
import achievementRoutes from "./achievement.routes";
import chillRoutes from "./chill.routes";
import journalRoutes from "./journal.routes";
import communityRoutes from "./community.routes";
import adminRoutes from "./admin.routes";
import logger from "../utils/logger.util";

const router: Router = Router();

// Health check endpoint
router.get("/health", (req, res) => {
    res.status(200).json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Root endpoint
router.get("/", (req, res) => {
    res.status(200).json({ 
        message: "Vybaa API Server",
        version: "1.0.0",
        status: "running"
    });
});

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

// Mount chill routes at /api/v1/chill
router.use("/v1/chill", chillRoutes);

// Mount journal routes at /api/v1/journals
router.use("/v1/journals", journalRoutes);

// Mount community routes at /api/v1/communities
router.use("/v1/communities", communityRoutes);

// Mount admin routes at /api/v1/admin
router.use("/v1/admin", adminRoutes);

// ==================== Dev-only client log bridge ====================
if (process.env.NODE_ENV !== "production") {
  router.post("/v1/debug/client-log", (req, res) => {
    const { level = "info", message, timestamp } = (req as any).body || {};

    const safeMessage =
      typeof message === "string" ? message : JSON.stringify(message ?? {});

    switch (level) {
      case "error":
        logger.error(safeMessage, { source: "client-console", timestamp });
        break;
      case "warn":
        logger.warn(safeMessage, { source: "client-console", timestamp });
        break;
      case "log":
      case "info":
      default:
        logger.info(safeMessage, { source: "client-console", timestamp });
        break;
    }

    res.status(204).end();
  });
}

export default router;
