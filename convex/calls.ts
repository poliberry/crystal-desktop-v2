import { v } from "convex/values";

import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

export const listParticipants = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const rows = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    const participants = await Promise.all(
      rows.map(async (row) => {
        const user = await ctx.db.get(row.userId);
        if (!user) return null;
        return { id: user._id, name: user.name, username: user.username, imageUrl: user.imageUrl };
      })
    );
    return participants.filter((p): p is NonNullable<typeof p> => p !== null);
  },
});

export const leave = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const row = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/** Used by the `"use node"` token-minting action in callTokens.ts, which can't touch ctx.db directly. */
export const recordJoin = internalMutation({
  args: { conversationId: v.id("conversations"), userId: v.id("users") },
  handler: async (ctx, { conversationId, userId }) => {
    const existing = await ctx.db
      .query("callParticipants")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", userId)
      )
      .unique();
    if (existing) return;
    await ctx.db.insert("callParticipants", { conversationId, userId, joinedAt: Date.now() });
  },
});

export const getJoinContext = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const membership = await ctx.db
      .query("conversationMembers")
      .withIndex("by_conversation_user", (q) =>
        q.eq("conversationId", conversationId).eq("userId", me._id)
      )
      .unique();
    if (!membership) throw new Error("Not a member of this conversation.");
    return { userId: me._id, name: me.name };
  },
});
