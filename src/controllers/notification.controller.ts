import { Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { notificationService } from "../services/notification.service";
import logger from "../utils/logger.util";

/**
 * Get all notifications for the authenticated user
 */
export async function getNotifications(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const pageParam = Array.isArray(req.query.page)
      ? req.query.page[0]
      : req.query.page;
    const limitParam = Array.isArray(req.query.limit)
      ? req.query.limit[0]
      : req.query.limit;

    const page = parseInt(String(pageParam || "1")) || 1;
    const limit = parseInt(String(limitParam || "50")) || 50;

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 100) {
      return res.status(400).json({
        msg: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
      });
    }

    const result = await notificationService.getUserNotifications(
      userId,
      limit,
      page,
    );

    res.json({
      msg: "Notifications retrieved successfully",
      data: result.notifications,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("Get notifications error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Get unread notification count
 */
export async function getUnreadCount(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const count = await notificationService.getUnreadCount(userId);

    res.json({
      msg: "Unread count retrieved successfully",
      data: { count },
    });
  } catch (error) {
    logger.error("Get unread count error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Mark a notification as read
 */
export async function markAsRead(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const notificationId = String(req.params.notificationId);

    await notificationService.markAsRead(notificationId, userId);

    res.json({
      msg: "Notification marked as read",
    });
  } catch (error) {
    logger.error("Mark as read error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Mark all notifications as read
 */
export async function markAllAsRead(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;

    await notificationService.markAllAsRead(userId);

    res.json({
      msg: "All notifications marked as read",
    });
  } catch (error) {
    logger.error("Mark all as read error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const notificationId = String(req.params.notificationId);

    await notificationService.deleteNotification(notificationId, userId);

    res.json({
      msg: "Notification deleted successfully",
    });
  } catch (error) {
    logger.error("Delete notification error:", { error, userId: req.userId });
    res.status(500).json({ msg: "Internal server error" });
  }
}
