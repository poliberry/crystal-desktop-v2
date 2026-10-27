import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { getCurrentUserOrThrow } from "./users";
import { e2eeEnforced } from "./lib/e2eeEnforce";
import { genericNotificationBody, isMessageNotification, mustGenericize } from "./lib/e2eePure";

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

/**
 * The current device's VoIP (PushKit) token, which rings it through CallKit.
 * Upserted by token like `registerToken`, so a phone that changes hands moves
 * to whoever is signed in now.
 */
export const registerVoipToken = mutation({
  args: {
    voipToken: v.string(),
    environment: v.union(v.literal("sandbox"), v.literal("production")),
    expoPushToken: v.optional(v.string()),
  },
  handler: async (ctx, { voipToken, environment, expoPushToken }) => {
    const me = await getCurrentUserOrThrow(ctx);
    if (!/^[0-9a-f]{32,200}$/i.test(voipToken)) throw new Error("Invalid VoIP token.");
    const existing = await ctx.db
      .query("voipPushTokens")
      .withIndex("by_token", (q) => q.eq("voipToken", voipToken))
      .unique();
    const row = { userId: me._id, environment, expoPushToken, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("voipPushTokens", { voipToken, ...row });
  },
});

export const unregisterVoipToken = mutation({
  args: { voipToken: v.string() },
  handler: async (ctx, { voipToken }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("voipPushTokens")
      .withIndex("by_token", (q) => q.eq("voipToken", voipToken))
      .unique();
    if (existing && existing.userId === me._id) await ctx.db.delete(existing._id);
  },
});

export const getVoipTokensForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("voipPushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({ voipToken: r.voipToken, environment: r.environment, expoPushToken: r.expoPushToken }));
  },
});

/** APNs said the token is dead (app deleted, token rotated). */
export const removeVoipToken = internalMutation({
  args: { voipToken: v.string() },
  handler: async (ctx, { voipToken }) => {
    const existing = await ctx.db
      .query("voipPushTokens")
      .withIndex("by_token", (q) => q.eq("voipToken", voipToken))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

/** Whether VoIP pushes can be sent at all (APNs key configured on this deployment). */
export function voipConfigured(): boolean {
  return !!(process.env.APNS_KEY_ID && process.env.APNS_PRIVATE_KEY);
}

/**
 * Whether the user has the desktop app open right now: a live `desktop`
 * session heartbeat (clients beat every 20s; see convex/presence.ts
 * `STALE_MS`), or a fresh legacy `presence` heartbeat with no sessions at
 * all (an old client, which presence treats as one implicit desktop
 * session).
 *
 * Mobile pushes are suppressed while this is true — the desktop already
 * rings/toasts through its own background notifier, so buzzing the phone
 * too is just noise. Checked both when a notification is written (to avoid
 * scheduling work) and at send time (the desktop may have opened since).
 */
const DESKTOP_ALIVE_MS = 60_000;

export const isDesktopLive = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const sessions = await ctx.db
      .query("presenceSessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (sessions.some((s) => s.platform === "desktop" && s.lastHeartbeat > now - DESKTOP_ALIVE_MS)) {
      return true;
    }
    if (sessions.length === 0) {
      const row = await ctx.db
        .query("presence")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (row && row.lastHeartbeat > now - DESKTOP_ALIVE_MS) return true;
    }
    return false;
  },
});

export const getTokensForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("devicePushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({ expoPushToken: r.expoPushToken, platform: r.platform }));
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
const MAX_PUSH_BYTES = 3800;

export const sendExpoPush = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.optional(v.string()),
    data: v.optional(v.record(v.string(), v.any())),
    authorImgUrl: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, body: scheduledBody, data, authorImgUrl }) => {
    // The desktop app opened after this was scheduled: it already notifies
    // through its own background notifier.
    if (await ctx.runQuery(internal.push.isDesktopLive, { userId })) return;
    let tokens: { expoPushToken: string; platform: "ios" | "android" }[] = await ctx.runQuery(internal.push.getTokensForUser, { userId });
    if (tokens.length === 0) return;

    // A push payload goes through Expo and Apple/Google, so it is the last place message text
    // should be. `notifyUsers` already hands over a generic body for encrypted messages; this is
    // the backstop for a caller that didn't, once E2EE_ENFORCE=1 (system messages excepted).
    const type = typeof data?.type === "string" ? data.type : "";

    // An iPhone that rings through CallKit (voipNode.ts) shouldn't also get the
    // ring as an ordinary notification.
    if (type === "call_ring" && voipConfigured()) {
      const voip = await ctx.runQuery(internal.push.getVoipTokensForUser, { userId });
      const ringing = new Set(voip.map((row) => row.expoPushToken).filter((t): t is string => !!t));
      tokens = tokens.filter((token) => !ringing.has(token.expoPushToken));
      if (tokens.length === 0) return;
    }
    const body =
      isMessageNotification(type) &&
      mustGenericize({ systemAuthored: data?.systemAuthored === true, enforced: e2eeEnforced() })
        ? genericNotificationBody(type, data?.isMention !== false)
        : scheduledBody;

    // iOS: a normal alert that asks for mutable content, so the mobile app's notification service
    // extension can rebuild it as a Communication Notification (sender avatar, decrypted text, the
    // picture). `richContent.image` is the avatar, for the extension's fallback.
    //
    // Android: data only. A push with a top-level title/body is an FCM *notification message*, which the
    // system shows by itself while the app is closed, so the app's own service never runs and can neither
    // decrypt the text nor attach the avatar and picture. The text travels as `notificationTitle` /
    // `notificationBody` instead (not `title` / `message`, which expo-notifications would present by
    // itself, a second time) and CrystalFirebaseMessagingService builds the conversation notification.
    // No `channelId` either: Expo turns it into a `notification` block, which makes Firebase show a blank
    // notification of its own and skip the service. The service creates its own channel.
    const messages = tokens.map(({ expoPushToken: to, platform }) => {
      let payload: Record<string, unknown> = { ...data, ...(authorImgUrl ? { senderAvatarUrl: authorImgUrl } : {}) };
      // Expo (and APNs/FCM behind it) refuse a message over 4 KB outright, which would lose the push
      // altogether. The encrypted text is the one big part: past the limit it goes, and the phone shows the
      // generic body instead of nothing.
      if (payload.sealed && JSON.stringify({ title, body, data: payload }).length > MAX_PUSH_BYTES) {
        payload = { ...payload, sealed: undefined };
      }
      if (platform === "android") {
        return {
          to,
          data: { ...payload, notificationTitle: title.slice(0, 200), notificationBody: body?.slice(0, 500) },
          priority: "high" as const,
        };
      }
      return {
        to,
        data: payload,
        title: title.slice(0, 200),
        body: body?.slice(0, 500),
        sound: "default" as const,
        ...(platform === "ios"
          ? {
              mutableContent: true,
              ...(authorImgUrl ? { richContent: { image: authorImgUrl } } : {}),
            }
          : {}),
      };
    });

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
