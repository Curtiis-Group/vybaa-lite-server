import { Router } from "express";

import * as socialController from "../controllers/social-studio.controller";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  generateSocialPostDraftSchema,
  socialActivityConsentSchema,
  socialDraftIdParamSchema,
  socialMentionIdParamSchema,
  socialSuggestionRefreshSchema,
  updateSocialDraftSchema,
  updateSocialPreferencesSchema,
  xOAuthStartSchema,
} from "../validators/social.validators";

const router: Router = Router();

router.get("/oauth/callback", socialController.xOAuthCallback);

router.use(authMiddleware);
router.use((req, res, next) => {
  if (req.clientApp !== "vybaa") {
    res.status(404).json({ msg: "Social Studio is not available here." });
    return;
  }
  next();
});
router.get("/studio", socialController.getStudio);
router.put(
  "/studio/activity-consent",
  validate(socialActivityConsentSchema),
  socialController.updateActivityConsent,
);
router.post(
  "/studio/suggestions/refresh",
  validate(socialSuggestionRefreshSchema),
  socialController.refreshSuggestions,
);
router.post(
  "/oauth/start",
  validate(xOAuthStartSchema),
  socialController.startXOAuth,
);
router.delete("/connection", socialController.disconnectX);
router.put(
  "/preferences",
  validate(updateSocialPreferencesSchema),
  socialController.updatePreferences,
);
router.post("/mentions/sync", socialController.syncMentions);
router.post(
  "/mentions/:mentionId/reply-draft",
  validate(socialMentionIdParamSchema, "params"),
  socialController.generateReplyDraft,
);
router.post(
  "/drafts",
  validate(generateSocialPostDraftSchema),
  socialController.generatePostDraft,
);
router.patch(
  "/drafts/:draftId",
  validate(socialDraftIdParamSchema, "params"),
  validate(updateSocialDraftSchema),
  socialController.updateDraft,
);
router.delete(
  "/drafts/:draftId",
  validate(socialDraftIdParamSchema, "params"),
  socialController.discardDraft,
);
router.post(
  "/drafts/:draftId/publish",
  validate(socialDraftIdParamSchema, "params"),
  socialController.publishDraft,
);

export default router;
