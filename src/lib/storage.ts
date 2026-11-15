/**
 * Saves the project and original video files on the device (IndexedDB),
 * so iOS closing the Safari tab does not lose your work. Nothing is uploaded.
 */
import type { Asset, Project } from '../types';

const DB_NAME = 'ai-video-studio';
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error || req.error);
        t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
      }),
  );
}

export async function saveFile(assetId: string, blob: Blob): Promise<void> {
  await tx('files', 'readwrite', (s) => s.put(blob, assetId));
}

export async function loadFile(assetId: string): Promise<Blob | undefined> {
  return tx('files', 'readonly', (s) => s.get(assetId) as IDBRequest<Blob | undefined>);
}

export async function deleteFile(assetId: string): Promise<void> {
  await tx('files', 'readwrite', (s) => s.delete(assetId));
}

export interface SavedState {
  project: Project;
  assets: Record<string, Asset>;
}

export async function saveState(state: SavedState): Promise<void> {
  await tx('kv', 'readwrite', (s) => s.put(state, 'state'));
}

export async function loadState(): Promise<SavedState | undefined> {
  return tx('kv', 'readonly', (s) => s.get('state') as IDBRequest<SavedState | undefined>);
}

export async function clearAll(): Promise<void> {
  await tx('files', 'readwrite', (s) => s.clear());
  await tx('kv', 'readwrite', (s) => s.clear());
}

/** Ask Safari not to evict our storage. Returns whether it was granted. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
