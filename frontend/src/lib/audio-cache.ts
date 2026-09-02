// ─── IndexedDB Local Audio Cache for Recorded Meetings ─────────
const DB_NAME = 'arkoo_audio_cache';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;

function openAudioDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudioToLocalCache(meetingId: string, blob: Blob): Promise<void> {
  if (!meetingId || !blob) return;
  try {
    const db = await openAudioDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(blob, meetingId);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  } catch (err) {
    console.warn('[AudioCache] Failed to save local audio cache:', err);
  }
}

export async function getAudioFromLocalCache(meetingId: string): Promise<Blob | null> {
  if (!meetingId) return null;
  try {
    const db = await openAudioDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(meetingId);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
