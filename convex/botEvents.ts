import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { constantTimeEqual } from "./lib/botAuth";
import { QUEUE_KEEP_MS } from "./lib/botEvents";

/**
 * Collecting events, for a bot that has no endpoint to be called on: it asks, and waits a few
 * seconds for something to happen (a long poll), so nothing about it needs to be reachable from the
 * internet. `GET /bot/v1/events?after=<cursor>&wait=<seconds>` in `botHttp.ts` drives these.
 *
 * A bot that *has* an endpoint is pushed events and gets `mode: "webhook"` here, which tells its SDK
 * to stop asking. Asking is also what makes a bot "listening": events are only queued for a bot
 * that has asked recently, so a bot that is switched off collects no backlog.
 *
 * The cursor is the `_creationTime` of the last event seen. The first ask (no cursor) starts from
 * now rather than replaying the past.
 */

const MAX_PER_POLL = 100;

async function authed(ctx: { db: any }, prefix: string, hash: string) {
  const bot = await ctx.db.query("bots").withIndex("by_token_prefix", (q: any) => q.eq("tokenPrefix", prefix)).first();
  if (!bot || !constantTimeEqual(bot.tokenHash, hash)) {
    if (!bot) constantTimeEqual("0".repeat(64), hash);
    return null;
  }
  return bot;
}

export const poll = internalMutation({
  args: { prefix: v.string(), hash: v.string(), after: v.optional(v.number()) },
  handler: async (ctx, { prefix, hash, after }) => {
    const bot = await authed(ctx, prefix, hash);
    if (!bot) return { ok: false as const, status: 401, message: "That token isn't valid." };
    if (bot.suspendedAt) return { ok: false as const, status: 403, message: "This bot has been suspended." };
    if (bot.endpointUrl) return { ok: true as const, mode: "webhook" as const, events: [], cursor: after ?? Date.now() };
    const now = Date.now();
    await ctx.db.patch(bot._id, { lastPolledAt: now });
    // Old events go: nobody wants a five-minute-old "someone said hi".
    for (const old of await ctx.db.query("botEvents").withIndex("by_bot", (q) => q.eq("botId", bot._id).lt("_creationTime", now - QUEUE_KEEP_MS)).take(50)) await ctx.db.delete(old._id);
    const cursor = after ?? now;
    const rows = after === undefined ? [] : await ctx.db.query("botEvents").withIndex("by_bot", (q) => q.eq("botId", bot._id).gt("_creationTime", after)).order("asc").take(MAX_PER_POLL);
    return { ok: true as const, mode: "poll" as const, events: rows.map((r) => r.event), cursor: rows.length ? rows[rows.length - 1]._creationTime : cursor };
  },
});

/** The same question without writing anything, for the waiting loop between asks. */
export const peek = internalQuery({
  args: { prefix: v.string(), hash: v.string(), after: v.number() },
  handler: async (ctx, { prefix, hash, after }) => {
    const bot = await authed(ctx, prefix, hash);
    if (!bot || bot.suspendedAt || bot.endpointUrl) return { events: [], cursor: after };
    const rows = await ctx.db.query("botEvents").withIndex("by_bot", (q) => q.eq("botId", bot._id).gt("_creationTime", after)).order("asc").take(MAX_PER_POLL);
    return { events: rows.map((r) => r.event), cursor: rows.length ? rows[rows.length - 1]._creationTime : after };
  },
});
