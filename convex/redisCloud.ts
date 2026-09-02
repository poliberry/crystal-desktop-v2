"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";

/**
 * Redis Cloud adapter (TCP/TLS via ioredis).
 * Use this when you host Redis on Redis Cloud (redis.io) instead of Upstash.
 *
 * Env (Convex dashboard → Settings → Environment Variables):
 *   REDIS_URL=rediss://default:PASSWORD@redis-xxxxx.c1.region.redns.redis-cloud.com:1xxxx
 *   —or— REDIS_HOST + REDIS_PORT + REDIS_PASSWORD (+ REDIS_USERNAME, REDIS_TLS=true)
 *
 * The main `convex/cache.ts` handles Upstash REST. This file handles Redis Cloud.
 * Both are no-ops when env is absent. Pick ONE provider.
 */

function env(name: string): string | undefined {
  return process.env[name];
}
function isEnabled(): boolean {
  return !!(env("REDIS_URL") || (env("REDIS_HOST") && env("REDIS_PORT")));
}

let client: any = null;
async function getClient(): Promise<any> {
  if (client) return client;
  const { Redis } = await import("ioredis");
  if (env("REDIS_URL")) {
    client = new Redis(env("REDIS_URL")!, { lazyConnect: true, maxRetriesPerRequest: 1, enableReadyCheck: false });
  } else {
    client = new Redis({
      host: env("REDIS_HOST")!,
      port: Number(env("REDIS_PORT")!),
      username: env("REDIS_USERNAME") ?? "default",
      password: env("REDIS_PASSWORD")!,
      tls: env("REDIS_TLS") === "false" ? undefined : {},
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });
  }
  try { await client.connect(); } catch { /* retry per-request */ }
  return client;
}

export const isEnabledCheck = action({
  args: {},
  handler: async () => isEnabled(),
});

export const get = action({
  args: { key: v.string() },
  handler: async (_ctx, { key }) => {
    if (!isEnabled()) return null;
    const c = await getClient();
    const v = await c.get(key);
    if (!v) return null;
    try { return JSON.parse(v); } catch { return v; }
  },
});

export const set = action({
  args: { key: v.string(), value: v.string(), ttlSeconds: v.number() },
  handler: async (_ctx, { key, value, ttlSeconds }) => {
    if (!isEnabled()) return false;
    const c = await getClient();
    await c.set(key, value, "EX", ttlSeconds);
    return true;
  },
});

export const del = action({
  args: { keys: v.array(v.string()) },
  handler: async (_ctx, { keys }) => {
    if (!isEnabled() || keys.length === 0) return false;
    const c = await getClient();
    await c.del(...keys);
    return true;
  },
});

export const invalidateChannelCache = internalAction({
  args: { channelId: v.id("channels") },
  handler: async (_ctx, { channelId }) => {
    if (!isEnabled()) return;
    const c = await getClient();
    await c.del(`channel:${channelId}:messages:30`, `channel:${channelId}:messages:50`, `channel:${channelId}:meta`);
  },
});

export const invalidateDmCache = internalAction({
  args: { conversationId: v.id("conversations") },
  handler: async (_ctx, { conversationId }) => {
    if (!isEnabled()) return;
    const c = await getClient();
    await c.del(`dm:${conversationId}:messages:30`, `dm:${conversationId}:messages:50`);
  },
});
