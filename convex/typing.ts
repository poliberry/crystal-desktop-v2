import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

const TYPING_EXPIRE_MS = 5_000;

export const start = mutation({
  args: {
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, { channelId, conversationId }) => {
    if (!channelId && !conversationId) return;
    const me = await getCurrentUserOrThrow(ctx);

    const existing = channelId
      ? await ctx.db
          .query("typing")
          .withIndex("by_user_channel", (q) =>
            q.eq("userId", me._id).eq("channelId", channelId)
          )
          .unique()
      : await ctx.db
          .query("typing")
          .withIndex("by_user_conversation", (q) =>
            q.eq("userId", me._id).eq("conversationId", conversationId)
          )
          .unique();

    if (existing) {
      if (existing.scheduledJobId) {
        try {
          await ctx.scheduler.cancel(existing.scheduledJobId);
        } catch {}
      }
      const scheduledJobId = await ctx.scheduler.runAfter(
        TYPING_EXPIRE_MS,
        internal.typing.expire,
        { typingId: existing._id }
      );
      await ctx.db.patch(existing._id, { scheduledJobId });
    } else {
      const typingId = await ctx.db.insert("typing", {
        userId: me._id,
        channelId,
        conversationId,
      });
      const scheduledJobId = await ctx.scheduler.runAfter(
        TYPING_EXPIRE_MS,
        internal.typing.expire,
        { typingId }
      );
      await ctx.db.patch(typingId, { scheduledJobId });
    }
  },
});

export const stop = mutation({
  args: {
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, { channelId, conversationId }) => {
    if (!channelId && !conversationId) return;
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return;

    const existing = channelId
      ? await ctx.db
          .query("typing")
          .withIndex("by_user_channel", (q) =>
            q.eq("userId", me._id).eq("channelId", channelId)
          )
          .unique()
      : await ctx.db
          .query("typing")
          .withIndex("by_user_conversation", (q) =>
            q.eq("userId", me._id).eq("conversationId", conversationId)
          )
          .unique();

    if (!existing) return;
    if (existing.scheduledJobId) {
      try {
        await ctx.scheduler.cancel(existing.scheduledJobId);
      } catch {}
    }
    await ctx.db.delete(existing._id);
  },
});

export const expire = internalMutation({
  args: { typingId: v.id("typing") },
  handler: async (ctx, { typingId }) => {
    const entry = await ctx.db.get(typingId);
    if (entry) await ctx.db.delete(typingId);
  },
});

export const list = query({
  args: {
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, { channelId, conversationId }) => {
    if (!channelId && !conversationId) return [];
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];

    const entries = channelId
      ? await ctx.db
          .query("typing")
          .withIndex("by_channel", (q) => q.eq("channelId", channelId))
          .collect()
      : await ctx.db
          .query("typing")
          .withIndex("by_conversation", (q) =>
            q.eq("conversationId", conversationId)
          )
          .collect();

    const others = entries.filter((e) => e.userId !== me._id);

    return Promise.all(
      others.map(async (e) => {
        const user = await ctx.db.get(e.userId);
        return { userId: e.userId, name: user?.name ?? "Someone" };
      })
    );
  },
});
