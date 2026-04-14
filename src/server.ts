import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { handlePaystackWebhook } from "./controllers/webhook.controller";
import { requestLogger } from "./middleware/request-logger.middleware";
import routes from "./routes";
import { schedulerService } from "./services/scheduler.service";
import config from "./utils/config.util";
import logger from "./utils/logger.util";


import { ApiVersion, CookieNotFound, InvalidOAuthError, LogSeverity, shopifyApi } from '@shopify/shopify-api';
import '@shopify/shopify-api/adapters/node';

export const shopify = shopifyApi({
    // The next 4 values are typically read from environment variables for added security
    apiKey: 'b0e4477002dc23271ac8507b1c6590f0',
    apiSecretKey: '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',
    scopes: ['read_products', 'read_inventory'],
    hostName: 'unambitious-anarchy.outray.app',
    apiVersion: ApiVersion.July25,
    isEmbeddedApp: true,
    logger: {
        level: LogSeverity.Debug
    },

});

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

app.get("/listen", async (req, res) => {

    const params = { request: req, response: res }

    try {
        const session = (await shopify.auth.callback({
            rawRequest: params.request,
            rawResponse: params.response,
        })).session;


        console.log("SESH", session)
        return session?.toObject();
    } catch (e) {
        if (e instanceof InvalidOAuthError) {
            throw new Error("LOL");
        } else if (e instanceof CookieNotFound) {
            await shopify.auth.begin({
                shop: "eseszn.myshopify.com",
                isOnline: false,
                callbackPath: '/listen',
                
                rawRequest: params.request,
                rawResponse: params.response,
            });

            return undefined;
        } else {
            throw e;
        }
    }
})

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
