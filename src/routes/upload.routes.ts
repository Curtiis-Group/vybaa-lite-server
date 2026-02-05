import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import * as uploadController from "../controllers/upload.controller";

const router: Router = Router();

// POST /api/v1/upload/image - Upload image to Cloudinary
router.post("/image", authMiddleware, uploadController.uploadImage);

// DELETE /api/v1/upload/image - Delete image from Cloudinary
router.delete("/image", authMiddleware, uploadController.deleteImage);

export default router;
