"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImage = uploadImage;
exports.deleteImage = deleteImage;
const cloudinary_config_1 = require("../config/cloudinary.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
const ALLOWED_UPLOAD_FOLDERS = new Set([
    "check-ins",
    "check-ins/audio",
    "community-covers",
    "profile-images",
]);
const PUBLIC_IMAGE_FOLDERS = new Set(["community-covers", "profile-images"]);
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function getErrorMessage(error) {
    return error instanceof Error ? error.message : "Unknown upload error";
}
function isModerationStatus(value) {
    return (value === "aborted" ||
        value === "approved" ||
        value === "pending" ||
        value === "queued" ||
        value === "rejected");
}
function getModerationStatus(uploadResult) {
    if (!isRecord(uploadResult) || !Array.isArray(uploadResult.moderation)) {
        return null;
    }
    const awsModeration = uploadResult.moderation.find((entry) => isRecord(entry) && entry.kind === "aws_rek");
    if (!isRecord(awsModeration) || typeof awsModeration.status !== "string") {
        return null;
    }
    return isModerationStatus(awsModeration.status) ? awsModeration.status : null;
}
async function uploadImage(req, res) {
    try {
        const userId = req.userId;
        const image = typeof req.body.image === "string" ? req.body.image : "";
        const folder = typeof req.body.folder === "string" ? req.body.folder : "profile-images";
        if (!image) {
            return res.status(400).json({ msg: "No image provided" });
        }
        if (!ALLOWED_UPLOAD_FOLDERS.has(folder)) {
            return res.status(400).json({ msg: "Invalid upload destination" });
        }
        const isImage = image.startsWith("data:image/");
        const isAudio = image.startsWith("data:audio/");
        if (!isImage && !isAudio) {
            return res.status(400).json({
                msg: "Invalid file format. Only images and audio are supported.",
            });
        }
        const requiresModeration = isImage && PUBLIC_IMAGE_FOLDERS.has(folder);
        const uploadOptions = {
            folder: `vybaa/${folder}`,
            public_id: `${userId}_${Date.now()}`,
            resource_type: isImage ? "image" : "video",
            ...(requiresModeration ? { moderation: "aws_rek" } : {}),
            ...(isImage
                ? {
                    transformation: [
                        { crop: "limit", height: 800, width: 800 },
                        { quality: "auto:good" },
                        { fetch_format: "auto" },
                    ],
                }
                : {}),
        };
        const uploadResult = await cloudinary_config_1.cloudinary.uploader.upload(image, uploadOptions);
        if (requiresModeration) {
            const moderationStatus = getModerationStatus(uploadResult);
            if (moderationStatus !== "approved") {
                await cloudinary_config_1.cloudinary.uploader.destroy(uploadResult.public_id, {
                    invalidate: true,
                    resource_type: "image",
                });
                if (moderationStatus === "rejected") {
                    return res.status(400).json({
                        code: "IMAGE_REJECTED",
                        msg: "This image cannot be used because it may contain unsafe content.",
                    });
                }
                logger_util_1.default.error("Public image moderation did not complete", {
                    moderationStatus,
                    userId,
                });
                return res.status(503).json({
                    code: "IMAGE_MODERATION_UNAVAILABLE",
                    msg: "We could not safely review this image. Please try another image later.",
                });
            }
        }
        return res.json({
            msg: "File uploaded successfully",
            data: {
                publicId: uploadResult.public_id,
                url: uploadResult.secure_url,
            },
        });
    }
    catch (error) {
        logger_util_1.default.error("File upload error", { error, userId: req.userId });
        return res.status(500).json({
            msg: "File upload failed",
            error: getErrorMessage(error),
        });
    }
}
async function deleteImage(req, res) {
    try {
        const publicId = typeof req.body.publicId === "string" ? req.body.publicId.trim() : "";
        if (!publicId) {
            return res.status(400).json({ msg: "No public ID provided" });
        }
        if (!publicId.startsWith("vybaa/")) {
            return res.status(400).json({ msg: "Invalid public ID" });
        }
        await cloudinary_config_1.cloudinary.uploader.destroy(publicId);
        return res.json({ msg: "Image deleted successfully" });
    }
    catch (error) {
        logger_util_1.default.error("Image delete error", { error, userId: req.userId });
        return res.status(500).json({
            msg: "Image deletion failed",
            error: getErrorMessage(error),
        });
    }
}
