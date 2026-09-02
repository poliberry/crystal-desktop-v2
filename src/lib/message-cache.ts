"use client";

import { useEffect } from "react";

import { readCache, useCacheHydration, writeCache } from "@/lib/persistent-cache";

/**
 * Last known first page of messages, per channel and conversation.
 *
 * Convex's `usePaginatedQuery` stamps a fresh pagination id into its query
 * args on every mount, which makes each visit to a channel a *different*
 * query from the last one: the client has nothing cached for it, so the hook
 * always starts in `LoadingFirstPage` and the view always flashes a skeleton,
 * even when the messages haven't changed since ten seconds ago. It's also why
 * preloading a message list with a plain `useQuery` doesn't help the view on
 * its own — the args can never match.
 *
 * So the page is kept here instead: whatever was last displayed (or last
 * preloaded) is painted immediately while the live query re-establishes, and
 * replaced the moment real results arrive. Stale-while-revalidate, in other
 * words — the data is only ever shown while something fresher is already on
 * its way.
 *
 * Pages are mirrored to `localStorage` as well as held in memory, so the same
 * thing happens on a cold start: reopening the app paints the conversation
 * you were in rather than a skeleton, while the websocket connects behind it.
 * Entries past their TTL are treated as absent (see src/lib/persistent-cache.ts).
 */

/** Was 50 — cut to 12 to bound RAM. 12 covers the active working set;
 * older channels reload from persistent-cache or network (still fast with
 * Convex + Redis hot path). */
const MAX_ENTRIES = 12;

/** Insertion-ordered, so the oldest key is the first one `keys()` yields. */
const pages = new Map<string, readonly unknown[]>();

export function channelMessagesKey(channelId: string): string {
  return `channel:${channelId}`;
}

export function conversationMessagesKey(conversationId: string): string {
  return `dm:${conversationId}`;
}

export function rememberFirstPage(key: string, page: readonly unknown[]): void {
  // Re-insert so a key that's still being used moves to the back of the
  // eviction order rather than ageing out while in active use.
  pages.delete(key);
  pages.set(key, page);
  while (pages.size > MAX_ENTRIES) {
    const oldest = pages.keys().next().value;
    if (oldest === undefined) break;
    pages.delete(oldest);
  }
  writeCache(`messages.${key}`, page);
}

export function recallFirstPage<T>(key: string): readonly T[] | undefined {
  const inMemory = pages.get(key) as readonly T[] | undefined;
  if (inMemory) return inMemory;
  const persisted = readCache<readonly T[]>(`messages.${key}`);
  // Promote it, so the rest of this session answers from memory and a view
  // that mounts repeatedly doesn't re-parse the same JSON each time.
  if (persisted) pages.set(key, persisted);
  return persisted;
}

/**
 * The messages to render: the live results once they're in, and the last
 * known page until then.
 *
 * `loading` should be exactly `status === "LoadingFirstPage"` — later pages
 * arriving is not a reason to fall back to a page that has fewer of them.
 */
export function useCachedFirstPage<T>(
  key: string,
  results: readonly T[],
  loading: boolean
): readonly T[] {
  // Re-renders this once IndexedDB hydration lands — see persistent-cache.ts.
  useCacheHydration();

  useEffect(() => {
    if (!loading) rememberFirstPage(key, results);
  }, [key, loading, results]);

  return loading ? (recallFirstPage<T>(key) ?? []) : results;
}
