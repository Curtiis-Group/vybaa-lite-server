import { Router } from "express";
import { adminAuthMiddleware } from "../middleware/admin.middleware";
import * as featureFlagsController from "../controllers/feature-flags.controller";

const router: Router = Router();

// All admin routes require the simple admin secret header
router.use(adminAuthMiddleware);

// GET /api/v1/admin/feature-flags
router.get("/feature-flags", featureFlagsController.listFeatureFlags);

// POST /api/v1/admin/feature-flags
router.post("/feature-flags", featureFlagsController.upsertFeatureFlag);

export default router;

