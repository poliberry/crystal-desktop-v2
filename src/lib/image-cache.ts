"use client";

import { useEffect, useState } from "react";

/**
 * An IndexedDB cache of cosmetic artwork — avatars, decorations, frames,
 * nameplates — as actual bytes rather than a warmed HTTP cache entry.
 *
 * `image-preload.ts` already fetches these early and throws the response
 * away, relying on the browser's own HTTP cache to serve it back when the
 * `<img>` that actually wants it mounts. That works, but it's borrowed room:
 * the HTTP cache is shared with everything else the app loads, has no
 * durability guarantee across a restart, and answers to eviction rules this
 * app has no say in. This is a cache of our own instead — the same content,
 * kept in a store nothing else can steal from, still there after the app
 * reopens, and available even before the network is.
 *
 * `useCachedImageSrc` is the one thing everything else in the app touches: it
 * hands back the given url unchanged (so the very first paint looks exactly
 * like it always has — a plain `<img src>` the browser fetches normally) and
 * then, once IndexedDB has answered, swaps in an object URL pointing at the
 * cached blob if there is one. Either way the network is asked again in the
 * background, so a stale cached copy is never stuck on screen.
 *
 * Object URLs handed out this way are never revoked. They cost a handle, not
 * a copy of the bytes, and revoking one that's still the `src` of an
 * on-screen `<img>` breaks that image outright — the set of distinct avatars,
 * decorations and frames a session actually touches is small enough that
 * leaking the handles for as long as the window stays open is the safer
 * trade. Electron tears them down for free when the window closes either way.
 */

const DB_NAME = "crystal-image-cache";
const DB_VERSION = 1;
const STORE = "blobs";

/** How long a cached image is trusted before it's refetched in the
 * background. Generous — Convex storage urls are content-addressed (a new
 * upload is a new url), so the same url's bytes never actually change; this
 * is about eventually forgetting artwork nobody wears anymore, not about
 * staleness. */
const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Entry = { at: number; blob: Blob };

let dbPromise: Promise<IDBDatabase | null> | null = null;

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

async function getEntry(url: string): Promise<Entry | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(url);
      request.onsuccess = () => resolve(request.result as Entry | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function putEntry(url: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite").objectStore(STORE).put({ at: Date.now(), blob }, url);
  } catch {
    /* quota, or the connection is mid version-change — skip this one */
  }
}

/** In flight, so two components asking for the same url at once — a member
 * list is fifty of the same handful of decorations — share one request
 * instead of issuing fifty. */
const inflight = new Map<string, Promise<Blob | undefined>>();

async function fetchAndCache(url: string): Promise<Blob | undefined> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const promise = (async () => {
    try {
      const response = await fetch(url);
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

/** One object URL per url, reused by every consumer — see the module doc for
 * why these are never revoked. */
const objectUrls = new Map<string, string>();

function objectUrlFor(url: string, blob: Blob): string {
  const existing = objectUrls.get(url);
  if (existing) return existing;
  const created = URL.createObjectURL(blob);
  objectUrls.set(url, created);
  return created;
}

/**
 * Warms the cache for a url nothing is displaying yet — the IndexedDB
 * counterpart to `preloadImage`'s HTTP-cache warm-up. A no-op if it's already
 * cached and still fresh.
 */
export async function preloadIntoCache(url: string): Promise<void> {
  const entry = await getEntry(url);
  if (entry && Date.now() - entry.at < IMAGE_TTL_MS) return;
  await fetchAndCache(url);
}

/**
 * A url's cached picture, once IndexedDB has answered.
 *
 * See the module doc for the shape of this: `url` back immediately, an
 * object URL once (if) the cache has one, the network re-checked either way.
 */
export function useCachedImageSrc(url: string | undefined): string | undefined {
  const [cached, setCached] = useState<string | undefined>(() =>
    url ? objectUrls.get(url) : undefined
  );

  useEffect(() => {
    if (!url) {
      setCached(undefined);
      return;
    }
    const already = objectUrls.get(url);
    if (already) setCached(already);

    let cancelled = false;
    void (async () => {
      const entry = await getEntry(url);
      if (cancelled) return;
      if (entry) setCached(objectUrlFor(url, entry.blob));

      if (!entry || Date.now() - entry.at > IMAGE_TTL_MS) {
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
