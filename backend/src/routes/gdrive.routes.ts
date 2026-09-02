import { Router } from 'express';
import * as gdrive from '../services/gdrive.service.js';
import { getFirestore, admin } from '../config/firebase.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ─── Get Auth URL ──────────────────────────────────────────
router.get('/auth-url', (_req, res) => {
  if (!gdrive.checkOauthConfigured()) {
    return res.status(400).json({ error: 'Google Drive OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' });
  }

  const redirectUri = `${env.APP_URL}/auth/callback`;
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
    access_type: 'offline',
    prompt: 'consent',
  });

  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

// ─── Get Status ────────────────────────────────────────────
router.get('/status', async (_req, res) => {
  try {
    let data = gdrive.loadGDriveSettings();
    const isOauthConfigured = gdrive.checkOauthConfigured();
    const dbFirestore = getFirestore();

    if (!data && dbFirestore) {
      try {
        const docSnap = await dbFirestore.collection('settings').doc('gdrive').get();
        if (docSnap.exists) {
          data = docSnap.data();
          if (data) gdrive.saveGDriveSettings(data);
        }
      } catch (fsErr: any) {
        logger.warn('GDriveRoutes', 'Firestore status retrieval failed', { error: fsErr.message });
      }
    }

    if (!data || data.connectionStatus !== 'connected') {
      return res.json({ connected: false, isOauthConfigured });
    }

    let accessToken = data.accessToken || '';
    const refreshToken = data.refreshToken || '';
    let expiryTime = data.expiryTime || 0;
    const folderId = data.folderId || '';
    const folderLink = data.folderLink || (folderId ? `https://drive.google.com/drive/folders/${folderId}` : '');
    const email = data.userEmail || 'Admin';
    const lastSynced = data.lastSynced ? (data.lastSynced.toDate ? data.lastSynced.toDate() : new Date(data.lastSynced)) : null;

    // Refresh if expiring in 5 minutes
    if (expiryTime < Date.now() + 300 * 1000 && refreshToken) {
      const refreshed = await gdrive.refreshGoogleAccessToken(refreshToken);
      if (refreshed) {
        accessToken = refreshed;
        expiryTime = Date.now() + 3600 * 1000;
      }
    }

    res.json({
      connected: true, isOauthConfigured, accessToken, folderId, folderLink,
      userEmail: email,
      lastSynced: lastSynced ? (typeof lastSynced === 'string' ? lastSynced : lastSynced.toISOString()) : null,
      expiryTime,
    });
  } catch (error: any) {
    logger.error('GDriveRoutes', 'Status query failed', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Disconnect ────────────────────────────────────────────
router.post('/disconnect', async (_req, res) => {
  try {
    gdrive.deleteGDriveSettings();
    const dbFirestore = getFirestore();
    if (dbFirestore) {
      try {
        await dbFirestore.collection('settings').doc('gdrive').update({
          connectionStatus: 'disconnected',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (dbErr: any) {
        logger.warn('GDriveRoutes', 'Firestore disconnect write failed', { error: dbErr.message });
      }
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Save Token ────────────────────────────────────────────
router.post('/save-token', async (req, res) => {
  const { accessToken, userEmail, folderId } = req.body;
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });

  try {
    const backupCache = gdrive.loadGDriveSettings() || {};
    const gdriveData = {
      accessToken, refreshToken: backupCache.refreshToken || accessToken || '',
      userEmail: userEmail || 'Admin', folderId: folderId || backupCache.folderId || '',
      connectionStatus: 'connected', expiryTime: Date.now() + 3600 * 1000,
    };
    gdrive.saveGDriveSettings(gdriveData);

    const dbFirestore = getFirestore();
    if (dbFirestore) {
      await dbFirestore.collection('settings').doc('gdrive').set(
        { ...gdriveData, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Save Folder ───────────────────────────────────────────
router.post('/save-folder', async (req, res) => {
  const { folderLink, googleAccessToken } = req.body;
  if (!folderLink) return res.status(400).json({ error: 'Missing folderLink' });

  const folderId = gdrive.extractDriveFolderId(folderLink);
  if (!folderId) return res.status(400).json({ error: 'Invalid folder link format.' });

  try {
    let activeToken = googleAccessToken;
    if (!activeToken) {
      const localSettings = gdrive.loadGDriveSettings();
      if (localSettings?.connectionStatus === 'connected') activeToken = localSettings.accessToken;
    }

    if (activeToken) {
      const validation = await gdrive.validateDriveFolder(activeToken, folderId);
      if (!validation.valid) return res.status(400).json({ error: validation.error });
    }

    const data = gdrive.loadGDriveSettings() || {};
    gdrive.saveGDriveSettings({ ...data, folderId, folderLink });

    const dbFirestore = getFirestore();
    if (dbFirestore) {
      await dbFirestore.collection('settings').doc('gdrive').set(
        { folderId, folderLink, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      ).catch(() => {});
    }

    res.json({ success: true, folderId, folderLink });
  } catch (error: any) {
    logger.error('GDriveRoutes', 'Save folder failed', error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Retry Drive Upload ───────────────────────────────────
router.post('/retry-upload/:meetingId', async (req, res) => {
  const { meetingId } = req.params;
  try {
    const dbFirestore = getFirestore();
    if (!dbFirestore) return res.status(500).json({ error: 'Firestore not initialized.' });

    const meetingSnap = await dbFirestore.collection('meetings').doc(meetingId).get();
    if (!meetingSnap.exists) return res.status(404).json({ error: 'Meeting not found.' });

    const meeting = meetingSnap.data() as any;
    const activeToken = await gdrive.resolveActiveToken();
    if (!activeToken) return res.status(400).json({ error: 'Google Drive not connected.' });

    if (!meeting.audioUrl) return res.status(400).json({ error: 'No audio URL available.' });

    const audioRes = await fetch(meeting.audioUrl);
    if (!audioRes.ok) throw new Error(`Failed to download audio from ${meeting.audioUrl}`);

    const fileContentBuffer = Buffer.from(await audioRes.arrayBuffer());
    const now = meeting.createdAt?.toDate ? meeting.createdAt.toDate() : new Date();
    const [yyyy, mm, dd] = [now.getFullYear().toString(), (now.getMonth() + 1).toString().padStart(2, '0'), now.getDate().toString().padStart(2, '0')];

    // Get root folder
    let rootFolderId = '';
    const settingsSnap = await dbFirestore.collection('settings').doc('gdrive').get();
    if (settingsSnap.exists) rootFolderId = settingsSnap.data()?.folderId || '';

    if (!rootFolderId) return res.status(400).json({ error: 'No Google Drive folder configured.' });

    const recsFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, 'Meeting Recordings', rootFolderId);
    const yyyyFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, yyyy, recsFolderId);
    const mmFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, mm, yyyyFolderId);
    const dateFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, dd, mmFolderId);

    const ext = meeting.audioUrl.split('.').pop()?.split('?')[0] || 'webm';
    const driveResult = await gdrive.uploadFileToDriveWithRetry(activeToken, `recording_${meetingId}.${ext}`, `audio/${ext === 'mp3' ? 'mpeg' : ext}`, fileContentBuffer, dateFolderId);

    await dbFirestore.collection('meetings').doc(meetingId).update({
      driveFileId: driveResult.id, driveFileUrl: driveResult.webViewLink,
      gdriveUploadStatus: 'completed', gdriveUploadTimestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true, driveFileId: driveResult.id, driveFileUrl: driveResult.webViewLink });
  } catch (error: any) {
    logger.error('GDriveRoutes', `Retry upload failed for ${meetingId}`, error);
    res.status(500).json({ error: error.message });
  }
});

// ─── Upload Report PDF ─────────────────────────────────────
router.post('/upload-report', async (req, res) => {
  try {
    const { meetingId, pdfBase64, googleAccessToken } = req.body;
    if (!meetingId || !pdfBase64) return res.status(400).json({ error: 'Missing meetingId or pdfBase64' });

    const activeToken = await gdrive.resolveActiveToken(googleAccessToken);
    if (!activeToken) return res.status(400).json({ error: 'Google Drive not connected.' });

    const dbFirestore = getFirestore();
    let dateStr = new Date().toISOString().split('T')[0];
    if (dbFirestore) {
      try {
        const meetingDoc = await dbFirestore.collection('meetings').doc(meetingId).get();
        if (meetingDoc.exists) {
          const mData = meetingDoc.data();
          if (mData?.createdAt) dateStr = (mData.createdAt.toDate ? mData.createdAt.toDate() : new Date(mData.createdAt)).toISOString().split('T')[0];
        }
      } catch { /* use current date */ }
    }

    const [yyyy, mm, dd] = dateStr.split('-');
    let rootFolderId = '';
    if (dbFirestore) {
      try {
        const snap = await dbFirestore.collection('settings').doc('gdrive').get();
        if (snap.exists) rootFolderId = snap.data()?.folderId || '';
      } catch { /* use local */ }
    }
    if (!rootFolderId) rootFolderId = gdrive.loadGDriveSettings()?.folderId || '';
    if (!rootFolderId) return res.status(400).json({ error: 'No Drive folder configured.' });

    const meetingsFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, 'Meeting Recordings', rootFolderId);
    const yyyyFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, yyyy, meetingsFolderId);
    const mmFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, mm, yyyyFolderId);
    const dateFolderId = await gdrive.findOrCreateFolderInDrive(activeToken, dd, mmFolderId);

    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const driveResult = await gdrive.uploadFileToDriveFolder(activeToken, `report_${meetingId}.pdf`, 'application/pdf', pdfBuffer, dateFolderId);

    if (dbFirestore) {
      try {
        await dbFirestore.collection('meetings').doc(meetingId).update({ pdfDriveFileId: driveResult.id, pdfDriveFileUrl: driveResult.webViewLink });
      } catch { /* best effort */ }
    }

    res.json({ success: true, pdfDriveFileId: driveResult.id, pdfDriveFileUrl: driveResult.webViewLink });
  } catch (error: any) {
    logger.error('GDriveRoutes', 'Report upload failed', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
