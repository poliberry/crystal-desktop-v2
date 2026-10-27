/**
 * Where this device keeps the identity private key between launches, behind one interface.
 *
 * - Desktop app: the main process seals it with the OS keystore (`electron/e2eeStore.ts`).
 * - Browser: a non-extractable AES-GCM `CryptoKey` in IndexedDB encrypts the private key, which is stored
 *   next to it. The wrapping key cannot be read out of the browser, so a copied profile directory or a
 *   leaked IndexedDB dump does not give up the identity; script running in the page still can use it,
 *   which is the limit of any web build.
 *
 * `save` answers `false` when nothing could be stored. The caller then holds the key in memory for the
 * session and says so, and the person enters the recovery key on the next launch.
 */
import { fromB64u, toB64u } from "@/lib/e2ee/crypto";
import { getDesktopAPI } from "@/lib/desktop";

export type StoredIdentity = { publicKey: string; privateKey: string };

export interface Keystore {
  kind: "electron" | "web";
  /** Whether `save` will actually keep anything. Shown to the person when it will not. */
  persistent(): Promise<boolean>;
  load(userId: string): Promise<StoredIdentity | null>;
  save(userId: string, identity: StoredIdentity): Promise<boolean>;
  clear(userId: string): Promise<void>;
}

function parse(json: string | null): StoredIdentity | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<StoredIdentity>;
    return typeof v.publicKey === "string" && typeof v.privateKey === "string" ? { publicKey: v.publicKey, privateKey: v.privateKey } : null;
  } catch {
    return null;
  }
}

function electronStore(api: NonNullable<ReturnType<typeof getDesktopAPI>>["e2ee"] & object): Keystore {
  return {
    kind: "electron",
    persistent: () => api.available().catch(() => false),
    load: async (userId) => parse(await api.get(userId).catch(() => null)),
    save: (userId, identity) => api.set(userId, JSON.stringify(identity)).catch(() => false),
    clear: (userId) => api.clear(userId).catch(() => {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Web: IndexedDB
// ---------------------------------------------------------------------------------------------

const DB_NAME = "crystal-e2ee-keys";
const WRAP_STORE = "wrap";
const BLOB_STORE = "blob";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(WRAP_STORE);
      request.result.createObjectStore(BLOB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type SealedIdentity = { iv: string; ct: string };

function webStore(): Keystore {
  const usable = typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && !!crypto.subtle;
  return {
    kind: "web",
    persistent: async () => usable,
    async load(userId) {
      if (!usable) return null;
      try {
        const db = await openDb();
        try {
          const [wrap, blob] = await Promise.all([
            done(db.transaction(WRAP_STORE).objectStore(WRAP_STORE).get(userId)) as Promise<CryptoKey | undefined>,
            done(db.transaction(BLOB_STORE).objectStore(BLOB_STORE).get(userId)) as Promise<SealedIdentity | undefined>,
          ]);
          if (!wrap || !blob) return null;
          const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(blob.iv) }, wrap, fromB64u(blob.ct));
          return parse(new TextDecoder().decode(plain));
        } finally {
          db.close();
        }
      } catch {
        return null;
      }
    },
    async save(userId, identity) {
      if (!usable) return false;
      try {
        // A fresh wrapping key each time: saving a different identity never reuses the old key and IV pair.
        const wrap = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrap, new TextEncoder().encode(JSON.stringify(identity)));
        const db = await openDb();
        try {
          // One transaction over both stores so a crash cannot pair a new key with an old blob.
          const tx = db.transaction([WRAP_STORE, BLOB_STORE], "readwrite");
          tx.objectStore(WRAP_STORE).put(wrap, userId);
          tx.objectStore(BLOB_STORE).put({ iv: toB64u(iv), ct: toB64u(ct) } satisfies SealedIdentity, userId);
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
        return true;
      } catch {
        return false;
      }
    },
    async clear(userId) {
      if (!usable) return;
      try {
        const db = await openDb();
        try {
          const tx = db.transaction([WRAP_STORE, BLOB_STORE], "readwrite");
          tx.objectStore(WRAP_STORE).delete(userId);
          tx.objectStore(BLOB_STORE).delete(userId);
          await new Promise<void>((resolve) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          });
        } finally {
          db.close();
        }
      } catch {
        // Nothing stored, or storage is blocked: either way there is nothing left to remove.
      }
    },
  };
}

let store: Keystore | null = null;

export function getKeystore(): Keystore {
  if (store) return store;
  const e2ee = getDesktopAPI()?.e2ee;
  store = e2ee ? electronStore(e2ee) : webStore();
  return store;
}
