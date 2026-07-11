import chalk from "chalk";
import { NextFunction, Request, Response } from "express";
import { metricsService } from "../services/metrics.service";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  const methodColor = (method: string) => {
    switch (method) {
      case "GET":
        return chalk.green(method);
      case "POST":
        return chalk.blue(method);
      case "PUT":
        return chalk.yellow(method);
      case "PATCH":
        return chalk.magenta(method);
      case "DELETE":
        return chalk.red(method);
      default:
        return chalk.white(method);
    }
  };

  const statusColor = (code: number) => {
    if (code >= 500) return chalk.red(code);
    if (code >= 400) return chalk.yellow(code);
    if (code >= 300) return chalk.cyan(code);
    return chalk.green(code);
  };

  const body =
    shouldLogBody(req.method, req.path) && req.body
      ? chalk.gray(` body=${JSON.stringify(sanitizeBody(req.body))}`)
      : "";

  console.log(
    `${chalk.dim("→")} ${methodColor(req.method)} ${chalk.white(
      req.path
    )}${body}`
  );

  const originalSend = res.send;

  res.send = function (data) {
    const duration = Date.now() - start;

    console.log(
      //put the datestamp i this format 2026-02-24 13:28:31
      `[${chalk.yellow(new Date().toISOString())}]${chalk.dim("←")} ${methodColor(req.method)} ${chalk.white(
        req.path
      )} ${statusColor(res.statusCode)} ${chalk.gray(`${duration}ms`)} ${chalk.dim(
        req.ip
      )} `
    );

    console.log(`\n`)

    // Fire-and-forget metrics record; do not await to avoid impacting latency.
    metricsService
      .record("http_request_duration_ms", duration, {
        route: req.route?.path ?? req.path,
        method: req.method,
        status: res.statusCode,
      })
      .catch(() => {});

    return originalSend.call(this, data);
  };

  next();
}

// Determine if request body should be logged
function shouldLogBody(method: string, path: string): boolean {
  // Don't log sensitive endpoints
  const sensitivePaths = ["/auth/login", "/auth/register", "/auth/google"];
  if (sensitivePaths.some((p) => path.includes(p))) {
    return false;
  }

  // Only log body for POST, PUT, PATCH
  return ["POST", "PUT", "PATCH"].includes(method);
}

// Sanitize request body to remove sensitive information
function sanitizeBody(body: any): any {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sensitiveFields = ["password", "currentPassword", "newPassword", "token", "refreshToken", "otp", "otpCode"];
  const sanitized = { ...body };

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }

  // Remove base64 image data from logs
  if (sanitized.image && typeof sanitized.image === 'string' && sanitized.image.startsWith('data:image/')) {
    sanitized.image = '[base64 image]';
  }
  
  if (sanitized.profileImageId && typeof sanitized.profileImageId === 'string' && sanitized.profileImageId.startsWith('data:image/')) {
    sanitized.profileImageId = '[base64 image]';
  }

  return sanitized;
}
