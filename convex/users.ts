import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalQuery, mutation, query, type QueryCtx } from "./_generated/server";

export async function getCurrentUserOrNull(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();
}

export async function getCurrentUserOrThrow(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) throw new Error("Not authenticated, or user has not been bootstrapped yet.");
  return user;
}

function deriveUsername(identity: { nickname?: string; email?: string; givenName?: string }): string {
  const base = identity.nickname ?? identity.email?.split("@")[0] ?? identity.givenName ?? "user";
  return base.toLowerCase().replace(/[^a-z0-9_.]/g, "");
}

/**
 * Creates the Convex user row from the Clerk identity the first time someone
 * signs in. Deliberately does NOT patch an existing row's `name`/`imageUrl`
 * from Clerk on every call — once a profile exists, display name, avatar,
 * username and bio are independently editable via `updateProfile`/
 * `setAvatar` below, and re-syncing from Clerk here would silently clobber
 * whatever the user customized.
 */
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated.");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (existing) return existing._id;

    const name = identity.name ?? identity.nickname ?? identity.email ?? "New user";
    const imageUrl = typeof identity.pictureUrl === "string" ? identity.pictureUrl : undefined;

    let username = deriveUsername(identity) || "user";
    let suffix = 0;
    while (
      await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", username))
        .unique()
    ) {
      suffix += 1;
      username = `${deriveUsername(identity) || "user"}${suffix}`;
    }

    return ctx.db.insert("users", { clerkId: identity.subject, name, username, imageUrl });
  },
});

const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;
const NAME_MAX = 64;
const BIO_MAX = 300;

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    username: v.optional(v.string()),
    bio: v.optional(v.string()),
  },
  handler: async (ctx, { name, username, bio }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const patch: { name?: string; username?: string; bio?: string } = {};

    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Display name can't be empty.");
      if (trimmed.length > NAME_MAX) throw new Error(`Display name must be ${NAME_MAX} characters or fewer.`);
      patch.name = trimmed;
    }

    if (username !== undefined) {
      const normalized = username.trim().toLowerCase();
      if (!USERNAME_RE.test(normalized)) {
        throw new Error('Usernames are 3-32 characters: lowercase letters, numbers, "." or "_".');
      }
      if (normalized !== me.username) {
        const clash = await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.eq("username", normalized))
          .unique();
        if (clash && clash._id !== me._id) throw new Error("That username is taken.");
      }
      patch.username = normalized;
    }

    if (bio !== undefined) {
      const trimmed = bio.trim();
      if (trimmed.length > BIO_MAX) throw new Error(`Bio must be ${BIO_MAX} characters or fewer.`);
      patch.bio = trimmed;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(me._id, patch);
    }
    return me._id;
  },
});

export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const setAvatar = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("Avatar upload failed.");

    const previous = me.avatarStorageId;
    await ctx.db.patch(me._id, { imageUrl: url, avatarStorageId: storageId });
    if (previous && previous !== storageId) {
      await ctx.storage.delete(previous).catch(() => {});
    }
    return url;
  },
});

export const removeAvatar = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrThrow(ctx);
    const previous = me.avatarStorageId;
    await ctx.db.patch(me._id, { imageUrl: undefined, avatarStorageId: undefined });
    if (previous) await ctx.storage.delete(previous).catch(() => {});
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => getCurrentUserOrNull(ctx),
});

export const searchByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, { username }) => {
    const me = await getCurrentUserOrNull(ctx);
    const normalized = username.trim().toLowerCase();
    if (!normalized || !me) return null;
    const match = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalized))
      .unique();
    if (!match || match._id === me._id) return null;
    return { id: match._id, name: match.name, username: match.username, imageUrl: match.imageUrl };
  },
});

/** Resolves the caller's Convex user id from a `"use node"` action, which
 * can't touch `ctx.db` itself (see callTokens.ts / channelCalls.ts's `leave` actions). */
export const getCurrentUserIdInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUserOrNull(ctx);
    return me?._id ?? null;
  },
});

/** Check if a storage id is still referenced by any attachment row (DM or
 * channel messages). Used before deleting orphaned files to avoid breaking
 * attachments that may still be in use. */
export async function isReferencedByAttachment(
  ctx: QueryCtx,
  storageId: string
): Promise<boolean> {
  const dmRef = await ctx.db
    .query("messageAttachments")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId as never))
    .first();
  if (dmRef) return true;

  const channelRef = await ctx.db
    .query("channelMessageAttachments")
    .withIndex("by_storageId", (q) => q.eq("storageId", storageId as never))
    .first();
  return channelRef !== null;
}
