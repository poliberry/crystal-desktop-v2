import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalQuery, mutation } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";

/**
 * Expo push tokens for the current user's devices. A device re-registers its
 * token on every sign-in (see the mobile app's `usePushNotifications` hook),
 * so `by_token` is unique enough to upsert against directly — this also
 * naturally reassigns a token to whoever's currently signed in on that
 * device, in case someone signs out and a different account signs in on the
 * same phone.
 */
export const registerToken = mutation({
  args: {
    expoPushToken: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
  },
  handler: async (ctx, { expoPushToken, platform }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_token", (q) => q.eq("expoPushToken", expoPushToken))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { userId: me._id, platform, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("devicePushTokens", {
        userId: me._id,
        expoPushToken,
        platform,
        updatedAt: Date.now(),
      });
    }
  },
});

export const unregisterToken = mutation({
  args: { expoPushToken: v.string() },
  handler: async (ctx, { expoPushToken }) => {
    const existing = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_token", (q) => q.eq("expoPushToken", expoPushToken))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

export const getTokensForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.expoPushToken);
  },
});

/**
 * Fans a notification out to every device the user is signed into, via
 * Expo's push service (https://exp.host/--/api/v2/push/send — no server
 * credential required for basic sends). Scheduled with `runAfter(0, ...)`
 * from `notifications.notifyUsers` so it fires just after the triggering
 * mutation commits, without making message-send/friend-request mutations
 * wait on an outbound HTTP call. Failures are logged, not thrown — a push
 * delivery hiccup shouldn't be visible to (or retried against) the caller
 * that triggered the notification.
 */
export const sendExpoPush = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.optional(v.string()),
    data: v.optional(v.record(v.string(), v.any())),
    authorImgUrl: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, body, data, authorImgUrl }) => {
    const tokens: string[] = await ctx.runQuery(internal.push.getTokensForUser, { userId });
    if (tokens.length === 0) return;

    // `richContent.image` renders as the notification's leading avatar.
    // Android shows it out of the box; iOS only invokes a notification
    // service extension to download/attach it when `mutable-content: 1` is
    // set on the APNs payload, which is what `mutableContent: true` here
    // becomes (see the mobile app's `targets/notification-service` — Expo
    // does not bundle this extension itself, it has to be built). Both
    // fields are omitted entirely when there's no avatar, rather than sent
    // as empty/undefined, since `mutableContent` with no image to fetch
    // would just cost the extension a wasted invocation.
    const messages = tokens.map((to) => ({
      to,
      title,
      body,
      data,
      sound: "default" as const,
      ...(authorImgUrl ? { richContent: { image: authorImgUrl }, mutableContent: true } : {}),
    }));

    try {
      const res = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(messages),
      });
      if (!res.ok) {
        console.error("Expo push send failed", res.status, await res.text());
      }
    } catch (err) {
      console.error("Expo push send threw", err);
    }
  },
});
