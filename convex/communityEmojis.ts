import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { PERMISSIONS } from "./permissions";
import { requireCommunity, requireMember } from "./communities";
import { getCurrentUserOrThrow } from "./users";

/** Maximum custom emoji slots per community. */
const MAX_EMOJI_SLOTS = 50;

/** List all custom emojis for a community. Any member can call this. */
export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const emojis = await ctx.db
      .query("communityEmojis")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return emojis.map((e) => ({
      id: e._id,
      name: e.name,
      imageUrl: e.imageUrl,
      uploadedBy: e.uploadedBy,
      createdAt: e.createdAt,
    }));
  },
});

/**
 * Every custom emoji from every community the caller belongs to, grouped by
 * community.
 *
 * A message can carry an emoji from any server the author shares with you, so
 * the picker and the renderer both need the whole accessible set rather than
 * just the community you happen to be looking at.
 */
export const listAccessible = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const memberships = await ctx.db
      .query("communityMembers")
      .withIndex("by_user", (q) => q.eq("userId", me._id))
      .collect();

    const groups = await Promise.all(
      memberships.map(async (membership) => {
        const community = await ctx.db.get(membership.communityId);
        if (!community) return null;
        const emojis = await ctx.db
          .query("communityEmojis")
          .withIndex("by_community", (q) => q.eq("communityId", membership.communityId))
          .collect();
        if (emojis.length === 0) return null;
        return {
          communityId: community._id,
          communityName: community.name,
          communityImageUrl: community.imageUrl,
          emojis: emojis.map((e) => ({ id: e._id, name: e.name, imageUrl: e.imageUrl })),
        };
      })
    );

    return groups
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .sort((a, b) => a.communityName.localeCompare(b.communityName));
  },
});

/** Generate a storage upload URL. Any member can call this; the add mutation
 * enforces the MANAGE_EMOJIS permission. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** Add a new custom emoji.  Requires MANAGE_EMOJIS (or ADMINISTRATOR / owner).
 * Enforces the 50-slot per-server limit. */
export const add = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { communityId, name, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);

    // Permission check — owner always passes.
    if (community.ownerId !== me._id) {
      const perms = await ctx.db
        .query("memberRoles")
        .withIndex("by_member", (q) => q.eq("communityId", communityId).eq("userId", me._id))
        .collect();
      const roles = await Promise.all(perms.map((m) => ctx.db.get(m.roleId)));
      const everyoneRole = await ctx.db
        .query("roles")
        .withIndex("by_community", (q) => q.eq("communityId", communityId))
        .filter((q) => q.eq(q.field("isEveryone"), true))
        .unique();
      let bits = everyoneRole?.permissions ?? 0;
      for (const r of roles) {
        if (r) bits |= r.permissions;
      }
      const isAdmin = (bits & PERMISSIONS.ADMINISTRATOR) !== 0;
      const canManage = isAdmin || (bits & PERMISSIONS.MANAGE_EMOJIS) !== 0;
      if (!canManage) throw new Error("You don't have permission to manage emojis.");
    }

    // Name validation — alphanumeric + underscores, 2-32 chars.
    const sanitized = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (sanitized.length < 2 || sanitized.length > 32) {
      throw new Error("Emoji name must be 2–32 characters (letters, numbers, underscores).");
    }

    // Slot limit.
    const existing = await ctx.db
      .query("communityEmojis")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    if (existing.length >= MAX_EMOJI_SLOTS) {
      throw new Error(`This server has reached the ${MAX_EMOJI_SLOTS} emoji slot limit.`);
    }

    // Unique name check.
    const duplicate = await ctx.db
      .query("communityEmojis")
      .withIndex("by_community_name", (q) => q.eq("communityId", communityId).eq("name", sanitized))
      .unique();
    if (duplicate) throw new Error(`An emoji named "${sanitized}" already exists.`);

    const imageUrl = await ctx.storage.getUrl(storageId);
    if (!imageUrl) throw new Error("Emoji upload failed — no URL returned.");

    await ctx.db.insert("communityEmojis", {
      communityId,
      name: sanitized,
      imageUrl,
      storageId,
      uploadedBy: me._id,
      createdAt: Date.now(),
    });
  },
});

/** Delete a custom emoji.  Requires MANAGE_EMOJIS (or ADMINISTRATOR / owner). */
export const remove = mutation({
  args: { emojiId: v.id("communityEmojis") },
  handler: async (ctx, { emojiId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const emoji = await ctx.db.get(emojiId);
    if (!emoji) throw new Error("Emoji not found.");

    const community = await requireCommunity(ctx, emoji.communityId);

    if (community.ownerId !== me._id) {
      const perms = await ctx.db
        .query("memberRoles")
        .withIndex("by_member", (q) =>
          q.eq("communityId", emoji.communityId).eq("userId", me._id)
        )
        .collect();
      const roles = await Promise.all(perms.map((m) => ctx.db.get(m.roleId)));
      const everyoneRole = await ctx.db
        .query("roles")
        .withIndex("by_community", (q) => q.eq("communityId", emoji.communityId))
        .filter((q) => q.eq(q.field("isEveryone"), true))
        .unique();
      let bits = everyoneRole?.permissions ?? 0;
      for (const r of roles) {
        if (r) bits |= r.permissions;
      }
      const isAdmin = (bits & PERMISSIONS.ADMINISTRATOR) !== 0;
      const canManage = isAdmin || (bits & PERMISSIONS.MANAGE_EMOJIS) !== 0;
      if (!canManage) throw new Error("You don't have permission to manage emojis.");
    }

    await ctx.storage.delete(emoji.storageId).catch(() => {});
    await ctx.db.delete(emojiId);
  },
});
