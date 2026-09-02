"use client";

import { useEffect, useState } from "react";

/**
 * IndexedDB caches of remote artwork — as actual bytes rather than a warmed
 * HTTP cache entry.
 *
 * `image-preload.ts` fetches artwork early and throws the response away,
 * relying on the browser's own HTTP cache to serve it back when the `<img>`
 * that wants it mounts. That works, but it's borrowed room: the HTTP cache is
 * shared with everything else, has no durability guarantee across a restart,
 * and answers to eviction rules this app has no say in. These are caches of our
 * own instead — the same content, kept in stores nothing else can steal from,
 * still there after the app reopens, and available even before the network is.
 *
 * ## Two stores, by size class
 *
 * - **`crystal-image-cache`** — the small, numerous, forever things: avatars,
 *   decorations, frames, nameplates, custom emoji, banners, chat backgrounds,
 *   board images, badges. A generous entry/byte cap with LRU eviction.
 * - **`crystal-attachment-cache`** — message image attachments. These are
 *   bigger and burstier (someone drops twenty photos into a channel), so they
 *   get their own store with a larger byte budget: an image flood can't evict
 *   every avatar, and the two can be pruned on independent schedules.
 *
 * `useCachedImageSrc` / `useCachedAttachmentSrc` are what components touch:
 * they hand back the given url unchanged (so the first paint is a plain
 * `<img src>` the browser fetches normally) and then, once IndexedDB has
 * answered, swap in an object URL pointing at the cached blob if there is one.
 * Either way the network is asked again in the background, so a stale cached
 * copy is never stuck on screen.
 *
 * Object URLs handed out this way are never revoked. They cost a handle, not a
 * copy of the bytes, and revoking one that's still the `src` of an on-screen
 * `<img>` breaks that image outright — the set of distinct urls a session
 * actually touches is small enough that leaking the handles for as long as the
 * window stays open is the safer trade. Electron tears them down for free when
 * the window closes either way.
 */

interface Entry {
  /** When the bytes were fetched — drives the background-refresh decision. */
  at: number;
  /** When the entry was last handed to a component — drives LRU eviction. */
  lastAccess: number;
  /** `blob.size`, denormalised so a prune pass doesn't have to read every
   * blob to add up the store's weight. */
  size: number;
  blob: Blob;
}

interface CacheConfig {
  dbName: string;
  /** How long a cached copy is trusted before it's refetched in the
   * background. Convex storage urls are content-addressed (a new upload is a
   * new url) so the bytes at a url never actually change; this is about
   * eventually forgetting artwork nobody references anymore. */
  ttlMs: number;
  /** Soft ceiling on entry count. Checked by `prune`. */
  maxEntries: number;
  /** Soft ceiling on total bytes. Checked by `prune`. */
  maxBytes: number;
}

const STORE = "blobs";

function isCdnUrl(url: string): boolean {
  const cdn = process.env.NEXT_PUBLIC_R2_PUBLIC_URL ?? process.env.NEXT_PUBLIC_CDN_URL ?? "";
  if (cdn && url.startsWith(cdn.replace(/\/$/, ""))) return true;
  if (url.includes("crystal-cdn.poliberry.com")) return true;
  if (url.includes(".r2.cloudflarestorage.com")) return true;
  if (url.includes("/migrated/")) return true;
  return false;
}

function createBlobCache(config: CacheConfig) {
  let dbPromise: Promise<IDBDatabase | null> | null = null;

  function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      try {
        const request = indexedDB.open(config.dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE)) {
            request.result.createObjectStore(STORE);
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

  async function getEntry(url: string): Promise<Entry | undefined> {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const request = db
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .get(url);
        request.onsuccess = () => resolve(request.result as Entry | undefined);
        request.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async function writeEntry(url: string, entry: Entry): Promise<boolean> {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(entry, url);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async function putEntry(url: string, blob: Blob): Promise<void> {
    const entry: Entry = {
      at: Date.now(),
      lastAccess: Date.now(),
      size: blob.size,
      blob,
    };
    const ok = await writeEntry(url, entry);
    if (!ok) {
      // Quota, or the connection is mid version-change. Make room and try once
      // more — a store that's already full is the common case here.
      await prune(true);
      await writeEntry(url, entry);
    }
  }

  /** Bump `lastAccess` so a url a component is actively rendering doesn't age
   * out from under it. Fire-and-forget — the value it writes is only consulted
   * by `prune`. */
  function touch(url: string, entry: Entry): void {
    if (Date.now() - entry.lastAccess < 60_000) return;
    void writeEntry(url, { ...entry, lastAccess: Date.now() });
  }

  /** In flight, so two components asking for the same url at once — a member
   * list is fifty of the same handful of decorations — share one request
   * instead of issuing fifty. */
  const inflight = new Map<string, Promise<Blob | undefined>>();

  async function fetchAndCache(url: string): Promise<Blob | undefined> {
    if (isCdnUrl(url)) return undefined; // CDN is the cache — <img src> loads directly, no CORS blob fetch
    const existing = inflight.get(url);
    if (existing) return existing;
    const promise = (async () => {
      try {
        const response = await fetch(url, { mode: "cors", credentials: "omit" });
        if (!response.ok) return undefined;
        const blob = await response.blob();
        void putEntry(url, blob);
        return blob;
      } catch {
        return undefined;
      } finally {
        inflight.delete(url);
      }
    })();
    inflight.set(url, promise);
    return promise;
  }

  /** One object URL per url, reused by every consumer. Bounded + revocable
   * to avoid the 1GB-RAM leak: we keep at most 80 live handles and revoke
   * the LRU when over. Electron frees them on window close anyway. */
  const objectUrls = new Map<string, string>();
  const MAX_OBJECT_URLS = 80;

  function objectUrlFor(url: string, blob: Blob): string {
    const existing = objectUrls.get(url);
    if (existing) return existing;
    // Evict LRU if over cap — revoke so bytes are actually freed.
    if (objectUrls.size >= MAX_OBJECT_URLS) {
      const oldest = objectUrls.keys().next().value as string | undefined;
      if (oldest) {
        const oldUrl = objectUrls.get(oldest)!;
        try { URL.revokeObjectURL(oldUrl); } catch { /* ignore */ }
        objectUrls.delete(oldest);
      }
    }
    const created = URL.createObjectURL(blob);
    objectUrls.set(url, created);
    return created;
  }

  /** Revoke all — called on logout / memory pressure. */
  function revokeAll(): void {
    for (const u of objectUrls.values()) { try { URL.revokeObjectURL(u); } catch { /* ignore */ } }
    objectUrls.clear();
  }

  /**
   * Drop expired entries, then — if the store is still over its caps — evict
   * by ascending `lastAccess` until it's back under. `aggressive` halves the
   * targets, used right after a failed write to clear real headroom.
   */
  async function prune(aggressive = false): Promise<void> {
    const db = await openDb();
    if (!db) return;
    const now = Date.now();
    const entries: { key: string; at: number; lastAccess: number; size: number }[] =
      [];
    const expired: string[] = [];

    await new Promise<void>((resolve) => {
      try {
        const request = db
          .transaction(STORE, "readonly")
          .objectStore(STORE)
          .openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as Entry;
          const key = String(cursor.key);
          if (typeof value?.at !== "number" || now - value.at > config.ttlMs) {
            expired.push(key);
          } else {
            entries.push({
              key,
              at: value.at,
              lastAccess: value.lastAccess ?? value.at,
              size: value.size ?? value.blob?.size ?? 0,
            });
          }
          cursor.continue();
        };
        request.onerror = () => resolve();
      } catch {
        resolve();
      }
    });

    const doomed = new Set(expired);
    let count = entries.length;
    let bytes = entries.reduce((sum, e) => sum + e.size, 0);
    const maxEntries = aggressive ? config.maxEntries / 2 : config.maxEntries;
    const maxBytes = aggressive ? config.maxBytes / 2 : config.maxBytes;

    if (count > maxEntries || bytes > maxBytes) {
      const byAge = [...entries].sort((a, b) => a.lastAccess - b.lastAccess);
      for (const entry of byAge) {
        if (count <= maxEntries && bytes <= maxBytes) break;
        doomed.add(entry.key);
        count -= 1;
        bytes -= entry.size;
      }
    }

    if (doomed.size === 0) return;
    const db2 = await openDb();
    if (!db2) return;
    try {
      const store = db2.transaction(STORE, "readwrite").objectStore(STORE);
      for (const key of doomed) store.delete(key);
    } catch {
      /* next prune gets another chance */
    }
  }

  /**
   * Warm the cache for a url nothing is displaying yet — the IndexedDB
   * counterpart to `preloadImage`'s HTTP-cache warm-up. A no-op if it's
   * already cached and still fresh.
   */
  async function preload(url: string): Promise<void> {
    if (isCdnUrl(url)) return; // let browser HTTP cache + CDN edge handle it
    const entry = await getEntry(url);
    if (entry && Date.now() - entry.at < config.ttlMs) return;
    await fetchAndCache(url);
  }

  /** Seed the cache with bytes we already hold — used right after uploading an
   * attachment, so the message row that follows paints from cache instead of
   * re-downloading what we just sent. */
  async function seed(url: string, blob: Blob): Promise<void> {
    await putEntry(url, blob);
  }

  /**
   * A url's cached picture, once IndexedDB has answered.
   *
   * `url` back immediately, an object URL once (if) the cache has one, the
   * network re-checked either way.
   */
  function useCachedSrc(url: string | undefined): string | undefined {
    if (url && isCdnUrl(url)) return url; // CDN: direct <img src>, no blob/cache, no CORS fetch
    const [cached, setCached] = useState<string | undefined>(() =>
      url ? objectUrls.get(url) : undefined,
    );

    useEffect(() => {
      if (!url || isCdnUrl(url)) {
        if (url) setCached(undefined);
        return;
      }
      const already = objectUrls.get(url);
      if (already) setCached(already);

      let cancelled = false;
      void (async () => {
        const entry = await getEntry(url);
        if (cancelled) return;
        if (entry) {
          setCached(objectUrlFor(url, entry.blob));
          touch(url, entry);
        }

        if (!entry || Date.now() - entry.at > config.ttlMs) {
          const blob = await fetchAndCache(url);
          if (!cancelled && blob) setCached(objectUrlFor(url, blob));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [url]);

    return cached ?? url;
  }

  // Kick a prune shortly after load so old week/month entries get evicted
  // under the new tighter caps without waiting for a quota error.
  if (typeof window !== "undefined") {
    setTimeout(() => void prune(), 5000);
  }

  return { preload, seed, prune, useCachedSrc, revokeAll };
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const imageCache = createBlobCache({
  dbName: "crystal-image-cache",
  ttlMs: THREE_DAYS_MS,
  maxEntries: 300,
  maxBytes: 20 * 1024 * 1024,
});

const attachmentCache = createBlobCache({
  dbName: "crystal-attachment-cache",
  ttlMs: WEEK_MS,
  maxEntries: 150,
  maxBytes: 40 * 1024 * 1024,
});

// --- Small artwork (avatars, cosmetics, emoji, banners, badges) -------------

/** See the module doc. The one thing most of the app touches. */
export function useCachedImageSrc(url: string | undefined): string | undefined {
  return imageCache.useCachedSrc(url);
}

/**
 * The same thing for a CSS `background-image`: returns `url("…")` ready to drop
 * into a `style` prop, or `undefined` while there's nothing to show. Safe
 * because the underlying hook returns the plain url first and only swaps to the
 * blob once IndexedDB answers — no flash.
 */
export function useCachedBackgroundImage(
  url: string | undefined,
): string | undefined {
  const src = useCachedImageSrc(url);
  return src ? `url("${src}")` : undefined;
}

/** Warm `crystal-image-cache` for a url nothing is showing yet. */
export function preloadIntoCache(url: string): Promise<void> {
  return imageCache.preload(url);
}

/** Expiry + LRU sweep of `crystal-image-cache`. Call occasionally. */
export function pruneImageCache(): Promise<void> {
  return imageCache.prune();
}

// --- Message attachment images ---------------------------------------------

/** Like `useCachedImageSrc` but backed by the roomier attachment store. */
export function useCachedAttachmentSrc(
  url: string | undefined,
): string | undefined {
  return attachmentCache.useCachedSrc(url);
}

/** Warm the attachment store for an image nobody has opened yet. */
export function preloadAttachmentIntoCache(url: string): Promise<void> {
  return attachmentCache.preload(url);
}

/** Seed the attachment store with bytes we already hold (post-upload). */
export function writeAttachmentCache(url: string, blob: Blob): Promise<void> {
  return attachmentCache.seed(url, blob);
}

/** Expiry + LRU sweep of `crystal-attachment-cache`. */
export function pruneAttachmentCache(): Promise<void> {
  return attachmentCache.prune();
}
