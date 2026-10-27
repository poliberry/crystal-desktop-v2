"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A small stale-while-revalidate cache on top of IndexedDB.
 *
 * The in-memory caches elsewhere in the app (see src/lib/message-cache.ts)
 * make *switching* between views instant, but they die with the window. A
 * cold start therefore paints empty panes and waits on a websocket handshake
 * before anything appears, which is the slowest moment in the app and the one
 * a user notices most. This survives the restart.
 *
 * Everything written here is a copy of server state that the live Convex
 * subscription is already on its way to replace, so entries are only ever a
 * first paint — never the source of truth, and never written back anywhere.
 *
 * ## Why there's a memo map in front of an IndexedDB that already has one
 *
 * Every read here happens synchronously, during render — that's the whole
 * point, a value has to be there on the very first paint. IndexedDB has no
 * synchronous read, in any browser, ever; even a request that resolves
 * "immediately" still does it on a later microtask. So `readCache` only ever
 * looks at `memo`, a plain object kept in sync with IndexedDB by hand:
 * `writeCache` updates it before it fires off the (unawaited) write to
 * IndexedDB, and `hydrateNamespace` fills it from IndexedDB once, right after
 * a cold start, before anything has had a chance to write to it directly.
 *
 * That leaves exactly one gap: the render that happens *before* hydration has
 * finished. Nothing blocks for it — gating the whole app behind an IndexedDB
 * read would trade a fast, harmless cache miss for a slower, riskier one, and
 * the sign-in screen doesn't need this cache to be there to render. Instead
 * `useCacheHydration` below hands out a tick that changes the moment
 * hydration lands, so the two hooks built on this (`useCachedQuery`,
 * `useCachedFirstPage`) re-render once with real data a few milliseconds
 * later — still far ahead of the websocket handshake this cache exists to
 * get in front of.
 */

/**
 * How long an entry may be served before it's treated as absent.
 *
 * Was 60 min — cut to 15 min to bound RAM/disk and avoid painting stale
 * membership/channel state after a long idle. Live Convex subscriptions still
 * replace it in <1s during use; this only matters after a cold start or
 * long background.
 */
export const CACHE_TTL_MS = 15 * 60 * 1000;

/** Hard cap on in-memory entries — evict LRU beyond this. Cut from 100
 * to 60: each entry can be a full channel list or member array (~50-200KB
 * JSON). 60 covers the working set; older entries reload from IndexedDB
 * (still faster than the websocket) or Redis. */
export const MAX_MEMO_ENTRIES = 60;

const PREFIX = "crystal.cache.v1.";

type Entry<T> = { at: number; data: T };

/**
 * Which account's cache is in play. Set on sign-in, so switching accounts
 * can't paint the previous user's servers for a frame before the real data
 * lands.
 */
let namespace = "anon";

export function setCacheNamespace(userId: string | null | undefined): void {
  const next = userId ?? "anon";
  if (next === namespace) return;
  namespace = next;
  memo.clear();
  // The namespace is switched synchronously so children cannot render another
  // account's cached values. Subscribers are notified after the current React
  // render; notifying inline here updates components while CacheScope renders.
  queueMicrotask(notify);
  void hydrateNamespace(next);
}

/** Every read goes through this — see the module doc for why. */
const memo = new Map<string, Entry<unknown>>();

function storageKey(key: string): string {
  return `${PREFIX}${namespace}.${key}`;
}

export function readCache<T>(key: string): T | undefined {
  const cached = memo.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.at > CACHE_TTL_MS) {
    memo.delete(key);
    return undefined;
  }
  return cached.data as T;
}

export function writeCache<T>(key: string, data: T): void {
  const entry: Entry<T> = { at: Date.now(), data };
  const isNew = !memo.has(key);
  // LRU cap: evict oldest first. Re-insert moves key to end (most recent).
  if (!isNew) memo.delete(key);
  memo.set(key, entry);
  if (memo.size > MAX_MEMO_ENTRIES) {
    const oldest = memo.keys().next().value as string | undefined;
    if (oldest) memo.delete(oldest);
  }
  // Only a key that wasn't there is news to anyone. Replacing a value that already was changes nothing a reader can
  // see: whoever wrote it has live data, and a reader without live data was already being handed the older copy.
  if (isNew) notifyKey(key);
  scheduleWrite(storageKey(key), entry);
}

// --- Write coalescing --------------------------------------------------------

/**
 * How long a write waits for a newer one to replace it before it goes to IndexedDB.
 *
 * A live query writes its result on *every* change, and IndexedDB copies the whole value each time (structured clone, on the
 * main thread, of a channel list or member array that can be 50–200 KB). A member list during a busy hour changes several
 * times a second; that was several hundred KB of cloning a second to store something that is only ever read once, at the
 * next launch. Only the last value of a burst matters, so a burst is one write.
 */
const WRITE_DELAY_MS = 1500;

const pendingWrites = new Map<string, Entry<unknown>>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleWrite(fullKey: string, entry: Entry<unknown>): void {
  pendingWrites.set(fullKey, entry);
  if (writeTimer) return;
  writeTimer = setTimeout(flushWrites, WRITE_DELAY_MS);
}

/** Writes everything waiting. Also called as the window is hidden or closed, so the last moments before a quit are kept. */
export function flushWrites(): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (pendingWrites.size === 0) return;
  const batch = [...pendingWrites];
  pendingWrites.clear();
  for (const [fullKey, entry] of batch) void putEntry(fullKey, entry);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushWrites);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushWrites();
  });
}

// --- IndexedDB -------------------------------------------------------------

const DB_NAME = "crystal-cache";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Opened once and reused — `indexedDB.open` is cheap to call again, but
 * there's no reason to pay even that twice. Resolves to `null` rather than
 * rejecting when IndexedDB is missing or blocked, since a cache miss is
 * always a valid answer here and nothing downstream should have to catch. */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE);
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

async function putEntry(fullKey: string, entry: Entry<unknown>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put(entry, fullKey);
  } catch {
    // Quota, or the transaction outlived the database (e.g. a version change
    // elsewhere). The in-memory copy already made it into `memo`; the next
    // write gets another chance.
  }
}

async function deleteEntries(fullKeys: string[]): Promise<void> {
  if (fullKeys.length === 0) return;
  const db = await openDb();
  if (!db) return;
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const key of fullKeys) store.delete(key);
  } catch {
    /* next prune gets another chance */
  }
}

/** Namespaces already loaded into `memo` this session — hydrating twice would
 * just repeat the same cursor scan for no new data. */
const hydrated = new Set<string>();

/**
 * Loads one account's worth of entries from IndexedDB into `memo`.
 *
 * Fired once per namespace, from `setCacheNamespace` — nothing awaits it,
 * because nothing can: it runs alongside the very first render rather than
 * before it. `useCacheHydration` is how the two hooks built on this cache
 * find out when it lands.
 */
async function hydrateNamespace(ns: string): Promise<void> {
  if (hydrated.has(ns)) return;
  hydrated.add(ns);
  const db = await openDb();
  if (!db) return;

  const prefix = `${PREFIX}${ns}.`;
  const now = Date.now();
  const doomed: string[] = [];

  await new Promise<void>((resolve) => {
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      const range = IDBKeyRange.bound(prefix, prefix + "￿", false, false);
      const request = store.openCursor(range);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const entry = cursor.value as Entry<unknown>;
        const fullKey = String(cursor.key);
        if (typeof entry?.at === "number" && now - entry.at <= CACHE_TTL_MS) {
          // Only if this is still the active namespace and nothing has
          // already written a fresher value for this key since hydration
          // started — a live query effect racing ahead of us wins.
          const bareKey = fullKey.slice(prefix.length);
          if (ns === namespace && !memo.has(bareKey)) memo.set(bareKey, entry);
        } else {
          doomed.push(fullKey);
        }
        cursor.continue();
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  if (doomed.length) void deleteEntries(doomed);
  if (ns === namespace) notify();
}

/**
 * Drop every entry past its TTL, including other accounts' — expiry is the
 * only thing that bounds this cache's size, so it has to run over the whole
 * store rather than just the current namespace.
 */
export async function pruneExpired(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const now = Date.now();
  const doomed: string[] = [];
  await new Promise<void>((resolve) => {
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const entry = cursor.value as Entry<unknown>;
        if (typeof entry?.at !== "number" || now - entry.at > CACHE_TTL_MS) {
          doomed.push(String(cursor.key));
        }
        cursor.continue();
      };
      request.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  await deleteEntries(doomed);
}

// --- Hydration notifications ------------------------------------------------

type Listener = () => void;

/** Bumped when the whole cache changes under everyone: a namespace finishing hydration, or an account switch. */
let epoch = 0;

/**
 * Who is listening, by the key they care about (`null`: the cache as a whole).
 *
 * This used to be one global tick that every `writeCache` bumped, which woke every `useCachedQuery` and
 * `useCachedFirstPage` in the app on every write — and each of those writes on every change to its own live data. One
 * presence blip in a member list therefore re-rendered every cached view on screen, and the member list, the sidebar and
 * each community card all write. Nothing needs that: once a query has live data it never reads the cache again, so the
 * only change a reader can use is *its own key appearing* (a write that adds it, or hydration that loads it).
 */
const listeners = new Map<string | null, Set<Listener>>();

/** Calls `listener` when `key` first appears (or, for `null`, never on its own) and whenever the whole cache changes under
 * everyone. `useCacheHydration` is this plus React; it is exported so the behaviour can be tested without rendering. */
export function subscribeCache(key: string | null, listener: () => void): () => void {
  return addListener(key, listener);
}

function addListener(key: string | null, listener: Listener): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  const mine = set;
  mine.add(listener);
  return () => {
    mine.delete(listener);
    if (mine.size === 0 && listeners.get(key) === mine) listeners.delete(key);
  };
}

/** Everything changed: tell every listener, whichever key it is watching. */
function notify(): void {
  epoch++;
  for (const set of [...listeners.values()]) for (const listener of [...set]) listener();
}

/** One key went from absent to present: tell only the listeners watching it. */
function notifyKey(key: string): void {
  const set = listeners.get(key);
  if (set) for (const listener of [...set]) listener();
}

/**
 * Re-renders the caller when this cache has something new for it — the instant IndexedDB catches up, or (with `key`)
 * when a value for that key first becomes available — without either `useCachedQuery` or `useCachedFirstPage` polling,
 * or this module reaching into React to force a render.
 *
 * Pass the key being read. Without one, only a hydration or an account switch is reported.
 */
export function useCacheHydration(key?: string | null): number {
  const watched = key ?? null;
  const subscribe = useCallback((listener: Listener) => addListener(watched, listener), [watched]);
  // The epoch says "re-read everything"; the low bit says "this key is here now". Both are plain numbers, so the store's
  // snapshot is stable between renders unless one of them really changed.
  const snapshot = () => epoch * 2 + (watched !== null && memo.has(watched) ? 1 : 0);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
