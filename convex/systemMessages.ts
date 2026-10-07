import { v } from "convex/values";

import type { Id, Doc } from "./_generated/dataModel";
import { internalMutation, mutation } from "./_generated/server";
import { notifyUsers } from "./notifications";
import { audit, requireStaff } from "./lib/staff";

const SYSTEM_CLERK_ID = "system:crystal";
const SYSTEM_AVATAR_URL = "https://usecrystal.app/crystal-official-avatar.svg";
const SYSTEM_BANNER_URL = "https://usecrystal.app/crystal-official-banner.svg";

async function systemUser(ctx: { db: any }): Promise<Doc<"users">> {
  const existing = await ctx.db.query("users").withIndex("by_clerk_id", (q: any) => q.eq("clerkId", SYSTEM_CLERK_ID)).unique();
  if (existing) {
    if (existing.imageUrl !== SYSTEM_AVATAR_URL || existing.bannerUrl !== SYSTEM_BANNER_URL) {
      await ctx.db.patch(existing._id, { imageUrl: SYSTEM_AVATAR_URL, bannerUrl: SYSTEM_BANNER_URL });
    }
    const badge = await ctx.db.query("badges").withIndex("by_badge_id", (q: any) => q.eq("badgeId", "official")).unique();
    if (!badge) await ctx.db.insert("badges", { badgeId: "official", label: "OFFICIAL", description: "Official Crystal system account.", icon: "BsPatchCheckFill", className: "text-sky-400", position: -1 });
    const official = await ctx.db.query("userBadges").withIndex("by_user_badge", (q: any) => q.eq("userId", existing._id).eq("badgeId", "official")).unique();
    if (!official) await ctx.db.insert("userBadges", { userId: existing._id, badgeId: "official", grantedAt: Date.now() });
    return (await ctx.db.get(existing._id))!;
  }
  const id = await ctx.db.insert("users", { clerkId: SYSTEM_CLERK_ID, name: "Crystal", username: "crystal", imageUrl: SYSTEM_AVATAR_URL, bannerUrl: SYSTEM_BANNER_URL });
  const badge = await ctx.db.query("badges").withIndex("by_badge_id", (q: any) => q.eq("badgeId", "official")).unique();
  if (!badge) await ctx.db.insert("badges", { badgeId: "official", label: "OFFICIAL", description: "Official Crystal system account.", icon: "BsPatchCheckFill", className: "text-sky-400", position: -1 });
  await ctx.db.insert("userBadges", { userId: id, badgeId: "official", grantedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

async function sendToUser(ctx: any, sender: Doc<"users">, recipientId: Id<"users">, body: string) {
  if (recipientId === sender._id) return;
  const key = [sender._id, recipientId].sort().join(":");
  let conversation = await ctx.db.query("conversations").withIndex("by_dm_key", (q: any) => q.eq("dmKey", key)).unique();
  const now = Date.now();
  if (!conversation) {
    const conversationId = await ctx.db.insert("conversations", { type: "dm", dmKey: key, createdBy: sender._id, createdAt: now });
    await ctx.db.insert("conversationMembers", { conversationId, userId: sender._id, joinedAt: now, lastReadAt: now });
    await ctx.db.insert("conversationMembers", { conversationId, userId: recipientId, joinedAt: now, lastReadAt: 0 });
    conversation = await ctx.db.get(conversationId);
  }
  if (!conversation) throw new Error("Could not create system conversation.");
  const messageId = await ctx.db.insert("messages", { conversationId: conversation._id, authorId: sender._id, text: body });
  await notifyUsers(ctx, { userIds: [recipientId], actorId: sender._id, type: "dm_message", conversationId: conversation._id, messageId, title: sender.name, body });
}

/** Idempotently provisions the official Crystal identity and its badge. */
export const provision = internalMutation({
  args: {},
  handler: async (ctx) => {
    const account = await systemUser(ctx);
    return { userId: account._id, username: account.username, imageUrl: account.imageUrl, bannerUrl: account.bannerUrl, badgeId: "official" };
  },
});

export const send = mutation({
  args: {
    audience: v.union(v.literal("all"), v.literal("user"), v.literal("selected")),
    userId: v.optional(v.id("users")),
    userIds: v.optional(v.array(v.id("users"))),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const staff = await requireStaff(ctx, "system.broadcast");
    const body = args.body.trim().slice(0, 4000);
    if (body.length < 1) throw new Error("Message cannot be empty.");
    let recipients: Doc<"users">[];
    if (args.audience === "user") {
      if (!args.userId) throw new Error("Choose a user.");
      const user = await ctx.db.get(args.userId); if (!user) throw new Error("User not found."); recipients = [user];
    } else if (args.audience === "selected") {
      recipients = await Promise.all((args.userIds ?? []).slice(0, 100).map((id) => ctx.db.get(id))).then((rows) => rows.filter((row): row is Doc<"users"> => !!row));
    } else {
      recipients = await ctx.db.query("users").take(1000);
    }
    const sender = await systemUser(ctx);
    for (const recipient of recipients) await sendToUser(ctx, sender, recipient._id, body);
    await audit(ctx, staff.user._id, "system_message.send", { type: "systemAccount", id: sender._id }, `${args.audience}: ${recipients.length} recipient(s)`);
    return { sent: recipients.length };
  },
});
