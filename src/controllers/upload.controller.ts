import type { UploadApiOptions } from "cloudinary";
import type { Response } from "express";
import { cloudinary } from "../config/cloudinary.config";
import type { AuthRequest } from "../middleware/auth.middleware";
import logger from "../utils/logger.util";

const ALLOWED_UPLOAD_FOLDERS = new Set([
  "check-ins",
  "check-ins/audio",
  "community-covers",
  "profile-images",
]);
const PUBLIC_IMAGE_FOLDERS = new Set(["community-covers", "profile-images"]);

type ModerationStatus =
  "aborted" | "approved" | "pending" | "queued" | "rejected";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown upload error";
}

function isModerationStatus(value: string): value is ModerationStatus {
  return (
    value === "aborted" ||
    value === "approved" ||
    value === "pending" ||
    value === "queued" ||
    value === "rejected"
  );
}

function getModerationStatus(uploadResult: unknown): ModerationStatus | null {
  if (!isRecord(uploadResult) || !Array.isArray(uploadResult.moderation)) {
    return null;
  }
  const awsModeration = uploadResult.moderation.find(
    (entry: unknown) => isRecord(entry) && entry.kind === "aws_rek",
  );
  if (!isRecord(awsModeration) || typeof awsModeration.status !== "string") {
    return null;
  }
  return isModerationStatus(awsModeration.status) ? awsModeration.status : null;
}

export async function uploadImage(req: AuthRequest, res: Response) {
  try {
    const userId = req.userId!;
    const image = typeof req.body.image === "string" ? req.body.image : "";
    const folder =
      typeof req.body.folder === "string" ? req.body.folder : "profile-images";

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
    const uploadOptions: UploadApiOptions = {
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

    const uploadResult = await cloudinary.uploader.upload(image, uploadOptions);
    if (requiresModeration) {
      const moderationStatus = getModerationStatus(uploadResult);
      if (moderationStatus !== "approved") {
        await cloudinary.uploader.destroy(uploadResult.public_id, {
          invalidate: true,
          resource_type: "image",
        });
        if (moderationStatus === "rejected") {
          return res.status(400).json({
            code: "IMAGE_REJECTED",
            msg: "This image cannot be used because it may contain unsafe content.",
          });
        }
        logger.error("Public image moderation did not complete", {
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
  } catch (error: unknown) {
    logger.error("File upload error", { error, userId: req.userId });
    return res.status(500).json({
      msg: "File upload failed",
      error: getErrorMessage(error),
    });
  }
}

export async function deleteImage(req: AuthRequest, res: Response) {
  try {
    const publicId =
      typeof req.body.publicId === "string" ? req.body.publicId.trim() : "";
    if (!publicId) {
      return res.status(400).json({ msg: "No public ID provided" });
    }
    if (!publicId.startsWith("vybaa/")) {
      return res.status(400).json({ msg: "Invalid public ID" });
    }

    await cloudinary.uploader.destroy(publicId);
    return res.json({ msg: "Image deleted successfully" });
  } catch (error: unknown) {
    logger.error("Image delete error", { error, userId: req.userId });
    return res.status(500).json({
      msg: "Image deletion failed",
      error: getErrorMessage(error),
    });
  }
}
