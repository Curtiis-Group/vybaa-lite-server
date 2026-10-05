import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { metricsService } from "../services/metrics.service";
import logger, { redactRequestPath } from "../utils/logger.util";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const requestId = getRequestId(req);
  const requestPath = redactRequestPath(req.originalUrl ?? req.path);
  let responseLogged = false;

  res.setHeader("x-request-id", requestId);
  logRequestStarted(req, requestId, requestPath);

  if (shouldLogBody(req.method, req.path) && req.body !== undefined) {
    logger.debug("HTTP request body", {
      body: sanitizeBody(req.body),
      requestId,
    });
  }

  res.once("finish", () => {
    if (responseLogged) {
      return;
    }
    responseLogged = true;
    logRequestCompleted(req, res, requestId, requestPath, Date.now() - start);
  });

  res.once("close", () => {
    if (responseLogged || res.writableFinished) {
      return;
    }
    responseLogged = true;
    logger.warn("HTTP request closed before response completed", {
      durationMs: Date.now() - start,
      method: req.method,
      path: requestPath,
      requestId,
    });
  });

  next();
}

function getRequestId(req: Request): string {
  const suppliedRequestId = req.header("x-request-id")?.trim();
  if (suppliedRequestId && suppliedRequestId.length <= 128) {
    return suppliedRequestId;
  }
  return randomUUID();
}

function logRequestStarted(
  req: Request,
  requestId: string,
  requestPath: string,
): void {
  logger.info("HTTP request started", {
    ip: req.ip ?? "unknown",
    method: req.method,
    path: requestPath,
    requestId,
    userAgent: req.get("user-agent") ?? "unknown",
  });
}

function logRequestCompleted(
  req: Request,
  res: Response,
  requestId: string,
  requestPath: string,
  durationMs: number,
): void {
  const context = {
    contentLength: res.getHeader("content-length"),
    durationMs,
    method: req.method,
    path: requestPath,
    requestId,
    route: req.route?.path ?? req.path,
    status: res.statusCode,
  };

  if (res.statusCode >= 500) {
    logger.error("HTTP request completed", context);
    recordRequestMetrics(req, res, durationMs, requestId);
    return;
  }
  if (res.statusCode >= 400) {
    logger.warn("HTTP request completed", context);
    recordRequestMetrics(req, res, durationMs, requestId);
    return;
  }

  logger.info("HTTP request completed", context);
  recordRequestMetrics(req, res, durationMs, requestId);
}

function recordRequestMetrics(
  req: Request,
  res: Response,
  durationMs: number,
  requestId: string,
): void {
  void metricsService
    .record("http_request_duration_ms", durationMs, {
      method: req.method,
      route: req.route?.path ?? req.path,
      status: res.statusCode,
    })
    .catch((error: unknown) => {
      logger.warn("HTTP metrics recording failed", {
        ...describeError(error),
        requestId,
      });
    });
}

function shouldLogBody(method: string, path: string): boolean {
  const sensitivePaths = ["/auth/login", "/auth/register", "/auth/google"];
  if (sensitivePaths.some((sensitivePath) => path.includes(sensitivePath))) {
    return false;
  }

  return ["POST", "PUT", "PATCH"].includes(method);
}

function sanitizeBody(body: unknown, fieldName?: string): unknown {
  if (fieldName && isSensitiveField(fieldName)) {
    return "[REDACTED]";
  }
  if (typeof body === "string") {
    if (body.startsWith("data:image/")) {
      return "[base64 image]";
    }
    return body.length > 1000 ? `${body.slice(0, 1000)}…[TRUNCATED]` : body;
  }
  if (Array.isArray(body)) {
    return body.slice(0, 20).map((item) => sanitizeBody(item));
  }
  if (!isRecord(body)) {
    return body;
  }

  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, sanitizeBody(value, key)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveField(fieldName: string): boolean {
  return /password|refreshToken|token|otp|authorization|cookie|secret/i.test(
    fieldName,
  );
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorMessage: error.message, errorName: error.name };
  }
  return { errorMessage: String(error) };
}
