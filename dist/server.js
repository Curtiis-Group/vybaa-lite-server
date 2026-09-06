"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.app = void 0;
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const express_ws_1 = __importDefault(require("express-ws"));
const rewindController = __importStar(require("./controllers/rewind.controller"));
const revenuecat_webhook_controller_1 = require("./controllers/revenuecat-webhook.controller");
const webhook_controller_1 = require("./controllers/webhook.controller");
const client_app_middleware_1 = require("./middleware/client-app.middleware");
const request_logger_middleware_1 = require("./middleware/request-logger.middleware");
const security_middleware_1 = require("./middleware/security.middleware");
const routes_1 = __importDefault(require("./routes"));
const scheduler_service_1 = require("./services/scheduler.service");
const realtime_websocket_service_1 = require("./services/realtime-websocket.service");
const config_util_1 = __importDefault(require("./utils/config.util"));
const env_util_1 = require("./utils/env.util");
const logger_util_1 = __importDefault(require("./utils/logger.util"));
const security_config_util_1 = require("./utils/security-config.util");
dotenv_1.default.config();
(0, security_config_util_1.validateSecurityEnvironment)();
exports.app = (0, express_1.default)();
(0, express_ws_1.default)(exports.app);
exports.app.disable("x-powered-by");
exports.app.set("trust proxy", 1);
exports.app.use(security_middleware_1.securityHeaders);
exports.app.use((0, cors_1.default)({
    credentials: true,
    origin(origin, callback) {
        if (!origin ||
            security_config_util_1.securityConfig.allowedOrigins.includes(origin) ||
            env_util_1.Env.ENVIRONMENT == env_util_1.ENVIRONMENT.LOCAL) {
            callback(null, true);
            return;
        }
        callback(new Error("Origin is not allowed"));
    },
}));
exports.app.use(security_middleware_1.apiRateLimit);
exports.app.use(client_app_middleware_1.clientAppMiddleware);
// Paystack webhook needs raw body for signature verification
exports.app.post("/api/v1/webhooks/paystack", express_1.default.raw({ type: "application/json" }), webhook_controller_1.handlePaystackWebhook);
exports.app.post("/mycove/v1/webhooks/paystack", express_1.default.raw({ type: "application/json" }), webhook_controller_1.handlePaystackWebhook);
exports.app.post("/api/v1/webhooks/revenuecat", security_middleware_1.revenueCatWebhookRateLimit, express_1.default.raw({ limit: "512kb", type: "application/json" }), revenuecat_webhook_controller_1.handleRevenueCatWebhook);
exports.app.post("/mycove/v1/webhooks/revenuecat", security_middleware_1.revenueCatWebhookRateLimit, express_1.default.raw({ limit: "512kb", type: "application/json" }), revenuecat_webhook_controller_1.handleRevenueCatWebhook);
exports.app.use("/api/v1/upload", express_1.default.json({ limit: security_config_util_1.securityConfig.uploadBodyLimit }));
exports.app.use("/mycove/v1/upload", express_1.default.json({ limit: security_config_util_1.securityConfig.uploadBodyLimit }));
exports.app.use(express_1.default.json({ limit: security_config_util_1.securityConfig.apiBodyLimit }));
exports.app.use(express_1.default.urlencoded({ limit: security_config_util_1.securityConfig.apiBodyLimit, extended: true }));
// Request logging middleware (should be before routes)
exports.app.use(request_logger_middleware_1.requestLogger);
exports.app.use("/api", routes_1.default);
exports.app.use("/mycove", routes_1.default);
exports.app.use((error, _req, res, _next) => {
    const status = typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : 500;
    const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    res.status(safeStatus).json({
        msg: safeStatus === 413 ? "Request payload is too large" : "Request rejected",
    });
});
// express-ws does not run Express middleware for WebSocket upgrades.
// @ts-expect-error express-ws augments Express at runtime.
exports.app.ws("/api/v1/rewind/live", (ws, req) => {
    (0, client_app_middleware_1.setClientApp)(req, "vybaa");
    void rewindController.handleLiveConnection(ws, req);
});
// @ts-expect-error express-ws augments Express at runtime.
exports.app.ws("/mycove/v1/rewind/live", (ws, req) => {
    (0, client_app_middleware_1.setClientApp)(req, "mycove");
    void rewindController.handleLiveConnection(ws, req);
});
// @ts-expect-error express-ws augments Express at runtime.
exports.app.ws("/api/v2/realtime/live", (ws, req) => {
    (0, client_app_middleware_1.setClientApp)(req, "vybaa");
    (0, realtime_websocket_service_1.handleRealtimeConnection)(ws, req);
});
// @ts-expect-error express-ws augments Express at runtime.
exports.app.ws("/mycove/v2/realtime/live", (ws, req) => {
    (0, client_app_middleware_1.setClientApp)(req, "mycove");
    (0, realtime_websocket_service_1.handleRealtimeConnection)(ws, req);
});
void (0, realtime_websocket_service_1.startRealtimeWebSocketBroker)();
exports.server = exports.app.listen(config_util_1.default.PORT, () => {
    logger_util_1.default.info(`🚀 Server running on port ${config_util_1.default.PORT}`);
    // Start notification scheduler
    scheduler_service_1.schedulerService.start();
});
// Graceful shutdown
process.on("SIGTERM", () => {
    logger_util_1.default.info("SIGTERM signal received: closing HTTP server");
    scheduler_service_1.schedulerService.stop();
    void (0, realtime_websocket_service_1.stopRealtimeWebSocketBroker)().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
    logger_util_1.default.info("SIGINT signal received: closing HTTP server");
    scheduler_service_1.schedulerService.stop();
    void (0, realtime_websocket_service_1.stopRealtimeWebSocketBroker)().finally(() => process.exit(0));
});
