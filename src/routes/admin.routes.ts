import { Router } from "express";
import * as adminStatsController from "../controllers/admin-stats.controller";
import { adminAuthMiddleware } from "../middleware/admin.middleware";
import * as featureFlagsController from "../controllers/feature-flags.controller";
import * as moderationController from "../controllers/moderation.controller";

const router: Router = Router();

// All admin routes require the simple admin secret header
router.use(adminAuthMiddleware);

// GET /api/v1/admin/feature-flags
router.get("/feature-flags", featureFlagsController.listFeatureFlags);

// GET /api/v1/admin/stats
router.get("/stats", adminStatsController.getAdminStats);

// POST /api/v1/admin/feature-flags
router.post("/feature-flags", featureFlagsController.upsertFeatureFlag);

// Moderation queue for timely review of user-generated content reports.
router.get("/moderation/reports", moderationController.listReports);
router.patch(
  "/moderation/reports/:reportId",
  moderationController.updateReport,
);

export default router;
