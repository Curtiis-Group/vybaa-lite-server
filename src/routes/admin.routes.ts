import { Router } from "express";
import * as adminRecordsController from "../controllers/admin-records.controller";
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

// Paginated admin records and detail views.
router.get("/users", adminRecordsController.listUsers);
router.get("/users/:userId", adminRecordsController.getUser);
router.get("/goals", adminRecordsController.listGoals);
router.get("/goals/:goalId", adminRecordsController.getGoal);
router.get("/rewinds", adminRecordsController.listRewinds);
router.get("/rewinds/:rewindId", adminRecordsController.getRewind);
router.get("/communities", adminRecordsController.listCommunities);
router.get("/communities/:communityId", adminRecordsController.getCommunity);
router.get("/activity", adminRecordsController.listActivity);
router.get("/activity/:activityId", adminRecordsController.getActivity);

// POST /api/v1/admin/feature-flags
router.post("/feature-flags", featureFlagsController.upsertFeatureFlag);

// Moderation queue for timely review of user-generated content reports.
router.get("/moderation/reports", moderationController.listReports);
router.patch(
  "/moderation/reports/:reportId",
  moderationController.updateReport,
);

export default router;
