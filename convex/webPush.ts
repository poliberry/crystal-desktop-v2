import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";

/**
 * Web Push for the installed web app (and any browser tab that allowed notifications).
 *
 * The browser hands us a subscription (an endpoint at its push service plus two public keys); we keep one
 * row per browser per account. `notifyUsers` then schedules `webPushNode.send` next to the mobile (Expo)
 * push, with the same title, the same already-generic body for encrypted messages, and a deep link.
 *
 * Keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in the Convex environment (generate a pair with
 * `bunx web-push generate-vapid-keys`), and VAPID_SUBJECT (a mailto: or https: contact). Without them,
 * `publicKey` returns null and the client doesn't offer push.
 */

const MAX_PER_USER = 10;

export const publicKey = query({
  args: {},
  handler: async () => process.env.VAPID_PUBLIC_KEY ?? null,
});

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, { endpoint, p256dh, auth, userAgent }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 2000 || p256dh.length > 200 || auth.length > 100) throw new Error("That isn't a push subscription.");
    // The same browser re-subscribing, or a browser that now belongs to a different account: one row, this account.
    const existing = await ctx.db.query("webPushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { userId: me._id, p256dh, auth, userAgent: userAgent?.slice(0, 200) });
      return existing._id;
    }
    const mine = await ctx.db.query("webPushSubscriptions").withIndex("by_user", (q) => q.eq("userId", me._id)).collect();
    // Oldest go first when someone has a lot of browsers.
    for (const old of mine.sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, mine.length - MAX_PER_USER + 1))) await ctx.db.delete(old._id);
    return ctx.db.insert("webPushSubscriptions", { userId: me._id, endpoint, p256dh, auth, userAgent: userAgent?.slice(0, 200), createdAt: Date.now() });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db.query("webPushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).first();
    if (row && row.userId === me._id) await ctx.db.delete(row._id);
  },
});

export const forUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    (await ctx.db.query("webPushSubscriptions").withIndex("by_user", (q) => q.eq("userId", userId)).collect()).map((s) => ({
      id: s._id,
      endpoint: s.endpoint,
      p256dh: s.p256dh,
      auth: s.auth,
    })),
});

/** After a send: forget subscriptions the push service says are gone, and note the ones that worked. */
export const settle = internalMutation({
  args: { gone: v.array(v.id("webPushSubscriptions")), ok: v.array(v.id("webPushSubscriptions")) },
  handler: async (ctx, { gone, ok }) => {
    for (const id of gone) if (await ctx.db.get(id)) await ctx.db.delete(id);
    const now = Date.now();
    for (const id of ok) if (await ctx.db.get(id)) await ctx.db.patch(id, { lastSuccessAt: now });
  },
});

/** Where a notification should take you when it's tapped, as a path in the web app. */
export function deepLinkFor(n: {
  type: string;
  conversationId?: Id<"conversations">;
  channelId?: Id<"channels">;
  communityId?: Id<"communities">;
}): { url: string; answerUrl?: string; tag?: string } {
  if (n.conversationId) {
    const url = `/app/#/dm/${n.conversationId}`;
    return n.type === "call_ring" ? { url, answerUrl: `/app/#/call/dm/${n.conversationId}`, tag: `call:${n.conversationId}` } : { url, tag: `dm:${n.conversationId}` };
  }
  if (n.communityId && n.channelId) {
    const url = `/app/#/community/${n.communityId}/${n.channelId}`;
    return n.type === "stream_started" || n.type === "call_started"
      ? { url, answerUrl: `/app/#/call/channel/${n.communityId}/${n.channelId}`, tag: `channel:${n.channelId}` }
      : { url, tag: `channel:${n.channelId}` };
  }
  if (n.type === "friend_request" || n.type === "friend_accept") return { url: "/app/#/friends", tag: "friends" };
  return { url: "/app/" };
}
