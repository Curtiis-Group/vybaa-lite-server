import chalk from "chalk";
import "dotenv/config";
import { mkdirSync } from "fs";
import path from "path";
import winston from "winston";

const logDir = "logs";

mkdirSync(logDir, { recursive: true });

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const logLevel = (
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "production" ? "info" : "debug")
).toLowerCase();
const verboseConsoleOutput = ["debug", "silly", "verbose"].includes(logLevel);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm MM/DD" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.printf((info) => {
    const level = String(info.level ?? "info");
    const context: Record<string, unknown> = {};
    let errorStack: string | undefined =
      typeof info.stack === "string" ? info.stack : undefined;

    for (const [key, value] of Object.entries(info)) {
      if (
        ["errorStack", "level", "message", "service", "stack", "timestamp"].includes(
          key,
        )
      ) {
        if (key === "errorStack" && typeof value === "string") {
          errorStack ??= value;
        }
        continue;
      }
      context[key] = value;
    }

    const splatValue: unknown = Reflect.get(info, Symbol.for("splat"));
    if (Array.isArray(splatValue)) {
      for (const value of splatValue) {
        if (value instanceof Error) {
          context.errorName = value.name;
          context.errorMessage = value.message;
          errorStack ??= value.stack;
          continue;
        }
        if (isRecord(value)) {
          for (const [key, entryValue] of Object.entries(value)) {
            if (key === "errorStack" && typeof entryValue === "string") {
              errorStack ??= entryValue;
              continue;
            }
            context[key] = entryValue;
          }
          continue;
        }
        context.details = value;
      }
    }

    const message =
      typeof info.message === "string"
        ? info.message
        : serializeLogValue(info.message);
    const conciseHttpContext = formatHttpConsoleContext(message, context);
    const displayedMessage = !verboseConsoleOutput && conciseHttpContext
      ? conciseHttpContext.trim()
      : message;
    const contextSuffix = verboseConsoleOutput && Object.keys(context).length
      ? ` ${chalk.dim(`context=${serializeLogValue(context)}`)}`
      : "";
    const stackSuffix =
      errorStack &&
      verboseConsoleOutput &&
      (process.env.LOG_STACKS === "true" || level === "error")
        ? `\n${chalk.dim(errorStack)}`
        : "";

    return `[${chalk.yellow(String(info.timestamp ?? ""))}]|${colorizeLevel(level)}| ${displayedMessage}${contextSuffix}${stackSuffix}`;
  }),
);

const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  defaultMeta: { service: "vybaa-lite-server" },
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

function colorizeLevel(level: string): string {
  const label = level.toUpperCase().padEnd(5, "");
  switch (level.toLowerCase()) {
    case "error":
      return chalk.red(label);
    case "warn":
      return chalk.yellow(label);
    case "debug":
      return chalk.cyan(label);
    case "verbose":
      return chalk.magenta(label);
    default:
      return chalk.green(label);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactLogValue(value: unknown, key?: string, depth = 0): unknown {
  if (key && isSensitiveLogKey(key)) {
    return "[REDACTED]";
  }
  if (depth >= 4) {
    return "[TRUNCATED]";
  }
  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}…[TRUNCATED]` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactLogValue(item, undefined, depth + 1));
  }
  if (isRecord(value)) {
    const redacted: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      redacted[childKey] = redactLogValue(childValue, childKey, depth + 1);
    }
    return redacted;
  }
  return value;
}

function isSensitiveLogKey(key: string): boolean {
  const normalizedKey = key
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return (
    normalizedKey === "token" ||
    normalizedKey.endsWith("_token") ||
    normalizedKey.includes("api_key") ||
    normalizedKey.includes("authorization") ||
    normalizedKey.includes("cookie") ||
    normalizedKey.includes("password") ||
    normalizedKey.includes("secret")
  );
}

function serializeLogValue(value: unknown): string {
  try {
    const serialized = JSON.stringify(redactLogValue(value));
    return serialized ?? String(value);
  } catch {
    return "[Unserializable]";
  }
}

export function redactRequestPath(requestPath: string): string {
  const queryStart = requestPath.indexOf("?");
  if (queryStart < 0) return requestPath;
  const pathName = requestPath.slice(0, queryStart);
  const query = requestPath.slice(queryStart + 1);
  if (!query) return requestPath;

  const params = new URLSearchParams(query);
  let redacted = false;
  for (const key of [...params.keys()]) {
    if (!isSensitiveRequestParameter(key)) continue;
    params.set(key, "REDACTED");
    redacted = true;
  }
  return redacted ? `${pathName}?${params.toString()}` : requestPath;
}

function isSensitiveRequestParameter(key: string): boolean {
  return isSensitiveLogKey(key) || /^(code|signature|sig)$/i.test(key);
}

function formatHttpConsoleContext(
  message: string,
  context: Record<string, unknown>,
): string {
  if (!message.startsWith("HTTP request")) return "";
  const method = typeof context.method === "string" ? context.method : null;
  const requestPath =
    typeof context.path === "string"
      ? redactRequestPath(context.path)
      : null;
  const requestLabel = [method, requestPath].filter(
    (value): value is string => Boolean(value),
  ).join(" ");
  if (!requestLabel) return "";
  if (message === "HTTP request started") {
    return ` ${chalk.cyan("→")} ${requestLabel}`;
  }

  const status = typeof context.status === "number" ? context.status : null;
  let marker = chalk.green("✓");
  if (
    message === "HTTP request closed before response completed" ||
    (status !== null && status >= 500)
  ) {
    marker = chalk.red("✕");
  } else if (status !== null && status >= 400) {
    marker = chalk.yellow("!");
  }
  const details: string[] = [marker];
  if (status !== null) {
    const statusColor = status >= 400 ? chalk.yellow : chalk.green;
    details.push(statusColor(String(status)));
  }
  if (typeof context.durationMs === "number") {
    details.push(chalk.dim(`${Math.round(context.durationMs)}ms`));
  }
  const statusDetails = details.slice(1);
  const detailSuffix = statusDetails.length
    ? ` ${statusDetails.join(" · ")}`
    : "";
  return ` ${details[0]} ${requestLabel}${detailSuffix}`;
}

function writeLogStream(message: string): void {
  const trimmedMessage = message.trim();
  if (trimmedMessage) {
    logger.info(trimmedMessage);
  }
}

const loggerWithStream = Object.assign(logger, {
  stream: { write: writeLogStream },
});

export default loggerWithStream;
