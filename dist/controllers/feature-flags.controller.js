"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listFeatureFlags = listFeatureFlags;
exports.upsertFeatureFlag = upsertFeatureFlag;
const db_config_1 = require("../config/db.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
async function listFeatureFlags(_req, res) {
    try {
        const flags = await db_config_1.prisma.featureFlag.findMany({
            orderBy: { key: "asc" },
        });
        res.json({
            msg: "Feature flags retrieved successfully",
            data: flags,
        });
    }
    catch (error) {
        logger_util_1.default.error("List feature flags error:", { error });
        res.status(500).json({ msg: "Internal server error" });
    }
}
async function upsertFeatureFlag(req, res) {
    try {
        const { key, enabled } = req.body;
        if (!key) {
            return res.status(400).json({ msg: "Feature flag key is required" });
        }
        const flag = await db_config_1.prisma.featureFlag.upsert({
            where: { key },
            create: { key, enabled: !!enabled },
            update: { enabled: !!enabled },
        });
        res.json({
            msg: "Feature flag updated successfully",
            data: flag,
        });
    }
    catch (error) {
        logger_util_1.default.error("Upsert feature flag error:", { error });
        res.status(500).json({ msg: "Internal server error" });
    }
}
