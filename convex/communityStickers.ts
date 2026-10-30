import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { releaseUrl } from "./lib/files";
import { r2KeyFromUrl, r2PublicUrlForKey } from "./lib/r2";
import {
  isStickerContentType,
  isStickerKey,
  MAX_STICKER_SLOTS,
  mayRemoveSticker,
  sanitiseStickerName,
  stickerNameError,
} from "./lib/stickersPure";
import { can, enforceServerAssurance, getBasePermissions, PERMISSIONS, requireAnyCommunityPermission } from "./permissions";
import { MAX_STICKER_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import { getCurrentUserOrThrow } from "./users";

// No audit entries here: the log's vocabulary (lib/communityAuditActions.ts) has no sticker.*
// actions yet. Add "sticker.create" / "sticker.delete" there and log them from add and remove.

/**
 * A community's stickers. Any member can call this.
 *
 * Each carries who uploaded it and whether the viewer may remove it, so the settings page doesn't
 * have to work permissions out for itself.
 */
export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const community = await requireCommunity(ctx, communityId);
    const perms = await getBasePermissions(ctx, community, me._id);
    const canManageEmojis = can(perms, PERMISSIONS.MANAGE_EMOJIS);
    const canCreateExpressions = can(perms, PERMISSIONS.CREATE_EXPRESSIONS);

    const stickers = await ctx.db
      .query("communityStickers")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    const uploaders = new Map(
      await Promise.all(
        [...new Set(stickers.map((s) => s.uploadedBy))].map(async (id) => [id, await ctx.db.get(id)] as const),
      ),
    );
    return stickers.map((s) => ({
      id: s._id,
      name: s.name,
      imageUrl: s.imageUrl,
      uploadedBy: s.uploadedBy,
      uploaderName: uploaders.get(s.uploadedBy)?.name ?? "Unknown",
      createdAt: s.createdAt,
      canRemove: mayRemoveSticker({ canManageEmojis, canCreateExpressions, isUploader: s.uploadedBy === me._id }),
    }));
  },
});

/**
 * Every sticker from every community the caller belongs to, grouped by community.
 *
 * The picker needs the whole accessible set rather than just the community you are looking at,
 * since a sticker from another server you share is sendable with Use External Stickers.
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
        const stickers = await ctx.db
          .query("communityStickers")
          .withIndex("by_community", (q) => q.eq("communityId", membership.communityId))
          .collect();
        if (stickers.length === 0) return null;
        return {
          communityId: community._id,
          communityName: community.name,
          communityImageUrl: community.imageUrl,
          stickers: stickers.map((s) => ({ id: s._id, name: s.name, imageUrl: s.imageUrl })),
        };
      }),
    );

    return groups
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .sort((a, b) => a.communityName.localeCompare(b.communityName));
  },
});

/** Generate a storage upload URL. Any signed-in uploader can call this; `add` enforces who may
 * actually add a sticker. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx, "upload_media");
    return ctx.storage.generateUploadUrl();
  },
});

/** Add a sticker. Needs Manage Emojis or Create Expressions (the owner and Administrators pass);
 * limited to 30 per community. */
export const add = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.string(),
    storageId: v.optional(v.id("_storage")),
    /** Uploaded to the CDN instead of Convex storage. */
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
  },
  handler: async (ctx, { communityId, name, storageId, cdnKey, cdnUrl }) => {
    const me = await getCurrentUserOrThrow(ctx, "upload_media");
    const community = await requireCommunity(ctx, communityId);
    await requireMember(ctx, communityId, me._id);
    await requireAnyCommunityPermission(ctx, community, me._id, [PERMISSIONS.MANAGE_EMOJIS, PERMISSIONS.CREATE_EXPRESSIONS]);

    const sanitized = sanitiseStickerName(name);
    const nameError = stickerNameError(sanitized);
    if (nameError) throw new Error(nameError);

    const existing = await ctx.db
      .query("communityStickers")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    if (existing.length >= MAX_STICKER_SLOTS) {
      throw new Error(`This server has reached the ${MAX_STICKER_SLOTS} sticker slot limit.`);
    }

    const duplicate = await ctx.db
      .query("communityStickers")
      .withIndex("by_community_name", (q) => q.eq("communityId", communityId).eq("name", sanitized))
      .unique();
    if (duplicate) throw new Error(`A sticker named "${sanitized}" already exists.`);

    const onCdn = !!(cdnKey || cdnUrl);
    let imageUrl: string | null;
    if (onCdn) {
      // The address has to be on our own CDN: anything else would be drawn into other people's
      // channels, and a page elsewhere can change what it shows after the fact.
      imageUrl = cdnKey ? r2PublicUrlForKey(cdnKey) : (cdnUrl ?? null);
      if (!imageUrl || !r2KeyFromUrl(imageUrl)) throw new Error("Upload the sticker through Crystal first.");
      if (!isStickerKey(cdnKey ?? imageUrl)) throw new Error("A sticker must be a PNG, WebP, GIF or APNG picture.");
    } else if (storageId) {
      // The size and type a file actually turned out to be are only knowable here; the client's
      // opinion of them is a courtesy.
      await requireWithinUploadLimit(ctx, storageId, MAX_STICKER_BYTES, "Stickers");
      const meta = await ctx.db.system.get(storageId);
      if (meta?.contentType && !isStickerContentType(meta.contentType)) {
        await ctx.storage.delete(storageId).catch(() => {});
        throw new Error("A sticker must be a PNG, WebP, GIF or APNG picture.");
      }
      imageUrl = await ctx.storage.getUrl(storageId);
    } else {
      imageUrl = null;
    }
    if (!imageUrl) throw new Error("Sticker upload failed — no URL returned.");

    await ctx.db.insert("communityStickers", {
      communityId,
      name: sanitized,
      imageUrl,
      storageId: onCdn ? undefined : storageId,
      uploadedBy: me._id,
      createdAt: Date.now(),
    });
  },
});

/** Delete a sticker. Needs Manage Emojis (the owner and Administrators pass), or being the one who
 * uploaded it while still holding Create Expressions. */
export const remove = mutation({
  args: { stickerId: v.id("communityStickers") },
  handler: async (ctx, { stickerId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const sticker = await ctx.db.get(stickerId);
    if (!sticker) throw new Error("Sticker not found.");
    const community = await requireCommunity(ctx, sticker.communityId);
    await requireMember(ctx, sticker.communityId, me._id);

    // `can`, not a bitwise AND: Create Expressions and friends sit above bit 30.
    const perms = await getBasePermissions(ctx, community, me._id);
    const canManageEmojis = can(perms, PERMISSIONS.MANAGE_EMOJIS);
    const canCreateExpressions = can(perms, PERMISSIONS.CREATE_EXPRESSIONS);
    if (!mayRemoveSticker({ canManageEmojis, canCreateExpressions, isUploader: sticker.uploadedBy === me._id })) {
      throw new Error("You don't have permission to manage stickers.");
    }
    // Two-step rules are asked on account of whichever permission was actually used.
    await enforceServerAssurance(ctx, community, me._id, canManageEmojis ? PERMISSIONS.MANAGE_EMOJIS : PERMISSIONS.CREATE_EXPRESSIONS);

    await ctx.db.delete(stickerId);
    await releaseUrl(ctx, sticker.imageUrl, sticker.storageId);
  },
});
