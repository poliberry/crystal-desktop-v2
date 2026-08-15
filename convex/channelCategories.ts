import { v } from "convex/values";

import { requireCommunity } from "./communities";
import { PERMISSIONS, requireCommunityPermission } from "./permissions";
import { mutation, query } from "./_generated/server";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return [];
    const categories = await ctx.db
      .query("channelCategories")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return categories
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c._id, name: c.name, position: c.position }));
  },
});

export const create = mutation({
  args: { communityId: v.id("communities"), name: v.string() },
  handler: async (ctx, { communityId, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name can't be empty.");

    const existing = await ctx.db
      .query("channelCategories")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const position = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;

    return ctx.db.insert("channelCategories", { communityId, name: trimmed, position });
  },
});

export const rename = mutation({
  args: { categoryId: v.id("channelCategories"), name: v.string() },
  handler: async (ctx, { categoryId, name }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const category = await ctx.db.get(categoryId);
    if (!category) throw new Error("Category not found.");
    const community = await requireCommunity(ctx, category.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    const trimmed = name.trim();
    if (!trimmed) throw new Error("Category name can't be empty.");
    await ctx.db.patch(categoryId, { name: trimmed });
  },
});

export const remove = mutation({
  args: { categoryId: v.id("channelCategories") },
  handler: async (ctx, { categoryId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const category = await ctx.db.get(categoryId);
    if (!category) return;
    const community = await requireCommunity(ctx, category.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    // Deleting a category doesn't delete its channels — they fall back to
    // uncategorized, same as if they'd never been assigned one.
    const channels = await ctx.db
      .query("channels")
      .withIndex("by_community", (q) => q.eq("communityId", category.communityId))
      .collect();
    for (const channel of channels) {
      if (channel.categoryId === categoryId) await ctx.db.patch(channel._id, { categoryId: undefined });
    }
    await ctx.db.delete(categoryId);
  },
});

export const reorder = mutation({
  args: { communityId: v.id("communities"), orderedCategoryIds: v.array(v.id("channelCategories")) },
  handler: async (ctx, { communityId, orderedCategoryIds }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_CHANNELS);

    for (let i = 0; i < orderedCategoryIds.length; i++) {
      const category = await ctx.db.get(orderedCategoryIds[i]);
      if (category && category.communityId === communityId) {
        await ctx.db.patch(orderedCategoryIds[i], { position: i });
      }
    }
  },
});
