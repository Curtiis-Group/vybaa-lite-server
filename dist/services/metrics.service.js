"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsService = void 0;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
function serializeTags(tags) {
    if (!tags)
        return [];
    if (Array.isArray(tags)) {
        return tags;
    }
    return Object.entries(tags).map(([key, value]) => `${key}:${String(value)}`);
}
exports.metricsService = {
    async record(name, value, tags) {
        try {
            await db_config_1.prisma.serverMetric.create({
                data: {
                    name,
                    value,
                    tags: serializeTags(tags),
                },
            });
        }
        catch (error) {
            // We never want metrics writes to break the main flow.
            logger_util_1.default.error("Metrics record error", { name, error });
        }
    },
};
