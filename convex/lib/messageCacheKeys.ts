/**
 * Keys of the Redis first-page message caches (see convex/cache.ts).
 *
 * The version is in the key so a page cached before E2EE, with plaintext rows in it, is never served
 * once rows may be ciphertext: the old keys are simply never read again and age out on their TTL.
 * Bump it whenever the shape of a cached row changes in a way an old entry would get wrong.
 */
export const MESSAGE_CACHE_VERSION = "e2ee1";

/** The page sizes the clients ask for; writes drop all of them. */
export const CACHED_PAGE_SIZES = [20, 25, 30, 50] as const;

export const channelPageKey = (channelId: string, numItems: number) =>
  `channel:${channelId}:messages:${MESSAGE_CACHE_VERSION}:${numItems}`;

export const dmPageKey = (conversationId: string, numItems: number) =>
  `dm:${conversationId}:messages:${MESSAGE_CACHE_VERSION}:${numItems}`;

export const channelPageKeys = (channelId: string) => CACHED_PAGE_SIZES.map((n) => channelPageKey(channelId, n));

export const dmPageKeys = (conversationId: string) => CACHED_PAGE_SIZES.map((n) => dmPageKey(conversationId, n));
