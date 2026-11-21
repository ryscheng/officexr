const DB_NAME = 'officexr-portraits';
const STORE = 'portraits';

/** Bump to drop every stored portrait, e.g. after changing the portrait framing or lighting. */
export const PORTRAIT_STORE_VERSION = 1;

export interface PortraitStore {
  read(url: string): Promise<string | null>;
  write(url: string, image: string): Promise<void>;
}

const storeKey = (url: string) => `${PORTRAIT_STORE_VERSION}:${url}`;

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(DB_NAME, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE);
  return promisify(request);
}

/** A portrait store in IndexedDB. Every failure (private mode, blocked storage, quota) reads as a miss and a skipped write. */
export function createPortraitStore(factory: IDBFactory | undefined = globalThis.indexedDB): PortraitStore {
  let database: Promise<IDBDatabase | null> | undefined;
  const open = () => {
    database ??= factory ? openDatabase(factory).catch(() => null) : Promise.resolve(null);
    return database;
  };
  return {
    async read(url) {
      try {
        const db = await open();
        const value = db ? await promisify(db.transaction(STORE).objectStore(STORE).get(storeKey(url))) : null;
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    async write(url, image) {
      try {
        const db = await open();
        if (db) {
          await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).put(image, storeKey(url)));
        }
      } catch {
        return;
      }
    },
  };
}
