import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import { env, CLOUDINARY_SETTINGS_FILE } from '../config/env.js';
import { getFirestore } from '../config/firebase.js';
import { logger } from '../utils/logger.js';

// ─── Cloudinary Service ────────────────────────────────────
let cachedCloudinarySettings: any = null;

export async function syncCloudinarySettingsFromFirestore(): Promise<void> {
  const db = getFirestore();
  if (!db) return;
  try {
    const doc = await db.collection('settings').doc('cloudinary').get();
    if (doc.exists) {
      const data = doc.data();
      if (data && (data.cloudName || data.apiKey)) {
        cachedCloudinarySettings = data;
        try {
          fs.writeFileSync(CLOUDINARY_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
        } catch (_wErr) {}
        logger.info('CloudinaryService', 'Synced settings from Firestore successfully');
      }
    }
  } catch (err: any) {
    logger.warn('CloudinaryService', 'Could not sync settings from Firestore', { error: err?.message || String(err) });
  }
}

export function loadCloudinarySettings(): any {
  if (cachedCloudinarySettings && cachedCloudinarySettings.cloudName) {
    return cachedCloudinarySettings;
  }
  try {
    if (fs.existsSync(CLOUDINARY_SETTINGS_FILE)) {
      const content = JSON.parse(fs.readFileSync(CLOUDINARY_SETTINGS_FILE, 'utf8'));
      if (content && (content.cloudName || content.apiKey)) {
        cachedCloudinarySettings = content;
        return content;
      }
    }
  } catch (err) {
    logger.error('CloudinaryService', 'Failed to read settings', err);
  }
  return null;
}

export function saveCloudinarySettings(data: any): void {
  cachedCloudinarySettings = data;
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
          resource_type: 'video',
          folder: 'arkoo_recordings',
          public_id: publicId,
          format: 'mp3',
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

export async function getCloudinaryAudioUrl(meetingId: string): Promise<string | null> {
  const localSettings = loadCloudinarySettings() || {};
  const cloudName = env.CLOUDINARY_CLOUD_NAME || localSettings.cloudName || '';
  const apiKey = env.CLOUDINARY_API_KEY || localSettings.apiKey || '';
  const apiSecret = env.CLOUDINARY_API_SECRET || localSettings.apiSecret || '';

  if (!cloudName || !apiKey || !apiSecret) {
    return null;
  }

  try {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    const safeId = (meetingId || '').toString().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId) return null;

    const candidates = [
      `arkoo_recordings/recording_${safeId}`,
      `recording_${safeId}`,
      `arkoo_recordings/${safeId}`,
      safeId,
    ];

    for (const pid of candidates) {
      for (const rType of ['video', 'raw'] as const) {
        try {
          const res = await cloudinary.api.resource(pid, { resource_type: rType });
          if (res?.secure_url) {
            logger.info('CloudinaryService', `Verified Cloudinary resource: ${res.secure_url}`);
            return res.secure_url;
          }
        } catch {
          // not found under this candidate path/type, check next
        }
      }
    }

    return null;
  } catch (err) {
    logger.error('CloudinaryService', 'Error querying Cloudinary API for audio', err);
    return null;
  }
}
