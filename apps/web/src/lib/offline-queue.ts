/**
 * Phase 6: local audio queue for when the medic device loses connectivity
 * entirely. LiveKit already handles brief drops and jitter on its own
 * (that's the whole point of using it) — this only kicks in for a real
 * outage, where audio can't reach the server at all no matter how good
 * LiveKit's own reconnect logic is.
 *
 * Each chunk is a fragment from a single continuous MediaRecorder session
 * (timeslice-based), so fragments only decode as valid audio when
 * concatenated in the order they were recorded — see `concatenateChunks`.
 */

const DB_NAME = "relay-offline-queue";
const STORE = "audio-chunks";
const DB_VERSION = 1;

interface QueuedChunk {
  id?: number;
  transportId: string;
  seq: number;
  blob: Blob;
  recordedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("transportId", "transportId");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function addChunk(transportId: string, seq: number, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ transportId, seq, blob, recordedAt: Date.now() } satisfies QueuedChunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function getChunks(transportId: string): Promise<QueuedChunk[]> {
  const db = await openDb();
  const chunks = await new Promise<QueuedChunk[]>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("transportId");
    const request = index.getAll(IDBKeyRange.only(transportId));
    request.onsuccess = () => resolve(request.result as QueuedChunk[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return chunks.sort((a, b) => a.seq - b.seq);
}

export async function clearChunks(transportId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const index = tx.objectStore(STORE).index("transportId");
    const request = index.openCursor(IDBKeyRange.only(transportId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function concatenateChunks(chunks: QueuedChunk[], mimeType: string): Blob {
  return new Blob(
    chunks.map((c) => c.blob),
    { type: mimeType },
  );
}
