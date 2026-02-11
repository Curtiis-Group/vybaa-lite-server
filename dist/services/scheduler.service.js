"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerService = void 0;
const notification_service_1 = require("./notification.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
class SchedulerService {
    constructor() {
        this.intervalId = null;
        this.isRunning = false;
    }
    /**
     * Start the scheduler
     */
    start() {
        if (this.isRunning) {
            logger_util_1.default.warn("Scheduler is already running");
            return;
        }
        logger_util_1.default.info("Starting notification scheduler...");
        this.isRunning = true;
        // Schedule goal reminders every hour
        this.scheduleGoalReminders();
        setInterval(() => {
            this.scheduleGoalReminders();
        }, 60 * 60 * 1000); // Every hour
        // Process pending notifications every minute
        this.processPendingNotifications();
        this.intervalId = setInterval(() => {
            this.processPendingNotifications();
        }, 60 * 1000); // Every minute
        logger_util_1.default.info("Notification scheduler started successfully");
    }
    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            logger_util_1.default.warn("Scheduler is not running");
            return;
        }
        logger_util_1.default.info("Stopping notification scheduler...");
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        logger_util_1.default.info("Notification scheduler stopped");
    }
    /**
     * Schedule goal reminders
     */
    async scheduleGoalReminders() {
        try {
            await notification_service_1.notificationService.scheduleGoalReminders();
        }
        catch (error) {
            logger_util_1.default.error("Error in scheduleGoalReminders:", error);
        }
    }
    /**
     * Process pending notifications
     */
    async processPendingNotifications() {
        try {
            await notification_service_1.notificationService.processPendingNotifications();
        }
        catch (error) {
            logger_util_1.default.error("Error in processPendingNotifications:", error);
        }
    }
}
exports.schedulerService = new SchedulerService();
