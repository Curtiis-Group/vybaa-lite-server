"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotifications = getNotifications;
exports.getUnreadCount = getUnreadCount;
exports.markAsRead = markAsRead;
exports.markAllAsRead = markAllAsRead;
exports.deleteNotification = deleteNotification;
const notification_service_1 = require("../services/notification.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
/**
 * Get all notifications for the authenticated user
 */
async function getNotifications(req, res) {
    try {
        const userId = req.userId;
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
        const result = await notification_service_1.notificationService.getUserNotifications(userId, limit, page);
        res.json({
            msg: "Notifications retrieved successfully",
            data: result.notifications,
            pagination: result.pagination,
        });
    }
    catch (error) {
        logger_util_1.default.error("Get notifications error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Get unread notification count
 */
async function getUnreadCount(req, res) {
    try {
        const userId = req.userId;
        const count = await notification_service_1.notificationService.getUnreadCount(userId);
        res.json({
            msg: "Unread count retrieved successfully",
            data: { count },
        });
    }
    catch (error) {
        logger_util_1.default.error("Get unread count error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Mark a notification as read
 */
async function markAsRead(req, res) {
    try {
        const userId = req.userId;
        const notificationId = String(req.params.notificationId);
        await notification_service_1.notificationService.markAsRead(notificationId, userId);
        res.json({
            msg: "Notification marked as read",
        });
    }
    catch (error) {
        logger_util_1.default.error("Mark as read error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Mark all notifications as read
 */
async function markAllAsRead(req, res) {
    try {
        const userId = req.userId;
        await notification_service_1.notificationService.markAllAsRead(userId);
        res.json({
            msg: "All notifications marked as read",
        });
    }
    catch (error) {
        logger_util_1.default.error("Mark all as read error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
/**
 * Delete a notification
 */
async function deleteNotification(req, res) {
    try {
        const userId = req.userId;
        const notificationId = String(req.params.notificationId);
        await notification_service_1.notificationService.deleteNotification(notificationId, userId);
        res.json({
            msg: "Notification deleted successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Delete notification error:", { error, userId: req.userId });
        res.status(500).json({ msg: "Internal server error" });
    }
}
