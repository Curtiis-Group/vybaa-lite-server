import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import expressWs from "express-ws";
import * as rewindController from "./controllers/rewind.controller";
import { handlePaystackWebhook } from "./controllers/webhook.controller";
import { requestLogger } from "./middleware/request-logger.middleware";
import routes from "./routes";
import { schedulerService } from "./services/scheduler.service";
import config from "./utils/config.util";
import logger from "./utils/logger.util";

dotenv.config();

const app = express();
expressWs(app);

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


// @ts-ignore
app.ws("/api/v1/rewind/live", rewindController.handleLiveConnection);


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
