import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { CONFIG_DIR } from './env.js';

// ─── Firebase Admin SDK Initialization ─────────────────────
let dbFirestore: admin.firestore.Firestore | null = null;

try {
  const firebaseConfigPath = fs.existsSync(path.join(CONFIG_DIR, 'firebase-applet-config.json'))
    ? path.join(CONFIG_DIR, 'firebase-applet-config.json')
    : path.join(process.cwd(), 'firebase-applet-config.json');

  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

    if (admin.apps.length === 0) {
      admin.initializeApp({
        projectId: firebaseConfig.projectId,
      });
    }

    dbFirestore = new admin.firestore.Firestore({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
    });
    console.log('[Firebase] Admin Firestore initialized on database:', firebaseConfig.firestoreDatabaseId);
  } else {
    console.warn('[Firebase] Config file not found. Firestore admin will be unavailable.');
  }
} catch (fbAdminError) {
  console.error('[Firebase] Admin initialization failed:', fbAdminError);
}

// ─── Verify Firestore Access ───────────────────────────────
async function verifyFirestoreAccess(): Promise<void> {
  if (!dbFirestore) return;
  try {
    await dbFirestore.collection('settings').doc('gdrive').get();
    console.log('[Firebase] Firestore backend access verified.');
  } catch (err: any) {
    const isPermissionError = err.message && (
      err.message.includes('permission') ||
      err.message.includes('PERMISSION_DENIED') ||
      err.code === 7
    );
    if (isPermissionError) {
      console.log('[Firebase] Running in client-authoritative mode (sandbox service account limits).');
    } else {
      console.log('[Firebase] Status check:', err.message || err);
    }
    dbFirestore = null;
  }
}

verifyFirestoreAccess();

// ─── Exports ───────────────────────────────────────────────
export { admin };

export function getFirestore(): admin.firestore.Firestore | null {
  return dbFirestore;
}

export function setFirestore(db: admin.firestore.Firestore | null): void {
  dbFirestore = db;
}
