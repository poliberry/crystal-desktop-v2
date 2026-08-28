import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { requireMember } from "./communities";

/** Returns the merged profile for a user in a community: server overrides
 * take precedence over the global profile, with undefined fields falling back. */
export async function getMergedProfile(
  ctx: QueryCtx,
  userId: Id<"users">,
  communityId: Id<"communities">
) {
  const [user, serverProfile] = await Promise.all([
    ctx.db.get(userId),
    ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", userId).eq("communityId", communityId)
      )
      .unique(),
  ]);
  if (!user) return null;

  return {
    userId: user._id,
    name: serverProfile?.displayName ?? user.name,
    username: user.username,
    imageUrl: serverProfile?.imageUrl ?? user.imageUrl,
    bio: serverProfile?.bio ?? user.bio,
    customStatus: serverProfile?.customStatus ?? user.customStatus,
    bannerUrl: serverProfile?.bannerUrl ?? user.bannerUrl,
    borderGradientStart: serverProfile?.borderGradientStart ?? user.borderGradientStart,
    borderGradientEnd: serverProfile?.borderGradientEnd ?? user.borderGradientEnd,
    profileBg: serverProfile?.profileBg ?? user.profileBg,
    nameplateUrl: serverProfile?.nameplateUrl ?? user.nameplateUrl,
    // Account-level rather than merged: a decoration is worn by the person,
    // and a birthday isn't a per-server fact.
    avatarDecoration: effectiveDecoration(user),
    isBirthday: isBirthdayNow(user),
  };
}

export const getMyServerProfile = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    return ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", me._id).eq("communityId", communityId)
      )
      .unique();
  },
});

export const upsertServerProfile = mutation({
  args: {
    communityId: v.id("communities"),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    customStatus: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, displayName, bio, customStatus }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);

    const existing = await ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", me._id).eq("communityId", communityId)
      )
      .unique();

    const patch = {
      displayName: displayName?.trim() || undefined,
      bio: bio?.trim().slice(0, 300) || undefined,
      customStatus: customStatus?.trim().slice(0, 128) || undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("serverProfiles", { userId: me._id, communityId, ...patch });
    }
  },
});

export const generateServerAvatarUploadUrl = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    return ctx.storage.generateUploadUrl();
  },
});

/** As `users.setAvatar`, scoped to one community. */
export const setServerAvatar = mutation({
  args: {
    communityId: v.id("communities"),
    storageId: v.id("_storage"),
    /** The uncropped upload, when this is a new picture rather than a
     * re-crop of the one already stored. */
    originalStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { communityId, storageId, originalStorageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Upload failed.");
    const originalUrl = originalStorageId ? await ctx.storage.getUrl(originalStorageId) : null;
    const original = originalStorageId
      ? { avatarOriginalStorageId: originalStorageId, avatarOriginalUrl: originalUrl ?? undefined }
      : {};

    const existing = await ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", me._id).eq("communityId", communityId)
      )
      .unique();

    if (existing) {
      if (
        existing.avatarStorageId &&
        existing.avatarStorageId !== storageId &&
        // Might be the original itself, for an avatar set before cropping.
        existing.avatarStorageId !== existing.avatarOriginalStorageId
      ) {
        await ctx.storage.delete(existing.avatarStorageId);
      }
      if (
        originalStorageId &&
        existing.avatarOriginalStorageId &&
        existing.avatarOriginalStorageId !== originalStorageId &&
        existing.avatarOriginalStorageId !== storageId
      ) {
        await ctx.storage.delete(existing.avatarOriginalStorageId);
      }
      // Cached accent colour describes the old picture — see
      // `users.setAvatar`.
      await ctx.db.patch(existing._id, {
        imageUrl: url,
        avatarStorageId: storageId,
        avatarAccent: undefined,
        avatarAccentUrl: undefined,
        ...original,
      });
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        imageUrl: url,
        avatarStorageId: storageId,
        ...original,
      });
    }
    return url;
  },
});

async function lookupServerProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  communityId: Id<"communities">
) {
  const existing = await ctx.db
    .query("serverProfiles")
    .withIndex("by_user_community", (q) => q.eq("userId", userId).eq("communityId", communityId))
    .unique();
  return existing;
}

export const generateServerBannerUploadUrl = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    return ctx.storage.generateUploadUrl();
  },
});

export const setServerBanner = mutation({
  args: {
    communityId: v.id("communities"),
    storageId: v.id("_storage"),
    originalStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { communityId, storageId, originalStorageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Upload failed.");
    const originalUrl = originalStorageId ? await ctx.storage.getUrl(originalStorageId) : null;
    const original = originalStorageId
      ? { bannerOriginalStorageId: originalStorageId, bannerOriginalUrl: originalUrl ?? undefined }
      : {};

    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      if (
        existing.bannerStorageId &&
        existing.bannerStorageId !== storageId &&
        existing.bannerStorageId !== existing.bannerOriginalStorageId
      ) {
        await ctx.storage.delete(existing.bannerStorageId);
      }
      if (
        originalStorageId &&
        existing.bannerOriginalStorageId &&
        existing.bannerOriginalStorageId !== originalStorageId &&
        existing.bannerOriginalStorageId !== storageId
      ) {
        await ctx.storage.delete(existing.bannerOriginalStorageId);
      }
      await ctx.db.patch(existing._id, {
        bannerUrl: url,
        bannerStorageId: storageId,
        ...original,
      });
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        bannerUrl: url,
        bannerStorageId: storageId,
        ...original,
      });
    }
    return url;
  },
});

export const removeServerBanner = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (!existing) return;
    if (existing.bannerStorageId && existing.bannerStorageId !== existing.bannerOriginalStorageId) {
      await ctx.storage.delete(existing.bannerStorageId);
    }
    if (existing.bannerOriginalStorageId) {
      await ctx.storage.delete(existing.bannerOriginalStorageId);
    }
    await ctx.db.patch(existing._id, {
      bannerUrl: undefined,
      bannerStorageId: undefined,
      bannerOriginalUrl: undefined,
      bannerOriginalStorageId: undefined,
    });
  },
});

export const generateServerNameplateUploadUrl = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    return ctx.storage.generateUploadUrl();
  },
});

export const setServerNameplate = mutation({
  args: { communityId: v.id("communities"), storageId: v.id("_storage") },
  handler: async (ctx, { communityId, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Upload failed.");

    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      if (existing.nameplateStorageId && existing.nameplateStorageId !== storageId)
        await ctx.storage.delete(existing.nameplateStorageId);
      await ctx.db.patch(existing._id, { nameplateUrl: url, nameplateStorageId: storageId });
    } else {
      await ctx.db.insert("serverProfiles", { userId: me._id, communityId, nameplateUrl: url, nameplateStorageId: storageId });
    }
    return url;
  },
});

export const removeServerNameplate = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (!existing) return;
    if (existing.nameplateStorageId) await ctx.storage.delete(existing.nameplateStorageId);
    await ctx.db.patch(existing._id, { nameplateUrl: undefined, nameplateStorageId: undefined });
  },
});

export const setServerGradient = mutation({
  args: {
    communityId: v.id("communities"),
    borderGradientStart: v.optional(v.string()),
    borderGradientEnd: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, borderGradientStart, borderGradientEnd }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    const patch = {
      borderGradientStart: borderGradientStart || undefined,
      borderGradientEnd: borderGradientEnd || undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("serverProfiles", { userId: me._id, communityId, ...patch });
    }
  },
});

/**
 * Cache the dominant colour of my per-server avatar — the community-scoped
 * twin of `users.setAvatarAccent`, and subject to the same `sourceUrl` guard
 * so a sample that lands after the avatar changed is discarded.
 */
export const setServerAvatarAccent = mutation({
  args: {
    communityId: v.id("communities"),
    accent: v.string(),
    sourceUrl: v.string(),
  },
  handler: async (ctx, { communityId, accent, sourceUrl }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (!existing || existing.imageUrl !== sourceUrl) return;
    await ctx.db.patch(existing._id, { avatarAccent: accent, avatarAccentUrl: sourceUrl });
  },
});
