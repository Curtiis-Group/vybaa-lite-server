import { v2 as cloudinary } from 'cloudinary';
import { Env } from '../utils/env.util';
import logger from '../utils/logger.util';

// Configure Cloudinary
cloudinary.config({
  cloud_name: Env.CLOUDINARY_CLOUD_NAME!,
  api_key: Env.CLOUDINARY_API_KEY!,
  api_secret: Env.CLOUDINARY_API_SECRET!,
  secure: true,
});

Env

// Validate configuration
if (
  !Env.CLOUDINARY_CLOUD_NAME ||
  !Env.CLOUDINARY_API_KEY ||
  !Env.CLOUDINARY_API_SECRET
) {
  logger.warn('Cloudinary credentials not configured. Image uploads will fail.');
}

export { cloudinary };
