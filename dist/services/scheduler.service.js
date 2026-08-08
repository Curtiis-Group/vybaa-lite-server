"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerService = void 0;
const notification_service_1 = require("./notification.service");
const revenuecat_webhook_service_1 = require("./revenuecat-webhook.service");
const rewind_routine_service_1 = require("./rewind-routine.service");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
class SchedulerService {
    constructor() {
        this.intervalId = null;
        this.schedulingIntervalId = null;
        this.rewindLifecycleIntervalId = null;
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
        this.scheduleEngagementNotifications();
        this.schedulingIntervalId = setInterval(() => {
            this.scheduleGoalReminders();
            this.scheduleEngagementNotifications();
        }, 60 * 60 * 1000); // Every hour
        // Process pending notifications every minute
        this.processPendingNotifications();
        this.processRevenueCatWebhooks();
        this.intervalId = setInterval(() => {
            this.processPendingNotifications();
            this.processRevenueCatWebhooks();
        }, 60 * 1000); // Every minute
        // Rewind slots are account-local, so their lifecycle must be evaluated
        // every minute instead of against a server-wide UTC day.
        this.processRewindRoutineLifecycle();
        this.rewindLifecycleIntervalId = setInterval(() => {
            this.processRewindRoutineLifecycle();
        }, 60 * 1000);
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
        if (this.schedulingIntervalId) {
            clearInterval(this.schedulingIntervalId);
            this.schedulingIntervalId = null;
        }
        if (this.rewindLifecycleIntervalId) {
            clearInterval(this.rewindLifecycleIntervalId);
            this.rewindLifecycleIntervalId = null;
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
     * Schedule engagement notifications
     */
    async scheduleEngagementNotifications() {
        try {
            await notification_service_1.notificationService.scheduleEngagementNotifications();
        }
        catch (error) {
            logger_util_1.default.error("Error in scheduleEngagementNotifications:", error);
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
    async processRevenueCatWebhooks() {
        try {
            const processedCount = await (0, revenuecat_webhook_service_1.processPendingRevenueCatWebhooks)();
            if (processedCount) {
                logger_util_1.default.info("Processed RevenueCat webhooks", { processedCount });
            }
        }
        catch (error) {
            logger_util_1.default.error("Error processing RevenueCat webhooks", {
                errorName: error instanceof Error ? error.name : "UnknownError",
            });
        }
    }
    async processRewindRoutineLifecycle() {
        try {
            const result = await (0, rewind_routine_service_1.runRewindRoutineLifecycle)();
            if (result.finalizedCount ||
                result.missedCount ||
                result.reminderNotificationCount ||
                result.startNotificationCount) {
                logger_util_1.default.info("Processed Rewind routine lifecycle", result);
            }
        }
        catch (error) {
            logger_util_1.default.error("Error in Rewind routine lifecycle", {
                errorName: error instanceof Error ? error.name : "UnknownError",
            });
        }
    }
}
exports.schedulerService = new SchedulerService();
