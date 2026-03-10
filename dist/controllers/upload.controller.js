"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImage = uploadImage;
exports.deleteImage = deleteImage;
const cloudinary_config_1 = require("../config/cloudinary.config");
const logger_util_1 = __importDefault(require("../utils/logger.util"));
async function uploadImage(req, res) {
    try {
        const userId = req.userId;
        const { image, folder = 'profile-images' } = req.body;
        if (!image) {
            return res.status(400).json({ msg: "No image provided" });
        }
        // Determine resource type based on data URL
        let resourceType = 'image';
        let uploadOptions = {
            folder: `vybaa/${folder}`,
            public_id: `${userId}_${Date.now()}`,
            resource_type: resourceType,
        };
        if (image.startsWith('data:image/')) {
            resourceType = 'image';
            uploadOptions.resource_type = 'image';
            uploadOptions.transformation = [
                { width: 800, height: 800, crop: 'limit' },
                { quality: 'auto:good' },
                { fetch_format: 'auto' },
            ];
        }
        else if (image.startsWith('data:audio/')) {
            resourceType = 'video'; // Cloudinary uses 'video' resource type for audio files
            uploadOptions.resource_type = 'video';
            // No transformations for audio
        }
        else {
            return res.status(400).json({ msg: "Invalid file format. Only images and audio are supported." });
        }
        // Upload to Cloudinary
        const uploadResult = await cloudinary_config_1.cloudinary.uploader.upload(image, uploadOptions);
        res.json({
            msg: "File uploaded successfully",
            data: {
                url: uploadResult.secure_url,
                publicId: uploadResult.public_id,
            },
        });
    }
    catch (error) {
        console.log(error);
        logger_util_1.default.error("File upload error:", { error, userId: req.userId });
        res.status(500).json({
            msg: "File upload failed",
            error: error.message
        });
    }
}
async function deleteImage(req, res) {
    try {
        const { publicId } = req.body;
        if (!publicId) {
            return res.status(400).json({ msg: "No public ID provided" });
        }
        // Delete from Cloudinary
        await cloudinary_config_1.cloudinary.uploader.destroy(publicId);
        res.json({
            msg: "Image deleted successfully",
        });
    }
    catch (error) {
        logger_util_1.default.error("Image delete error:", { error, userId: req.userId });
        res.status(500).json({
            msg: "Image deletion failed",
            error: error.message
        });
    }
}
