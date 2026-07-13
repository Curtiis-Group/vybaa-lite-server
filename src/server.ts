import cors from "cors";
import dotenv from "dotenv";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import expressWs from "express-ws";
import * as rewindController from "./controllers/rewind.controller";
import { handlePaystackWebhook } from "./controllers/webhook.controller";
import { requestLogger } from "./middleware/request-logger.middleware";
import { apiRateLimit, securityHeaders } from "./middleware/security.middleware";
import routes from "./routes";
import { schedulerService } from "./services/scheduler.service";
import config from "./utils/config.util";
import { Env, ENVIRONMENT } from "./utils/env.util";
import logger from "./utils/logger.util";
import { securityConfig, validateSecurityEnvironment } from "./utils/security-config.util";

dotenv.config();

validateSecurityEnvironment();

export const app = express();
expressWs(app);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(securityHeaders);
app.use(cors({
    credentials: true,
    origin(origin, callback) {
        if (!origin || securityConfig.allowedOrigins.includes(origin) || Env.ENVIRONMENT == ENVIRONMENT.LOCAL) {
            callback(null, true);
            return;
        }
        callback(new Error("Origin is not allowed"));
    },
}));
app.use(apiRateLimit);

// Paystack webhook needs raw body for signature verification
app.post(
    "/api/v1/webhooks/paystack",
    express.raw({ type: "application/json" }),
    handlePaystackWebhook,
);

app.use("/api/v1/upload", express.json({ limit: securityConfig.uploadBodyLimit }));
app.use(express.json({ limit: securityConfig.apiBodyLimit }));
app.use(express.urlencoded({ limit: securityConfig.apiBodyLimit, extended: true }));

// Request logging middleware (should be before routes)
app.use(requestLogger);

app.use("/api", routes);

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : 500;
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 600
        ? status
        : 500;
    res.status(safeStatus).json({
        msg: safeStatus === 413 ? "Request payload is too large" : "Request rejected",
    });
});


// @ts-ignore
app.ws("/api/v1/rewind/live", rewindController.handleLiveConnection);


export const server = app.listen(config.PORT, () => {
    logger.info(`🚀 Server running on port ${config.PORT}`);

    // Start notification scheduler
    schedulerService.start();
});




// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    schedulerService.stop();
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    schedulerService.stop();
    process.exit(0);
});
