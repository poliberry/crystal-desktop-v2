import { v } from "convex/values";
import { action, internalAction, internalMutation, query } from "./_generated/server";

/**
 * Redis cache for hot chat paths (Upstash REST). Convex is source of truth;
 * Redis is hot-path. For Redis Cloud (TCP), use `convex/redisCloud.ts` — see
 * that file's doc. Both are no-ops when env absent, so dev works without Redis.
 *
 * Env (Convex dashboard → Settings → Environment Variables):
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *   —or— for Redis Cloud, set REDIS_URL in `convex/redisCloud.ts`
 *
 * Cache keys / TTL (s):
 *   channel:{id}:messages:{limit} 30, dm:{id}:messages:{limit} 30,
 *   channel:{id}:meta 120, community:{id}:channels 60, etc.
 * Invalidation is explicit (see invalidate* helpers), not CDN — channel data is
 * permission-sensitive.
 */

function env(name: string): string | undefined {
  return process.env[name];
}
function isEnabled(): boolean {
  return !!(env("UPSTASH_REDIS_REST_URL") && env("UPSTASH_REDIS_REST_TOKEN"));
}
async function redis(cmd: string, ...args: string[]): Promise<unknown> {
  const url = env("UPSTASH_REDIS_REST_URL")!;
  const token = env("UPSTASH_REDIS_REST_TOKEN")!;
  const res = await fetch(`${url.replace(/\/$/, "")}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Redis ${cmd} ${res.status}`);
  const j = (await res.json()) as { result: unknown };
  return j.result;
}
async function redisGet(key: string): Promise<string | null> {
  if (!isEnabled()) return null;
  try {
    const r = await redis("GET", key);
    return (r as string) ?? null;
  } catch { return null; }
}
async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!isEnabled()) return;
  try { await redis("SET", key, value, "EX", String(ttlSeconds)); } catch { /* non-fatal */ }
}
async function redisDel(...keys: string[]): Promise<void> {
  if (!isEnabled() || keys.length === 0) return;
  try { await redis("DEL", ...keys); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Public checks
// ---------------------------------------------------------------------------

export const isCacheEnabled = query({
  args: {},
  handler: async () => isEnabled(),
});

// ---------------------------------------------------------------------------
// Generic get/set used by other convex files (messages.ts etc.) via ctx.runAction
// ---------------------------------------------------------------------------

export const get = action({
  args: { key: v.string() },
  handler: async (_ctx, { key }) => {
    const raw = await redisGet(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  },
});

export const set = action({
  args: { key: v.string(), value: v.string(), ttlSeconds: v.number() },
  handler: async (_ctx, { key, value, ttlSeconds }) => {
    await redisSet(key, value, ttlSeconds);
    return true;
  },
});

export const invalidate = action({
  args: { keys: v.array(v.string()) },
  handler: async (_ctx, { keys }) => {
    await redisDel(...keys);
    return true;
  },
});

// Convenience: invalidate by pattern prefix (scans via SCAN, deletes matched)
// Use sparingly; prefer explicit keys on write.
export const invalidatePrefix = action({
  args: { prefix: v.string() },
  handler: async (_ctx, { prefix }) => {
    if (!isEnabled()) return { deleted: 0 };
    const url = env("UPSTASH_REDIS_REST_URL")!;
    const token = env("UPSTASH_REDIS_REST_TOKEN")!;
    let cursor = "0";
    let deleted = 0;
    do {
      const res = await fetch(`${url}/SCAN/${cursor}/MATCH/${encodeURIComponent(prefix)}*/COUNT/100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) break;
      const j = (await res.json()) as { result: [string, string[]] };
      const [next, keys] = j.result ?? ["0", []];
      cursor = next;
      if (keys.length) {
        await redisDel(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
    return { deleted };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers for other convex modules to import (not actions)
// These are duplicated as plain functions so `channelMessages.ts` can
// `import { cacheGet, cacheSet, cacheInvalidate } from "./cache"` without
// a ctx.runAction hop when running in same runtime. For "use node" actions,
// use the actions above.
// ---------------------------------------------------------------------------

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await redisGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redisSet(key, JSON.stringify(value), ttlSeconds);
}

export async function cacheInvalidateKeys(...keys: string[]): Promise<void> {
  await redisDel(...keys);
}

// ---------------------------------------------------------------------------
// Lifecycle: called from message send / edit / delete to keep cache coherent
// ---------------------------------------------------------------------------

export const onChannelMessageWrite = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (_ctx, { channelId }) => {
    await redisDel(`channel:${channelId}:messages:30`, `channel:${channelId}:messages:50`, `channel:${channelId}:meta`);
  },
});

export const invalidateChannelCache = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (_ctx, { channelId }) => {
    await redisDel(`channel:${channelId}:messages:30`, `channel:${channelId}:messages:50`, `channel:${channelId}:meta`);
  },
});

export const invalidateDmCache = internalAction({
  args: { conversationId: v.id("conversations") },
  handler: async (_ctx, { conversationId }) => {
    await redisDel(`dm:${conversationId}:messages:30`, `dm:${conversationId}:messages:50`);
  },
});
