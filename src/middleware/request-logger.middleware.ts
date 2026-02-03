import { Request, Response, NextFunction } from "express";
import logger from "../utils/logger.util";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startTime = Date.now();

  // Log request details
  const requestInfo = {
    method: req.method,
    path: req.path,
    url: req.originalUrl || req.url,
    ip: req.ip || req.socket.remoteAddress,
    userAgent: req.get("user-agent"),
    contentType: req.get("content-type"),
    contentLength: req.get("content-length"),
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    body: shouldLogBody(req.method, req.path) ? sanitizeBody(req.body) : undefined,
  };

  logger.info("Incoming request", requestInfo);

  // Capture response details
  const originalSend = res.send;
  res.send = function (body) {
    const duration = Date.now() - startTime;
    const responseInfo = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.socket.remoteAddress,
    };

    if (res.statusCode >= 400) {
      logger.warn("Request completed with error", responseInfo);
    } else {
      logger.info("Request completed", responseInfo);
    }

    return originalSend.call(this, body);
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

  return sanitized;
}
