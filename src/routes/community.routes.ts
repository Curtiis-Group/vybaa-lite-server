import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { validate } from "../middleware/validation.middleware";
import {
  createCommunitySchema,
  updateCommunitySchema,
  communityIdParamSchema,
  createTemplateSchema,
  updateTemplateSchema,
  templateIdParamSchema,
  startGoalFromTemplateSchema,
  joinCommunitySchema,
  updateMemberRoleSchema,
  createCommentSchema,
  activityIdParamSchema,
  commentIdParamSchema,
} from "../validators/community.validators";
import * as communityController from "../controllers/community.controller";

const router: Router = Router();

// ==================== Community CRUD ====================

// POST /api/v1/communities - Create community
router.post("/", authMiddleware, validate(createCommunitySchema), communityController.createCommunity);

// GET /api/v1/communities - Get all communities (public feed)
router.get("/", authMiddleware, communityController.getCommunities);

// GET /api/v1/communities/my - Get user's communities
router.get("/my", authMiddleware, communityController.getMyCommunities);

// GET /api/v1/communities/:communityId - Get community by ID
router.get("/:communityId", authMiddleware, validate(communityIdParamSchema, "params"), communityController.getCommunityById);

// PUT /api/v1/communities/:communityId - Update community
router.put("/:communityId", authMiddleware, validate(communityIdParamSchema, "params"), validate(updateCommunitySchema), communityController.updateCommunity);

// DELETE /api/v1/communities/:communityId - Delete community
router.delete("/:communityId", authMiddleware, validate(communityIdParamSchema, "params"), communityController.deleteCommunity);

// ==================== Membership ====================

// POST /api/v1/communities/:communityId/join - Join community
router.post("/:communityId/join", authMiddleware, validate(communityIdParamSchema, "params"), communityController.joinCommunity);

// DELETE /api/v1/communities/:communityId/leave - Leave community
router.delete("/:communityId/leave", authMiddleware, validate(communityIdParamSchema, "params"), communityController.leaveCommunity);

// GET /api/v1/communities/:communityId/members - Get community members
router.get("/:communityId/members", authMiddleware, validate(communityIdParamSchema, "params"), communityController.getCommunityMembers);

// PUT /api/v1/communities/:communityId/members/role - Update member role
router.put("/:communityId/members/role", authMiddleware, validate(communityIdParamSchema, "params"), validate(updateMemberRoleSchema), communityController.updateMemberRole);

// ==================== Goal Templates ====================

// POST /api/v1/communities/:communityId/templates - Create template
router.post("/:communityId/templates", authMiddleware, validate(communityIdParamSchema, "params"), validate(createTemplateSchema), communityController.createTemplate);

// GET /api/v1/communities/:communityId/templates - Get templates
router.get("/:communityId/templates", authMiddleware, validate(communityIdParamSchema, "params"), communityController.getTemplates);

// GET /api/v1/communities/templates/:templateId - Get template by ID
router.get("/templates/:templateId", authMiddleware, validate(templateIdParamSchema, "params"), communityController.getTemplateById);

// PUT /api/v1/communities/templates/:templateId - Update template
router.put("/templates/:templateId", authMiddleware, validate(templateIdParamSchema, "params"), validate(updateTemplateSchema), communityController.updateTemplate);

// DELETE /api/v1/communities/templates/:templateId - Delete template
router.delete("/templates/:templateId", authMiddleware, validate(templateIdParamSchema, "params"), communityController.deleteTemplate);

// POST /api/v1/communities/templates/:templateId/start - Start goal from template
router.post("/templates/:templateId/start", authMiddleware, validate(templateIdParamSchema, "params"), validate(startGoalFromTemplateSchema), communityController.startGoalFromTemplate);

// GET /api/v1/communities/templates/:templateId/participants - Get template participants with progress
router.get("/templates/:templateId/participants", authMiddleware, validate(templateIdParamSchema, "params"), communityController.getTemplateParticipants);

// ==================== Activity Feed ====================

// GET /api/v1/communities/:communityId/activity - Get activity feed
router.get("/:communityId/activity", authMiddleware, validate(communityIdParamSchema, "params"), communityController.getActivityFeed);

// POST /api/v1/communities/activity/:activityId/react - React to activity
router.post("/activity/:activityId/react", authMiddleware, validate(activityIdParamSchema, "params"), communityController.reactToActivity);

// POST /api/v1/communities/activity/:activityId/comments - Create comment
router.post("/activity/:activityId/comments", authMiddleware, validate(activityIdParamSchema, "params"), validate(createCommentSchema), communityController.createComment);

// GET /api/v1/communities/activity/:activityId/comments - Get comments
router.get("/activity/:activityId/comments", authMiddleware, validate(activityIdParamSchema, "params"), communityController.getComments);

// DELETE /api/v1/communities/activity/comments/:commentId - Delete comment
router.delete("/activity/comments/:commentId", authMiddleware, validate(commentIdParamSchema, "params"), communityController.deleteComment);

// ==================== Stats ====================

// GET /api/v1/communities/:communityId/stats - Get community stats
router.get("/:communityId/stats", authMiddleware, validate(communityIdParamSchema, "params"), communityController.getCommunityStats);

export default router;
