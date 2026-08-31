"use client";

import type { OutboxEntry } from "@/lib/outbox-types";

/**
 * Raw IndexedDB access for the durable send outbox.
 *
 * Same defensive posture as src/lib/persistent-cache.ts: every operation
 * resolves rather than rejects when IndexedDB is missing or blocked, so a
 * caller never has to catch and the app degrades to "writes go straight to
 * Convex, nothing survives a reload" rather than breaking.
 *
 * The public surface (enqueue, the in-memory mirror, the React glue) lives in
 * src/lib/outbox.ts — this file only knows about bytes on disk.
 */

const DB_NAME = "crystal-outbox";
const DB_VERSION = 1;

/** One row per queued mutation. `keyPath: "id"` — the op id doubles as the
 * send idempotency key. */
export const OPS_STORE = "ops";
/** Attachment bytes for a queued send, keyed `"<opId>:<index>"`. Kept out of
 * the op row so a 5 MB photo doesn't get read every time the queue is
 * scanned. */
export const BLOBS_STORE = "blobs";

export interface StoredBlob {
  blob: Blob;
  fileName: string;
  fileType: string;
  fileSize: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openOutboxDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OPS_STORE)) {
          const ops = db.createObjectStore(OPS_STORE, { keyPath: "id" });
          ops.createIndex("by_user", "userId");
          ops.createIndex("by_user_target", ["userId", "targetKey"]);
          ops.createIndex("by_user_status", ["userId", "status"]);
        }
        if (!db.objectStoreNames.contains(BLOBS_STORE)) {
          db.createObjectStore(BLOBS_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Every op for one account, oldest `seq` first. */
export async function loadUserEntries(userId: string): Promise<OutboxEntry[]> {
  const db = await openOutboxDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const index = db
        .transaction(OPS_STORE, "readonly")
        .objectStore(OPS_STORE)
        .index("by_user");
      const request = index.getAll(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const rows = (request.result as OutboxEntry[]) ?? [];
        rows.sort((a, b) => a.seq - b.seq);
        resolve(rows);
      };
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function putEntry(entry: OutboxEntry): Promise<void> {
  const db = await openOutboxDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(OPS_STORE, "readwrite");
      tx.objectStore(OPS_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function deleteEntry(id: string): Promise<void> {
  const db = await openOutboxDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction([OPS_STORE, BLOBS_STORE], "readwrite");
      tx.objectStore(OPS_STORE).delete(id);
      // Sweep any attachment blobs this op stashed. `openCursor` over a bound
      // range on the string key `"<id>:*"`.
      const blobs = tx.objectStore(BLOBS_STORE);
      const range = IDBKeyRange.bound(`${id}:`, `${id}:￿`);
      const cursorReq = blobs.openKeyCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          blobs.delete(cursor.key);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function putBlob(key: string, value: StoredBlob): Promise<boolean> {
  const db = await openOutboxDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(BLOBS_STORE, "readwrite");
      tx.objectStore(BLOBS_STORE).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function getBlob(key: string): Promise<StoredBlob | undefined> {
  const db = await openOutboxDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db
        .transaction(BLOBS_STORE, "readonly")
        .objectStore(BLOBS_STORE)
        .get(key);
      request.onsuccess = () => resolve(request.result as StoredBlob | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}
