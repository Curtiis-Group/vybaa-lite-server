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
const auth_middleware_1 = require("../middleware/auth.middleware");
const validation_middleware_1 = require("../middleware/validation.middleware");
const community_validators_1 = require("../validators/community.validators");
const communityController = __importStar(require("../controllers/community.controller"));
const router = (0, express_1.Router)();
// ==================== Community CRUD ====================
// POST /api/v1/communities - Create community
router.post("/", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.createCommunitySchema), communityController.createCommunity);
// GET /api/v1/communities - Get all communities (public feed)
router.get("/", auth_middleware_1.authMiddleware, communityController.getCommunities);
// GET /api/v1/communities/my - Get user's communities
router.get("/my", auth_middleware_1.authMiddleware, communityController.getMyCommunities);
// GET /api/v1/communities/:communityId - Get community by ID
router.get("/:communityId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.getCommunityById);
// PUT /api/v1/communities/:communityId - Update community
router.put("/:communityId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.updateCommunitySchema), communityController.updateCommunity);
// DELETE /api/v1/communities/:communityId - Delete community
router.delete("/:communityId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.deleteCommunity);
// ==================== Membership ====================
// POST /api/v1/communities/:communityId/join - Join community
router.post("/:communityId/join", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.joinCommunity);
// DELETE /api/v1/communities/:communityId/leave - Leave community
router.delete("/:communityId/leave", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.leaveCommunity);
// GET /api/v1/communities/:communityId/members - Get community members
router.get("/:communityId/members", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.getCommunityMembers);
// PUT /api/v1/communities/:communityId/members/role - Update member role
router.put("/:communityId/members/role", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.updateMemberRoleSchema), communityController.updateMemberRole);
// ==================== Goal Templates ====================
// POST /api/v1/communities/:communityId/templates - Create template
router.post("/:communityId/templates", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.createTemplateSchema), communityController.createTemplate);
// GET /api/v1/communities/:communityId/templates - Get templates
router.get("/:communityId/templates", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.getTemplates);
// GET /api/v1/communities/templates/:templateId - Get template by ID
router.get("/templates/:templateId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.templateIdParamSchema, "params"), communityController.getTemplateById);
// PUT /api/v1/communities/templates/:templateId - Update template
router.put("/templates/:templateId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.templateIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.updateTemplateSchema), communityController.updateTemplate);
// DELETE /api/v1/communities/templates/:templateId - Delete template
router.delete("/templates/:templateId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.templateIdParamSchema, "params"), communityController.deleteTemplate);
// POST /api/v1/communities/templates/:templateId/start - Start goal from template
router.post("/templates/:templateId/start", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.templateIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.startGoalFromTemplateSchema), communityController.startGoalFromTemplate);
// GET /api/v1/communities/templates/:templateId/participants - Get template participants with progress
router.get("/templates/:templateId/participants", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.templateIdParamSchema, "params"), communityController.getTemplateParticipants);
// ==================== Activity Feed ====================
// GET /api/v1/communities/:communityId/activity - Get activity feed
router.get("/:communityId/activity", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.getActivityFeed);
// POST /api/v1/communities/activity/:activityId/react - React to activity
router.post("/activity/:activityId/react", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.activityIdParamSchema, "params"), communityController.reactToActivity);
// POST /api/v1/communities/activity/:activityId/comments - Create comment
router.post("/activity/:activityId/comments", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.activityIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.createCommentSchema), communityController.createComment);
// GET /api/v1/communities/activity/:activityId/comments - Get comments
router.get("/activity/:activityId/comments", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.activityIdParamSchema, "params"), communityController.getComments);
// DELETE /api/v1/communities/activity/comments/:commentId - Delete comment
router.delete("/activity/comments/:commentId", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.commentIdParamSchema, "params"), communityController.deleteComment);
// ==================== Stats ====================
// GET /api/v1/communities/:communityId/stats - Get community stats
router.get("/:communityId/stats", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.getCommunityStats);
// ==================== Invites ====================
// POST /api/v1/communities/:communityId/invites - Create invite
router.post("/:communityId/invites", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), (0, validation_middleware_1.validate)(community_validators_1.createInviteSchema), communityController.createInvite);
// GET /api/v1/communities/:communityId/invites - List community invites (owner/mod only)
router.get("/:communityId/invites", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.communityIdParamSchema, "params"), communityController.getCommunityInvites);
// GET /api/v1/communities/invites/:code - Get invite details by code
router.get("/invites/:code", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.inviteCodeParamSchema, "params"), communityController.getInviteByCode);
// POST /api/v1/communities/invites/:code/join - Join community via invite code
router.post("/invites/:code/join", auth_middleware_1.authMiddleware, (0, validation_middleware_1.validate)(community_validators_1.inviteCodeParamSchema, "params"), communityController.joinByInviteCode);
// DELETE /api/v1/communities/invites/:inviteId - Revoke an invite
router.delete("/invites/:inviteId", auth_middleware_1.authMiddleware, communityController.revokeInvite);
exports.default = router;
