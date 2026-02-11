"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const routes_1 = __importDefault(require("./routes"));
const config_util_1 = __importDefault(require("./utils/config.util"));
const logger_util_1 = __importDefault(require("./utils/logger.util"));
const request_logger_middleware_1 = require("./middleware/request-logger.middleware");
const scheduler_service_1 = require("./services/scheduler.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
// Increase payload size limit for profile image uploads (base64 encoded)
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ limit: '10mb', extended: true }));
// Request logging middleware (should be before routes)
app.use(request_logger_middleware_1.requestLogger);
app.use("/api", routes_1.default);
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
