/**
 * Redis caching abstraction for hot chat paths.
 *
 * Goal per guide:
 *  - Messages (recent 100-500 per channel) in Redis, DB is source of truth
 *  - Channels / communities / DMs metadata: short TTL + explicit invalidation,
 *    NOT Cloudflare CDN (permission-sensitive)
 *  - Presence/typing/unread → realtime / WebSocket, never cached at CDN
 *
 * Convex cannot run Redis inside its runtime, so we use Upstash Redis (HTTP)
 * via Convex actions (`convex/cache.ts`). This module is the *client-side*
 * affordance: it only decides cache keys/TTLs and when to bypass.
 *
 * Server-side cache keys (see convex/cache.ts):
 *  - channel:{id}:messages       → latest N messages (list, 60s TTL, invalidated on send)
 *  - channel:{id}:meta           → channel row (300s TTL)
 *  - community:{id}:channels     → channel list (120s TTL)
 *  - community:{id}:members      → member list slice (60s TTL)
 *  - dm:{id}:messages            → latest N DM messages
 *  - user:{id}:conversations     → conversation list (60s TTL)
 */

export type CacheNamespace =
  | "channelMessages"
  | "dmMessages"
  | "channelMeta"
  | "communityChannels"
  | "communityMembers"
  | "conversations";

export interface CacheHint {
  namespace: CacheNamespace;
  key: string;
  ttlSeconds: number;
  // When true, the server will serve from Redis if present, else hit DB and repopulate
  staleWhileRevalidate?: boolean;
}

export function channelMessagesHint(channelId: string, limit = 50): CacheHint {
  return {
    namespace: "channelMessages",
    key: `channel:${channelId}:messages:${limit}`,
    ttlSeconds: 30,
    staleWhileRevalidate: true,
  };
}

export function dmMessagesHint(conversationId: string, limit = 50): CacheHint {
  return {
    namespace: "dmMessages",
    key: `dm:${conversationId}:messages:${limit}`,
    ttlSeconds: 30,
    staleWhileRevalidate: true,
  };
}

export function channelMetaHint(channelId: string): CacheHint {
  return { namespace: "channelMeta", key: `channel:${channelId}:meta`, ttlSeconds: 120 };
}

export function communityChannelsHint(communityId: string): CacheHint {
  return { namespace: "communityChannels", key: `community:${communityId}:channels`, ttlSeconds: 60 };
}

// ---------------------------------------------------------------------------
// Client-side invalidation
// Call after mutations so next read is fresh. Server also invalidates on
// write, but client invalidation avoids a stale render before subscription catches up.
// ---------------------------------------------------------------------------

/**
 * Keys to invalidate after sending a message. The server does the real
 * invalidation; this just clears the client's SWR overlay (message-cache / persistent-cache)
 * so the list re-renders from the next query.
 */
export function invalidationKeysForSend(target: { channelId?: string; conversationId?: string }): string[] {
  if (target.channelId) return [`channel:${target.channelId}`];
  if (target.conversationId) return [`dm:${target.conversationId}`];
  return [];
}

// ---------------------------------------------------------------------------
// Upstash env check (client only needs to know if server has it)
// ---------------------------------------------------------------------------

export function isRedisEnabledOnClient(): boolean {
  // Server truth is via `convex/cache.ts:isEnabled`. Client can optimistically
  // assume enabled; queries will just be slightly slower if not.
  return true;
}
