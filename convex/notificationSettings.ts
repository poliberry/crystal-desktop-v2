import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { loadNotificationPolicy } from "./lib/notificationPolicy";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Read/write side of the notification settings. The rules themselves live in
 * `convex/lib/notificationPolicy.ts`, which both delivery paths consult — this
 * module only stores what the user picked.
 */

const levelValidator = v.union(v.literal("all"), v.literal("mentions"), v.literal("none"));

/** Everything the settings screen needs, including the resolved defaults so
 * the UI never has to know what they are. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;

    const policy = await loadNotificationPolicy(ctx, me._id);
    const memberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const communities = await Promise.all(
      memberships.map(async (membership) => {
        const community = await ctx.db.get(membership.communityId);
        if (!community) return null;
        return {
          communityId: community._id,
          name: community.name,
          imageUrl: community.imageUrl,
          level: policy.communityLevels.get(community._id) ?? "all",
        };
      })
    );

    return {
      suppressedBy: policy.suppressedBy,
      dmMessages: policy.dmMessages,
      channelMessages: policy.channelMessages,
      friendRequests: policy.friendRequests,
      communities: communities
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

/** Update one or more account-wide switches. Omitted fields are untouched. */
export const update = mutation({
  args: {
    dmMessages: v.optional(v.boolean()),
    channelMessages: v.optional(v.boolean()),
    friendRequests: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("notificationSettings")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return;
    }
    // First write materialises the row, so the defaults have to be spelled
    // out here rather than left implicit.
    await ctx.db.insert("notificationSettings", {
      userId: me._id,
      dmMessages: args.dmMessages ?? true,
      channelMessages: args.channelMessages ?? true,
      friendRequests: args.friendRequests ?? true,
    });
  },
});

export const setCommunityLevel = mutation({
  args: { communityId: v.id("communities"), level: levelValidator },
  handler: async (ctx, { communityId, level }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const existing = await ctx.db
      .query("communityNotificationSettings")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", me._id).eq("communityId", communityId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { level });
      return;
    }
    await ctx.db.insert("communityNotificationSettings", { userId: me._id, communityId, level });
  },
});
