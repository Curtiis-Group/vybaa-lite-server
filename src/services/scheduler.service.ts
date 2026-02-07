import { notificationService } from "./notification.service";
import logger from "../utils/logger.util";

class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
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
    setInterval(() => {
      this.scheduleGoalReminders();
    }, 60 * 60 * 1000); // Every hour

    // Process pending notifications every minute
    this.processPendingNotifications();
    this.intervalId = setInterval(() => {
      this.processPendingNotifications();
    }, 60 * 1000); // Every minute

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
   * Process pending notifications
   */
  private async processPendingNotifications() {
    try {
      await notificationService.processPendingNotifications();
    } catch (error) {
      logger.error("Error in processPendingNotifications:", error);
    }
  }
}

export const schedulerService = new SchedulerService();
