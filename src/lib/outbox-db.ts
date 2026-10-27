"use client";

import type { OutboxEntry, SendArgs } from "@/lib/outbox-types";

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

// --- sealing message text at rest ----------------------------------------
//
// A queued message is the one place a user's plaintext sits on disk for any length of time (offline,
// or waiting for E2EE to be ready). So what is secret — the text, and the reply snapshot's text and
// author — is sealed with the device key (`getE2ee().atRest`) and stored in `sealed`; the row keeps
// only routing data. Rows written before encryption existed still have `args.text` in the clear:
// they are accepted on read, and rewritten sealed straight away (see `loadUserEntries`).

/** What goes inside `sealed`. */
interface SecretFields {
  text?: string;
  replyToPreview?: SendArgs["replyToPreview"];
}

type StoredEntry = OutboxEntry & { sealed?: Uint8Array };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function atRest() {
  const { getE2ee } = await import("@/lib/e2ee");
  return getE2ee().atRest;
}

function secretsOf(entry: OutboxEntry): SecretFields | null {
  const args = entry.args;
  if (args.kind === "send" && (args.text !== undefined || args.replyToPreview)) {
    return { text: args.text, replyToPreview: args.replyToPreview };
  }
  if (args.kind === "edit") return { text: args.text };
  return null;
}

/** The row as it goes to disk, or `null` when it holds a secret that cannot be sealed right now.
 * In that case nothing is written: the entry lives on in memory and is sent this session, but a
 * reload loses it. Losing a queued message beats leaving its text readable on disk. */
async function sealForDisk(entry: OutboxEntry, secrets: SecretFields | null): Promise<StoredEntry | null> {
  if (!secrets) return entry;
  try {
    const sealed = await (await atRest()).seal(encoder.encode(JSON.stringify(secrets)));
    const args =
      entry.args.kind === "send"
        ? { ...entry.args, text: undefined, replyToPreview: undefined }
        : entry.args.kind === "edit"
          ? { ...entry.args, text: "" }
          : entry.args;
    return { ...entry, args: args as OutboxEntry["args"], sealed };
  } catch {
    return null;
  }
}

/** `undefined` when the sealed part cannot be opened (yet): the caller leaves the row alone. */
async function openFromDisk(stored: StoredEntry): Promise<OutboxEntry | undefined> {
  const { sealed, ...entry } = stored;
  if (!sealed) return entry; // no secret, or a legacy plaintext row
  try {
    const opened = await (await atRest()).open(sealed);
    if (!opened) return undefined;
    const secrets = JSON.parse(decoder.decode(opened)) as SecretFields;
    if (entry.args.kind === "send") {
      return { ...entry, args: { ...entry.args, text: secrets.text, replyToPreview: secrets.replyToPreview } };
    }
    if (entry.args.kind === "edit") return { ...entry, args: { ...entry.args, text: secrets.text ?? "" } };
    return entry;
  } catch {
    return undefined;
  }
}

/** A row nobody could open for this long is not coming back. */
const UNREADABLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Writes for one entry are applied in the order they were asked for. Sealing is asynchronous, and
// without this a slow earlier write could land after a later one (or after the delete).
const chains = new Map<string, Promise<void>>();

function inOrder(id: string, work: () => Promise<void>): Promise<void> {
  const next = (chains.get(id) ?? Promise.resolve()).then(work, work);
  chains.set(id, next);
  void next.finally(() => {
    if (chains.get(id) === next) chains.delete(id);
  });
  return next;
}

/** Every op for one account, oldest `seq` first. */
export async function loadUserEntries(userId: string): Promise<OutboxEntry[]> {
  const db = await openOutboxDb();
  if (!db) return [];
  const rows = await new Promise<StoredEntry[]>((resolve) => {
    try {
      const index = db
        .transaction(OPS_STORE, "readonly")
        .objectStore(OPS_STORE)
        .index("by_user");
      const request = index.getAll(IDBKeyRange.only(userId));
      request.onsuccess = () => resolve((request.result as StoredEntry[]) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  const entries: OutboxEntry[] = [];
  for (const stored of rows) {
    const entry = await openFromDisk(stored);
    if (!entry) {
      if (Date.now() - stored.createdAt > UNREADABLE_TTL_MS) void deleteEntry(stored.id);
      continue;
    }
    // A legacy row still has its text in the clear on disk: rewrite it sealed.
    if (!stored.sealed && secretsOf(entry)) void putEntry(entry);
    entries.push(entry);
  }
  entries.sort((a, b) => a.seq - b.seq);
  return entries;
}

export function putEntry(entry: OutboxEntry): Promise<void> {
  // Snapshot now: the caller keeps mutating the entry while the write waits its turn.
  const snapshot: OutboxEntry = { ...entry, args: { ...entry.args } as OutboxEntry["args"] };
  const secrets = secretsOf(snapshot);
  return inOrder(entry.id, async () => {
    const stored = await sealForDisk(snapshot, secrets);
    if (!stored) return;
    await writeRow(stored);
  });
}

async function writeRow(entry: StoredEntry): Promise<void> {
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

export function deleteEntry(id: string): Promise<void> {
  return inOrder(id, () => removeRow(id));
}

async function removeRow(id: string): Promise<void> {
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
