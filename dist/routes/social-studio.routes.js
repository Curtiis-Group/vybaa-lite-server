"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const socialController = __importStar(require("../controllers/social-studio.controller"));
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const social_validators_1 = require("../validators/social.validators");
const router = (0, express_1.Router)();
router.get("/oauth/callback", socialController.xOAuthCallback);
router.use(auth_middleware_1.authMiddleware);
router.use((req, res, next) => {
    if (req.clientApp !== "vybaa") {
        res.status(404).json({ msg: "Social Studio is not available here." });
        return;
    }
    next();
});
router.get("/studio", socialController.getStudio);
router.post("/oauth/start", (0, validation_middleware_1.validate)(social_validators_1.xOAuthStartSchema), socialController.startXOAuth);
router.delete("/connection", socialController.disconnectX);
router.put("/preferences", (0, validation_middleware_1.validate)(social_validators_1.updateSocialPreferencesSchema), socialController.updatePreferences);
router.post("/mentions/sync", socialController.syncMentions);
router.post("/mentions/:mentionId/reply-draft", (0, validation_middleware_1.validate)(social_validators_1.socialMentionIdParamSchema, "params"), socialController.generateReplyDraft);
router.post("/drafts", (0, validation_middleware_1.validate)(social_validators_1.generateSocialPostDraftSchema), socialController.generatePostDraft);
router.patch("/drafts/:draftId", (0, validation_middleware_1.validate)(social_validators_1.socialDraftIdParamSchema, "params"), (0, validation_middleware_1.validate)(social_validators_1.updateSocialDraftSchema), socialController.updateDraft);
router.delete("/drafts/:draftId", (0, validation_middleware_1.validate)(social_validators_1.socialDraftIdParamSchema, "params"), socialController.discardDraft);
router.post("/drafts/:draftId/publish", (0, validation_middleware_1.validate)(social_validators_1.socialDraftIdParamSchema, "params"), socialController.publishDraft);
exports.default = router;
