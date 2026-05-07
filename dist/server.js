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
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const express_ws_1 = __importDefault(require("express-ws"));
const rewindController = __importStar(require("./controllers/rewind.controller"));
const webhook_controller_1 = require("./controllers/webhook.controller");
const request_logger_middleware_1 = require("./middleware/request-logger.middleware");
const routes_1 = __importDefault(require("./routes"));
const scheduler_service_1 = require("./services/scheduler.service");
const config_util_1 = __importDefault(require("./utils/config.util"));
const logger_util_1 = __importDefault(require("./utils/logger.util"));
dotenv_1.default.config();
const app = (0, express_1.default)();
(0, express_ws_1.default)(app);
app.use((0, cors_1.default)());
// Paystack webhook needs raw body for signature verification
app.post("/api/v1/webhooks/paystack", express_1.default.raw({ type: "application/json" }), webhook_controller_1.handlePaystackWebhook);
// Increase payload size limit for profile image uploads (base64 encoded)
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Request logging middleware (should be before routes)
app.use(request_logger_middleware_1.requestLogger);
app.use("/api", routes_1.default);
// @ts-ignore
app.ws("/api/v1/rewind/live", rewindController.handleLiveConnection);
app.listen(config_util_1.default.PORT, () => {
    logger_util_1.default.info(`🚀 Server running on port ${config_util_1.default.PORT}`);
    // Start notification scheduler
    scheduler_service_1.schedulerService.start();
});
// Graceful shutdown
process.on('SIGTERM', () => {
    logger_util_1.default.info('SIGTERM signal received: closing HTTP server');
    scheduler_service_1.schedulerService.stop();
    process.exit(0);
});
process.on('SIGINT', () => {
    logger_util_1.default.info('SIGINT signal received: closing HTTP server');
    scheduler_service_1.schedulerService.stop();
    process.exit(0);
});
