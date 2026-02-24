import chalk from "chalk";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import winston from "winston";

const logDir = "logs";

// Create logs directory if it doesn't exist
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, service,  ...meta }) => {


    let msg = `${chalk.bold(chalk.blue(`[${service}]`))}[${level}][${chalk.yellow(timestamp)}]=> ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Determine log level from environment
const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");

// Create logger instance
const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: "vybaa-lite-server" },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: process.env.NODE_ENV === "production" ? logFormat : consoleFormat,
    }),
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // Write all logs to `combined.log`
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Create a stream object for Morgan HTTP request logging
// Using any to avoid type conflicts with Winston's stream property
(logger as any).stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};

export default logger;
