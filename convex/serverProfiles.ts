import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { effectiveDecoration, isBirthdayNow } from "./lib/birthday";
import { dropProfileAsset, resolveProfileAsset } from "./lib/profileCosmetics";
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
    // Card cosmetics follow the banner, not the decoration — see the note in
    // `users.getProfile`. The frame's mode comes from whichever profile
    // supplied the frame itself.
    displayNameStyle: serverProfile?.displayNameStyle ?? user.displayNameStyle,
    profileEffect: serverProfile?.profileEffect ?? user.profileEffect,
    profileCss: serverProfile?.profileCss ?? user.profileCss,
    profileFrame: serverProfile?.profileFrame ?? user.profileFrame,
    profileFrameMode: serverProfile?.profileFrame
      ? serverProfile.profileFrameMode
      : user.profileFrameMode,
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
    // Size-checked for the same reason as `users.setNameplate`: a nameplate
    // can be a video now.
    const url = await resolveProfileAsset(ctx, storageId, "Nameplates");

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

// --- Card cosmetics, per server --------------------------------------------
//
// The account-level twins of these live in convex/users.ts. They exist twice
// because a server profile is meant to be able to override every cosmetic the
// account has (see the `profileCosmetics` spread in convex/schema.ts) — the
// profile editor picks a scope from a dropdown and then edits the same set of
// things either way.

export const setServerDisplayNameStyle = mutation({
  args: { communityId: v.id("communities"), style: v.string() },
  handler: async (ctx, { communityId, style }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const trimmed = style.trim().slice(0, 32);
    // "default" is stored as nothing — but here that means "fall back to the
    // account's style", which is what a server profile does with every other
    // field it hasn't been given.
    const displayNameStyle =
      !trimmed || trimmed === "default" ? undefined : trimmed;
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      await ctx.db.patch(existing._id, { displayNameStyle });
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        displayNameStyle,
      });
    }
  },
});

export const setServerProfileEffect = mutation({
  args: { communityId: v.id("communities"), storageId: v.id("_storage") },
  handler: async (ctx, { communityId, storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const url = await resolveProfileAsset(ctx, storageId, "Profile effects");
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      const previous = existing.profileEffectStorageId;
      await ctx.db.patch(existing._id, {
        profileEffect: url,
        profileEffectStorageId: storageId,
      });
      await dropProfileAsset(ctx, previous, storageId);
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        profileEffect: url,
        profileEffectStorageId: storageId,
      });
    }
    return url;
  },
});

export const removeServerProfileEffect = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (!existing) return;
    const previous = existing.profileEffectStorageId;
    await ctx.db.patch(existing._id, {
      profileEffect: undefined,
      profileEffectStorageId: undefined,
    });
    await dropProfileAsset(ctx, previous);
  },
});

export const setServerProfileFrame = mutation({
  args: {
    communityId: v.id("communities"),
    storageId: v.id("_storage"),
    mode: v.optional(v.union(v.literal("wrap"), v.literal("overlay"))),
  },
  handler: async (ctx, { communityId, storageId, mode }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const url = await resolveProfileAsset(ctx, storageId, "Profile frames");
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      const previous = existing.profileFrameStorageId;
      await ctx.db.patch(existing._id, {
        profileFrame: url,
        profileFrameStorageId: storageId,
        profileFrameMode: mode ?? existing.profileFrameMode ?? "wrap",
      });
      await dropProfileAsset(ctx, previous, storageId);
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        profileFrame: url,
        profileFrameStorageId: storageId,
        profileFrameMode: mode ?? "wrap",
      });
    }
    return url;
  },
});

export const setServerProfileFrameMode = mutation({
  args: {
    communityId: v.id("communities"),
    mode: v.union(v.literal("wrap"), v.literal("overlay")),
  },
  handler: async (ctx, { communityId, mode }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    // No frame here means the card is wearing the account's, whose mode is the
    // account's to set — writing one onto an empty server profile would be a
    // setting with nothing to apply to.
    if (!existing?.profileFrame) return;
    await ctx.db.patch(existing._id, { profileFrameMode: mode });
  },
});

export const removeServerProfileFrame = mutation({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (!existing) return;
    const previous = existing.profileFrameStorageId;
    await ctx.db.patch(existing._id, {
      profileFrame: undefined,
      profileFrameStorageId: undefined,
      profileFrameMode: undefined,
    });
    await dropProfileAsset(ctx, previous);
  },
});

/** The per-server twin of `users.setProfileCss`, with the same reasoning:
 * stored raw, confined to the card by whoever renders it. */
export const setServerProfileCss = mutation({
  args: { communityId: v.id("communities"), css: v.string() },
  handler: async (ctx, { communityId, css }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const trimmed = css.trim();
    if (trimmed.length > 8000) {
      throw new Error("Profile CSS must be under 8000 characters.");
    }
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      await ctx.db.patch(existing._id, { profileCss: trimmed || undefined });
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        profileCss: trimmed || undefined,
      });
    }
  },
});

/** The per-server twin of `users.setProfileFrameLayout`. */
export const setServerProfileFrameLayout = mutation({
  args: {
    communityId: v.id("communities"),
    fit: v.optional(v.union(v.literal("stretch"), v.literal("aspect"))),
    anchor: v.optional(
      v.union(v.literal("top"), v.literal("center"), v.literal("bottom"))
    ),
    scale: v.optional(v.number()),
    offsetY: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, fit, anchor, scale, offsetY }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const patch = {
      ...(fit !== undefined ? { profileFrameFit: fit } : {}),
      ...(anchor !== undefined ? { profileFrameAnchor: anchor } : {}),
      ...(scale !== undefined
        ? { profileFrameScale: Math.min(220, Math.max(60, scale)) }
        : {}),
      ...(offsetY !== undefined
        ? { profileFrameOffsetY: Math.min(240, Math.max(-240, offsetY)) }
        : {}),
    };
    const existing = await lookupServerProfile(ctx, me._id, communityId);
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("serverProfiles", {
        userId: me._id,
        communityId,
        ...patch,
      });
    }
  },
});
