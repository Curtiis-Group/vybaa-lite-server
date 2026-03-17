import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import routes from "./routes";
import config from "./utils/config.util";
import logger from "./utils/logger.util";
import { requestLogger } from "./middleware/request-logger.middleware";
import { schedulerService } from "./services/scheduler.service";
import { handlePaystackWebhook } from "./controllers/webhook.controller";

dotenv.config();

const app = express();

app.use(cors());

// Paystack webhook needs raw body for signature verification
app.post(
  "/api/v1/webhooks/paystack",
  express.raw({ type: "application/json" }),
  handlePaystackWebhook,
);

// Increase payload size limit for profile image uploads (base64 encoded)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Request logging middleware (should be before routes)
app.use(requestLogger);

app.use("/api", routes);

app.listen(config.PORT, () => {
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
