import { notificationService } from "./notification.service";
import { processPendingRevenueCatWebhooks } from "./revenuecat-webhook.service";
import { runRewindRoutineLifecycle } from "./rewind-routine.service";
import logger from "../utils/logger.util";

class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private schedulingIntervalId: NodeJS.Timeout | null = null;
  private rewindLifecycleIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the scheduler
   */
  start() {
    if (this.isRunning) {
      logger.warn("Scheduler is already running");
      return;
    }

    logger.info("Starting notification scheduler...");
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

    logger.info("Notification scheduler started successfully");
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (!this.isRunning) {
      logger.warn("Scheduler is not running");
      return;
    }

    logger.info("Stopping notification scheduler...");
    
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
    logger.info("Notification scheduler stopped");
  }

  /**
   * Schedule goal reminders
   */
  private async scheduleGoalReminders() {
    try {
      await notificationService.scheduleGoalReminders();
    } catch (error) {
      logger.error("Error in scheduleGoalReminders:", error);
    }
  }

  /**
   * Schedule engagement notifications
   */
  private async scheduleEngagementNotifications() {
    try {
      await notificationService.scheduleEngagementNotifications();
    } catch (error) {
      logger.error("Error in scheduleEngagementNotifications:", error);
    }
  }

  /**
   * Process pending notifications
   */
  private async processPendingNotifications() {
    try {
      await notificationService.processPendingNotifications();
    } catch (error) {
      logger.error("Error in processPendingNotifications:", error);
    }
  }

  private async processRevenueCatWebhooks(): Promise<void> {
    try {
      const processedCount = await processPendingRevenueCatWebhooks();
      if (processedCount) {
        logger.info("Processed RevenueCat webhooks", { processedCount });
      }
    } catch (error) {
      logger.error("Error processing RevenueCat webhooks", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  private async processRewindRoutineLifecycle() {
    try {
      const result = await runRewindRoutineLifecycle();
      if (
        result.finalizedCount ||
        result.missedCount ||
        result.reminderNotificationCount ||
        result.startNotificationCount
      ) {
        logger.info("Processed Rewind routine lifecycle", result);
      }
    } catch (error) {
      logger.error("Error in Rewind routine lifecycle", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}

export const schedulerService = new SchedulerService();
