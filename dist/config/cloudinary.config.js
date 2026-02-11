"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cloudinary = void 0;
const cloudinary_1 = require("cloudinary");
Object.defineProperty(exports, "cloudinary", { enumerable: true, get: function () { return cloudinary_1.v2; } });
const env_util_1 = require("../utils/env.util");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
// Configure Cloudinary
cloudinary_1.v2.config({
    cloud_name: env_util_1.Env.CLOUDINARY_CLOUD_NAME,
    api_key: env_util_1.Env.CLOUDINARY_API_KEY,
    api_secret: env_util_1.Env.CLOUDINARY_API_SECRET,
    secure: true,
});
env_util_1.Env;
// Validate configuration
if (!env_util_1.Env.CLOUDINARY_CLOUD_NAME ||
    !env_util_1.Env.CLOUDINARY_API_KEY ||
    !env_util_1.Env.CLOUDINARY_API_SECRET) {
    logger_util_1.default.warn('Cloudinary credentials not configured. Image uploads will fail.');
}
