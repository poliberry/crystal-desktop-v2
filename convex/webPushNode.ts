"use node";

import { v } from "convex/values";
import webpush from "web-push";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";

/**
 * Sends one notification to every browser a person has subscribed (see webPush.ts). Node runtime because
 * the `web-push` library encrypts payloads (RFC 8291) and signs VAPID tokens with Node's crypto.
 *
 * The payload is what public/sw.js reads: title, body, a deep link to open, and a tag so a burst of
 * messages from one conversation updates a single notification instead of stacking. Bodies for encrypted
 * messages arrive here already generic ("New message"), from `notifyUsers`.
 */
export const send = internalAction({
  args: {
    userId: v.id("users"),
    kind: v.string(),
    title: v.string(),
    body: v.optional(v.string()),
    icon: v.optional(v.string()),
    url: v.string(),
    answerUrl: v.optional(v.string()),
    tag: v.optional(v.string()),
    /** An encrypted message for the recipient's device to decrypt (see public/sw.js). */
    sealed: v.optional(
      v.object({
        scope: v.union(v.literal("conversation"), v.literal("channel")),
        targetId: v.string(),
        authorId: v.string(),
        keyId: v.string(),
        iv: v.string(),
        ct: v.string(),
        userId: v.string(),
        wrapped: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return;
    const subscriptions = await ctx.runQuery(internal.webPush.forUser, { userId: args.userId });
    if (subscriptions.length === 0) return;

    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:support@usecrystal.app", publicKey, privateKey);
    const payload = JSON.stringify({
      kind: args.kind,
      title: args.title,
      body: args.body ?? "",
      icon: args.icon,
      url: args.url,
      answerUrl: args.answerUrl,
      tag: args.tag,
      sealed: args.sealed,
      at: Date.now(),
    });

    const gone: Id<"webPushSubscriptions">[] = [];
    const ok: Id<"webPushSubscriptions">[] = [];
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            // A ring is only worth delivering while it's ringing; a message is worth a few hours.
            TTL: args.kind === "call_ring" ? 45 : 4 * 60 * 60,
            urgency: args.kind === "call_ring" ? "high" : "normal",
            topic: args.tag ? args.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) : undefined,
          });
          ok.push(s.id);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // 404/410: the browser unsubscribed or the subscription expired. Anything else is worth another try next time.
          if (status === 404 || status === 410) gone.push(s.id);
        }
      }),
    );
    if (gone.length || ok.length) await ctx.runMutation(internal.webPush.settle, { gone, ok });
  },
});
