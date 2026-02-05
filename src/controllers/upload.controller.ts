import { Response } from "express";
import { cloudinary } from "../config/cloudinary.config";
import { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

export async function uploadImage(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const { image, folder = 'profile-images' } = req.body;

    if (!image) {
      return res.status(400).json({ msg: "No image provided" });
    }

    // Validate base64 image format
    if (!image.startsWith('data:image/')) {
      return res.status(400).json({ msg: "Invalid image format" });
    }

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(image, {
      folder: `vybaa/${folder}`,
      public_id: `${userId}_${Date.now()}`,
      resource_type: 'image',
      transformation: [
        { width: 800, height: 800, crop: 'limit' },
        { quality: 'auto:good' },
        { fetch_format: 'auto' },
      ],
    });

    res.json({
      msg: "Image uploaded successfully",
      data: {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      },
    });
  } catch (error: any) {
    console.log(error)
    logger.error("Image upload error:", { error, userId: req.userId });
    res.status(500).json({ 
      msg: "Image upload failed",
      error: error.message 
    });
  }
}

export async function deleteImage(req: AuthRequest, res: Response) {
  try {
    const { publicId } = req.body;

    if (!publicId) {
      return res.status(400).json({ msg: "No public ID provided" });
    }

    // Delete from Cloudinary
    await cloudinary.uploader.destroy(publicId);

    res.json({
      msg: "Image deleted successfully",
    });
  } catch (error: any) {
    logger.error("Image delete error:", { error, userId: req.userId });
    res.status(500).json({ 
      msg: "Image deletion failed",
      error: error.message 
    });
  }
}
