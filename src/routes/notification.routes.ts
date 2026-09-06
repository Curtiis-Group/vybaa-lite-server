import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as notificationController from "../controllers/notification.controller";

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all notifications
router.get("/", notificationController.getNotifications);

// Get unread count
router.get("/unread-count", notificationController.getUnreadCount);

// Mark notification as read
router.patch("/:notificationId/read", notificationController.markAsRead);

// Mark all as read
router.patch("/read-all", notificationController.markAllAsRead);

// Delete notification
router.delete("/:notificationId", notificationController.deleteNotification);

export default router;
