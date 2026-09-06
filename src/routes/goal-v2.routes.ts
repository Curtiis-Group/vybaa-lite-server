import { Router } from "express";

import * as goalController from "../controllers/goal-v2.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  conclusionReviewSchema,
  createGoalV2Schema,
  goalV2IdParamSchema,
  listGoalOccurrencesQuerySchema,
  listGoalsV2QuerySchema,
  quickGoalSetupSchema,
  occurrenceIdParamSchema,
  recordGoalProgressSchema,
  rescheduleOccurrenceSchema,
  resumeGoalSchema,
  updateGoalV2Schema,
} from "../validators/goal-v2.validators";

const router: Router = Router();

router.use(authMiddleware);
router.get("/", validate(listGoalsV2QuerySchema, "query"), goalController.list);
router.post(
  "/quick-setup",
  validate(quickGoalSetupSchema),
  goalController.quickSetup,
);
router.post("/", validate(createGoalV2Schema), goalController.create);
router.get("/legacy", goalController.listLegacy);
router.post(
  "/legacy/:goalId/reopen",
  validate(goalV2IdParamSchema, "params"),
  goalController.reopenLegacy,
);
router.patch(
  "/legacy/:goalId/archive",
  validate(goalV2IdParamSchema, "params"),
  goalController.archiveLegacy,
);
router.delete(
  "/legacy/:goalId",
  validate(goalV2IdParamSchema, "params"),
  goalController.deleteLegacy,
);
router.get(
  "/:goalId",
  validate(goalV2IdParamSchema, "params"),
  goalController.detail,
);
router.patch(
  "/:goalId",
  validate(goalV2IdParamSchema, "params"),
  validate(updateGoalV2Schema),
  goalController.update,
);
router.delete(
  "/:goalId",
  validate(goalV2IdParamSchema, "params"),
  goalController.permanentlyDelete,
);
router.get(
  "/:goalId/occurrences",
  validate(goalV2IdParamSchema, "params"),
  validate(listGoalOccurrencesQuerySchema, "query"),
  goalController.occurrences,
);
router.post(
  "/:goalId/occurrences/:occurrenceId/progress",
  validate(occurrenceIdParamSchema, "params"),
  validate(recordGoalProgressSchema),
  goalController.recordProgress,
);
router.patch(
  "/:goalId/occurrences/:occurrenceId/progress",
  validate(occurrenceIdParamSchema, "params"),
  validate(recordGoalProgressSchema),
  goalController.correctProgress,
);
router.delete(
  "/:goalId/occurrences/:occurrenceId/progress",
  validate(occurrenceIdParamSchema, "params"),
  goalController.undoProgress,
);
router.patch(
  "/:goalId/occurrences/:occurrenceId/reschedule",
  validate(occurrenceIdParamSchema, "params"),
  validate(rescheduleOccurrenceSchema),
  goalController.reschedule,
);
router.post(
  "/:goalId/pause",
  validate(goalV2IdParamSchema, "params"),
  goalController.pause,
);
router.post(
  "/:goalId/resume",
  validate(goalV2IdParamSchema, "params"),
  validate(resumeGoalSchema),
  goalController.resume,
);
router.post(
  "/:goalId/abandon",
  validate(goalV2IdParamSchema, "params"),
  goalController.abandon,
);
router.post(
  "/:goalId/archive",
  validate(goalV2IdParamSchema, "params"),
  goalController.archive,
);
router.post(
  "/:goalId/reopen",
  validate(goalV2IdParamSchema, "params"),
  goalController.reopen,
);
router.patch(
  "/:goalId/conclusion/review",
  validate(goalV2IdParamSchema, "params"),
  validate(conclusionReviewSchema),
  goalController.updateReview,
);

export default router;
