import { cloudinary } from "../config/cloudinary.config";
import logger from "./logger.util";

/**
 * Upload image from URL to Cloudinary
 * Useful for storing Google profile pictures
 */
export async function uploadImageFromUrl(
  imageUrl: string,
  userId: string,
  folder: string = 'avatars'
): Promise<string | null> {
  try {
    // Upload directly from URL to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(imageUrl, {
      folder: `vybaa/${folder}`,
      public_id: `${userId}_${Date.now()}`,
      resource_type: 'image',
      transformation: [
        { width: 400, height: 400, crop: 'fill', gravity: 'face' }, // Crop to face
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
      ],
    });

    logger.info('Image uploaded to Cloudinary from URL', {
      userId,
      cloudinaryUrl: uploadResult.secure_url,
    });

    return uploadResult.secure_url;
  } catch (error: any) {
    logger.error('Failed to upload image from URL to Cloudinary', {
      error: error.message,
      userId,
    });
    return null;
  }
}

/**
 * Delete image from Cloudinary by public ID
 */
export async function deleteImageFromCloudinary(
  publicId: string
): Promise<boolean> {
  try {
    await cloudinary.uploader.destroy(publicId);
    logger.info('Image deleted from Cloudinary', { publicId });
    return true;
  } catch (error: any) {
    logger.error('Failed to delete image from Cloudinary', {
      error: error.message,
      publicId,
    });
    return false;
  }
}

/**
 * Extract public ID from Cloudinary URL
 */
export function extractPublicIdFromUrl(url: string): string | null {
  try {
    // Cloudinary URL format: https://res.cloudinary.com/{cloud_name}/image/upload/{transformations}/{public_id}.{format}
    const parts = url.split('/');
    const uploadIndex = parts.indexOf('upload');
    
    if (uploadIndex === -1) return null;
    
    // Get everything after 'upload/' and before the file extension
    const pathParts = parts.slice(uploadIndex + 1);
    // Remove version if present (v1234567890)
    const filtered = pathParts.filter(part => !part.startsWith('v') || isNaN(Number(part.substring(1))));
    // Join and remove extension
    const fullPath = filtered.join('/');
    const withoutExtension = fullPath.substring(0, fullPath.lastIndexOf('.'));
    
    return withoutExtension;
  } catch (error) {
    logger.error('Failed to extract public ID from Cloudinary URL', { url });
    return null;
  }
}
