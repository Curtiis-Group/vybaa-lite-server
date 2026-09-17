import cors from "cors";
import dotenv from "dotenv";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import expressWs from "express-ws";
import * as rewindController from "./controllers/rewind.controller";
import { handleRevenueCatWebhook } from "./controllers/revenuecat-webhook.controller";
import { handlePaystackWebhook } from "./controllers/webhook.controller";
import {
  clientAppMiddleware,
  setClientApp,
} from "./middleware/client-app.middleware";
import { requestLogger } from "./middleware/request-logger.middleware";
import {
  apiRateLimit,
  rejectCommonProbes,
  revenueCatWebhookRateLimit,
  securityHeaders,
} from "./middleware/security.middleware";
import routes from "./routes";
import { schedulerService } from "./services/scheduler.service";
import {
  handleRealtimeConnection,
  startRealtimeWebSocketBroker,
  stopRealtimeWebSocketBroker,
} from "./services/realtime-websocket.service";
import config from "./utils/config.util";
import { Env, ENVIRONMENT } from "./utils/env.util";
import logger from "./utils/logger.util";
import {
  securityConfig,
  validateSecurityEnvironment,
} from "./utils/security-config.util";

dotenv.config();

validateSecurityEnvironment();

export const app = express();
expressWs(app);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(rejectCommonProbes);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (
        !origin ||
        securityConfig.allowedOrigins.includes(origin) ||
        Env.ENVIRONMENT == ENVIRONMENT.LOCAL
      ) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed"));
    },
  }),
);
app.use(apiRateLimit);
app.use(clientAppMiddleware);

// Paystack webhook needs raw body for signature verification
app.post(
  "/api/v1/webhooks/paystack",
  express.raw({ type: "application/json" }),
  handlePaystackWebhook,
);
app.post(
  "/mycove/v1/webhooks/paystack",
  express.raw({ type: "application/json" }),
  handlePaystackWebhook,
);
app.post(
  "/api/v1/webhooks/revenuecat",
  revenueCatWebhookRateLimit,
  express.raw({ limit: "512kb", type: "application/json" }),
  handleRevenueCatWebhook,
);
app.post(
  "/mycove/v1/webhooks/revenuecat",
  revenueCatWebhookRateLimit,
  express.raw({ limit: "512kb", type: "application/json" }),
  handleRevenueCatWebhook,
);

app.use(
  "/api/v1/upload",
  express.json({ limit: securityConfig.uploadBodyLimit }),
);
app.use(
  "/mycove/v1/upload",
  express.json({ limit: securityConfig.uploadBodyLimit }),
);
app.use(express.json({ limit: securityConfig.apiBodyLimit }));
app.use(
  express.urlencoded({ limit: securityConfig.apiBodyLimit, extended: true }),
);

// Request logging middleware (should be before routes)
app.use(requestLogger);

app.use("/api", routes);
app.use("/mycove", routes);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof error === "object" && error && "status" in error
      ? Number(error.status)
      : 500;
  const safeStatus =
    Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  res.status(safeStatus).json({
    msg:
      safeStatus === 413 ? "Request payload is too large" : "Request rejected",
  });
});

// express-ws does not run Express middleware for WebSocket upgrades.
// @ts-expect-error express-ws augments Express at runtime.
app.ws("/api/v1/rewind/live", (ws, req) => {
  setClientApp(req, "vybaa");
  void rewindController.handleLiveConnection(ws, req);
});
// @ts-expect-error express-ws augments Express at runtime.
app.ws("/mycove/v1/rewind/live", (ws, req) => {
  setClientApp(req, "mycove");
  void rewindController.handleLiveConnection(ws, req);
});
// @ts-expect-error express-ws augments Express at runtime.
app.ws("/api/v2/realtime/live", (ws, req) => {
  setClientApp(req, "vybaa");
  handleRealtimeConnection(ws, req);
});
// @ts-expect-error express-ws augments Express at runtime.
app.ws("/mycove/v2/realtime/live", (ws, req) => {
  setClientApp(req, "mycove");
  handleRealtimeConnection(ws, req);
});

void startRealtimeWebSocketBroker();

export const server = app.listen(config.PORT, () => {
  logger.info(`🚀 Server running on port ${config.PORT}`);

  // Start notification scheduler
  schedulerService.start();
});

// Release slow/incomplete connections so they cannot consume a worker indefinitely.
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM signal received: closing HTTP server");
  schedulerService.stop();
  void stopRealtimeWebSocketBroker().finally(() => process.exit(0));
});

process.on("SIGINT", () => {
  logger.info("SIGINT signal received: closing HTTP server");
  schedulerService.stop();
  void stopRealtimeWebSocketBroker().finally(() => process.exit(0));
});
