import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import { env, CLOUDINARY_SETTINGS_FILE } from '../config/env.js';
import { logger } from '../utils/logger.js';

// ─── Cloudinary Service ────────────────────────────────────

export function loadCloudinarySettings(): any {
  try {
    if (fs.existsSync(CLOUDINARY_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(CLOUDINARY_SETTINGS_FILE, 'utf8'));
    }
  } catch (err) {
    logger.error('CloudinaryService', 'Failed to read settings', err);
  }
  return null;
}

export function saveCloudinarySettings(data: any): void {
  try {
    fs.writeFileSync(CLOUDINARY_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    logger.info('CloudinaryService', `Saved settings to ${CLOUDINARY_SETTINGS_FILE}`);
  } catch (err) {
    logger.error('CloudinaryService', 'Failed to write settings', err);
  }
}

export async function uploadAudioToCloudinary(
  fileBuffer: Buffer,
  publicId: string
): Promise<{ url: string; publicId: string } | null> {
  const localSettings = loadCloudinarySettings() || {};
  const cloudName = env.CLOUDINARY_CLOUD_NAME || localSettings.cloudName || '';
  const apiKey = env.CLOUDINARY_API_KEY || localSettings.apiKey || '';
  const apiSecret = env.CLOUDINARY_API_SECRET || localSettings.apiSecret || '';

  if (!cloudName || !apiKey || !apiSecret) {
    logger.warn('CloudinaryService', 'Credentials unconfigured. Skipping upload.');
    return null;
  }

  try {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    return new Promise((resolve) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
          folder: 'arkoo_recordings',
          public_id: publicId,
        },
        (error, result) => {
          if (error) {
            logger.error('CloudinaryService', 'Upload error', error);
            resolve(null);
          } else if (result) {
            logger.info('CloudinaryService', `Upload success: ${result.secure_url}`);
            resolve({ url: result.secure_url, publicId: result.public_id });
          } else {
            resolve(null);
          }
        }
      );
      uploadStream.end(fileBuffer);
    });
  } catch (err) {
    logger.error('CloudinaryService', 'API error', err);
    return null;
  }
}
