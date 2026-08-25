"use client";

/**
 * A small stale-while-revalidate cache on top of `localStorage`.
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
 */

/**
 * How long an entry may be served before it's treated as absent.
 *
 * An hour is far longer than the sub-second it takes a subscription to
 * replace it; the bound is about not painting something wildly out of date
 * after the app has been shut for a weekend, not about freshness during use.
 */
export const CACHE_TTL_MS = 60 * 60 * 1000;

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
}

/** Reads hit this before `localStorage`; a JSON parse per render is the one
 * cost this layer could plausibly add, and it's easy not to pay. */
const memo = new Map<string, Entry<unknown>>();

function storageKey(key: string): string {
  return `${PREFIX}${namespace}.${key}`;
}

export function readCache<T>(key: string): T | undefined {
  const cached = memo.get(key);
  if (cached) {
    return Date.now() - cached.at > CACHE_TTL_MS ? undefined : (cached.data as T);
  }
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(key));
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Entry<T>;
    if (typeof entry?.at !== "number") return undefined;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
      window.localStorage.removeItem(storageKey(key));
      return undefined;
    }
    memo.set(key, entry);
    return entry.data;
  } catch {
    // Corrupt entry, quota error, or storage disabled. A cache miss is always
    // a valid answer here — the live query is what actually feeds the UI.
    return undefined;
  }
}

export function writeCache<T>(key: string, data: T): void {
  const entry: Entry<T> = { at: Date.now(), data };
  memo.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Almost always the quota. Drop everything expired and try once more;
    // if it still doesn't fit, the in-memory copy above is enough for this
    // session and the next start simply pays full price.
    pruneExpired();
    try {
      window.localStorage.setItem(storageKey(key), JSON.stringify(entry));
    } catch {
      /* give up — nothing here is worth failing a render over */
    }
  }
}

/**
 * Drop every entry past its TTL, including other accounts' — expiry is the
 * only thing that bounds this cache's size, so it has to run over the whole
 * prefix rather than just the current namespace.
 */
export function pruneExpired(): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const entry = JSON.parse(window.localStorage.getItem(key) ?? "") as Entry<unknown>;
        if (typeof entry?.at !== "number" || now - entry.at > CACHE_TTL_MS) doomed.push(key);
      } catch {
        doomed.push(key);
      }
    }
    for (const key of doomed) window.localStorage.removeItem(key);
    memo.clear();
  } catch {
    /* storage unavailable */
  }
}
