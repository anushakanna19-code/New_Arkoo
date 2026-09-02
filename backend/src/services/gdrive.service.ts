import fs from 'fs';
import { env, GDRIVE_SETTINGS_FILE } from '../config/env.js';
import { getFirestore } from '../config/firebase.js';
import { logger } from '../utils/logger.js';

// ─── Google Drive Service ──────────────────────────────────

// ─── Settings Persistence ──────────────────────────────────

export function loadGDriveSettings(): any {
  try {
    if (fs.existsSync(GDRIVE_SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(GDRIVE_SETTINGS_FILE, 'utf8'));
    }
  } catch (err) {
    logger.error('GDriveService', 'Failed to read settings', err);
  }
  return null;
}

export function saveGDriveSettings(data: any): void {
  try {
    fs.writeFileSync(GDRIVE_SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
    logger.info('GDriveService', `Saved settings to ${GDRIVE_SETTINGS_FILE}`);
  } catch (err) {
    logger.error('GDriveService', 'Failed to write settings', err);
  }
}

export function deleteGDriveSettings(): void {
  try {
    if (fs.existsSync(GDRIVE_SETTINGS_FILE)) {
      fs.unlinkSync(GDRIVE_SETTINGS_FILE);
      logger.info('GDriveService', 'Deleted local Google Drive settings.');
    }
  } catch (err) {
    logger.error('GDriveService', 'Failed to delete settings', err);
  }
}

// ─── OAuth Helpers ─────────────────────────────────────────

export function checkOauthConfigured(): boolean {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) return false;

  const cid = clientId.toLowerCase();
  const sec = clientSecret.toLowerCase();

  const placeholders = ['1234', '5678', 'example', 'my_', 'my_client_id', 'my_client_secret', 'placeholder', ''];
  if (placeholders.some(p => cid === p || cid.includes('example') || cid.startsWith('my_'))) return false;
  if (placeholders.some(p => sec === p || sec.includes('example') || sec.startsWith('my_'))) return false;

  return true;
}

export async function refreshGoogleAccessToken(refreshToken: string): Promise<string | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !refreshToken) return null;

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text();
      logger.error('GDriveService', 'Token refresh failed', new Error(errTxt));
      return null;
    }

    const data = await res.json() as any;
    if (data.access_token) {
      logger.info('GDriveService', 'Successfully refreshed access token');

      const settings = loadGDriveSettings() || {};
      settings.accessToken = data.access_token;
      settings.expiryTime = Date.now() + (data.expires_in || 3600) * 1000;
      saveGDriveSettings(settings);

      return data.access_token;
    }
  } catch (err) {
    logger.error('GDriveService', 'Token refresh error', err);
  }
  return null;
}

// ─── Drive File Operations ─────────────────────────────────

export function extractDriveFileId(url: string | null | undefined): string | null {
  if (!url) return null;
  const fileDMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]{25,})/);
  if (fileDMatch) return fileDMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;
  return null;
}

export function extractDriveFolderId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/folders\/([a-zA-Z0-9_-]{25,})/);
  if (match) return match[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{25,})/);
  if (idMatch) return idMatch[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url.trim())) return url.trim();
  return null;
}

export async function validateDriveFolder(accessToken: string, folderId: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,capabilities,trashed`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 404) return { valid: false, error: 'Folder not found in Google Drive.' };
      const errText = await res.text();
      return { valid: false, error: `Validation failed: Status ${res.status}. ${errText}` };
    }

    const folderData = await res.json() as any;
    if (folderData.trashed) return { valid: false, error: 'Folder is in the trash.' };
    if (folderData.capabilities?.canAddChildren === false) {
      return { valid: false, error: 'Insufficient permissions to write to this folder.' };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Network failure: ${err.message || err}` };
  }
}

export async function findOrCreateFolderInDrive(accessToken: string, name: string, parentId?: string): Promise<string> {
  let query = `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;

  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Failed to check folder "${name}": ${errText}`);
  }

  const searchResult = await searchRes.json() as any;
  if (searchResult.files?.length > 0) return searchResult.files[0].id;

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create folder "${name}": ${errText}`);
  }

  const createResult = await createRes.json() as any;
  return createResult.id;
}

export async function uploadFileToDriveFolder(
  accessToken: string,
  fileName: string,
  mimeType: string,
  fileDataBuffer: Buffer,
  folderId: string
): Promise<{ id: string; webViewLink: string }> {
  const metadata = { name: fileName, parents: [folderId], mimeType };
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const multipartBody = Buffer.concat([
    Buffer.from(delimiter),
    Buffer.from('Content-Type: application/json; charset=UTF-8\r\n\r\n'),
    Buffer.from(JSON.stringify(metadata)),
    Buffer.from(delimiter),
    Buffer.from(`Content-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n`),
    Buffer.from(fileDataBuffer.toString('base64')),
    Buffer.from(closeDelim),
  ]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Google Drive upload failed: ${errText}`);
  }

  const data = await uploadRes.json() as any;

  // Set "anyone with link" read permission
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });
  } catch (permErr) {
    logger.warn('GDriveService', 'Could not set reader permission', { fileId: data.id });
  }

  return data;
}

export async function uploadFileToDriveWithRetry(
  accessToken: string,
  name: string,
  mimeType: string,
  fileContentBuffer: Buffer,
  parentId: string,
  maxRetries = 3
): Promise<any> {
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info('GDriveService', `Upload attempt ${attempt}/${maxRetries}: ${name}`);
      return await uploadFileToDriveFolder(accessToken, name, mimeType, fileContentBuffer, parentId);
    } catch (err: any) {
      lastError = err;
      logger.warn('GDriveService', `Attempt ${attempt} failed: ${err.message || err}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, attempt * 2000));
      }
    }
  }
  throw lastError || new Error(`Failed to upload ${name} after ${maxRetries} attempts.`);
}

/**
 * Resolve an active Google Drive access token from various sources.
 */
export async function resolveActiveToken(googleAccessToken?: string): Promise<string | null> {
  let activeToken = googleAccessToken || null;
  const localSettings = loadGDriveSettings();

  if (localSettings?.connectionStatus === 'connected') {
    if (!activeToken) activeToken = localSettings.accessToken;
    if (localSettings.expiryTime && Date.now() > localSettings.expiryTime && localSettings.refreshToken) {
      logger.info('GDriveService', 'Token expired. Refreshing...');
      const refreshed = await refreshGoogleAccessToken(localSettings.refreshToken);
      if (refreshed) activeToken = refreshed;
    }
  } else if (!activeToken) {
    const dbFirestore = getFirestore();
    if (dbFirestore) {
      try {
        const snap = await dbFirestore.collection('settings').doc('gdrive').get();
        if (snap.exists) {
          const d = snap.data();
          if (d?.connectionStatus === 'connected') {
            activeToken = d.accessToken;
            saveGDriveSettings(d);
            if (d.expiryTime && Date.now() > d.expiryTime && d.refreshToken) {
              const refreshed = await refreshGoogleAccessToken(d.refreshToken);
              if (refreshed) activeToken = refreshed;
            }
          }
        }
      } catch (e: any) {
        logger.warn('GDriveService', 'Fallback token retrieval from Firestore failed', { error: e.message });
      }
    }
  }

  return activeToken;
}
