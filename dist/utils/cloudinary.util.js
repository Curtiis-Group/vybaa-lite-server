"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImageFromUrl = uploadImageFromUrl;
exports.deleteImageFromCloudinary = deleteImageFromCloudinary;
exports.extractPublicIdFromUrl = extractPublicIdFromUrl;
const cloudinary_config_1 = require("../config/cloudinary.config");
const logger_util_1 = __importDefault(require("./logger.util"));
/**
 * Upload image from URL to Cloudinary
 * Useful for storing Google profile pictures
 */
async function uploadImageFromUrl(imageUrl, userId, folder = 'avatars') {
    try {
        // Upload directly from URL to Cloudinary
        const uploadResult = await cloudinary_config_1.cloudinary.uploader.upload(imageUrl, {
            folder: `vybaa/${folder}`,
            public_id: `${userId}_${Date.now()}`,
            resource_type: 'image',
            transformation: [
                { width: 400, height: 400, crop: 'fill', gravity: 'face' }, // Crop to face
                { quality: 'auto:good' },
                { fetch_format: 'auto' },
            ],
        });
        logger_util_1.default.info('Image uploaded to Cloudinary from URL', {
            userId,
            cloudinaryUrl: uploadResult.secure_url,
        });
        return uploadResult.secure_url;
    }
    catch (error) {
        logger_util_1.default.error('Failed to upload image from URL to Cloudinary', {
            error: error.message,
            userId,
        });
        return null;
    }
}
/**
 * Delete image from Cloudinary by public ID
 */
async function deleteImageFromCloudinary(publicId) {
    try {
        await cloudinary_config_1.cloudinary.uploader.destroy(publicId);
        logger_util_1.default.info('Image deleted from Cloudinary', { publicId });
        return true;
    }
    catch (error) {
        logger_util_1.default.error('Failed to delete image from Cloudinary', {
            error: error.message,
            publicId,
        });
        return false;
    }
}
/**
 * Extract public ID from Cloudinary URL
 */
function extractPublicIdFromUrl(url) {
    try {
        // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{public_id}.{format}
        const parts = url.split('/');
        const uploadIndex = parts.indexOf('upload');
        if (uploadIndex === -1)
            return null;
        // Get everything after 'upload/' and before the file extension
        const pathParts = parts.slice(uploadIndex + 1);
        // Remove version if present (v1234567890)
        const filtered = pathParts.filter(part => !part.startsWith('v') || isNaN(Number(part.substring(1))));
        // Join and remove extension
        const fullPath = filtered.join('/');
        const withoutExtension = fullPath.substring(0, fullPath.lastIndexOf('.'));
        return withoutExtension;
    }
    catch (error) {
        logger_util_1.default.error('Failed to extract public ID from Cloudinary URL', { url });
        return null;
    }
}
