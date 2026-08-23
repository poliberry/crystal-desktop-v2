import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { PERMISSIONS, requireCommunityPermission } from "./permissions";
import { requireWithinUploadLimit } from "./uploadLimits";
import type { Id } from "./_generated/dataModel";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Per-community soundboard clips. The app also ships a set of built-in sounds
 * (src/lib/soundboard.ts) that are always available and never stored here —
 * this module only owns the ones members upload.
 *
 * Playback itself never goes through Convex: the client broadcasts a LiveKit
 * data packet naming the clip and every participant plays it locally (see
 * `playSoundboardClip` in src/hooks/use-room.ts).
 */

/** Maximum uploaded soundboard slots per community. */
const MAX_SOUND_SLOTS = 48;

/** Longest clip we accept, so one member can't hold the room hostage. */
const MAX_SOUND_MS = 8_000;

export const list = query({
  args: { communityId: v.id("communities") },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    await requireMember(ctx, communityId, me._id);
    const sounds = await ctx.db
      .query("communitySounds")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    return sounds.map((s) => ({
      id: s._id,
      name: s.name,
      emoji: s.emoji,
      soundUrl: s.soundUrl,
      durationMs: s.durationMs,
      uploadedBy: s.uploadedBy,
      createdAt: s.createdAt,
    }));
  },
});

/** Generate a storage upload URL. Any member can call this; `add` below is
 * what actually enforces MANAGE_EMOJIS. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await getCurrentUserOrThrow(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

/** Register an uploaded clip. Requires MANAGE_EMOJIS (which also covers
 * stickers and the soundboard) or ADMINISTRATOR / ownership. */
export const add = mutation({
  args: {
    communityId: v.id("communities"),
    name: v.string(),
    emoji: v.optional(v.string()),
    storageId: v.id("_storage"),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, { communityId, name, emoji, storageId, durationMs }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const community = await requireCommunity(ctx, communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_EMOJIS);

    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      throw new Error("Sound name must be 2–32 characters.");
    }
    if (durationMs !== undefined && durationMs > MAX_SOUND_MS) {
      throw new Error(`Sounds must be shorter than ${MAX_SOUND_MS / 1000} seconds.`);
    }

    await requireWithinUploadLimit(ctx, storageId, "Sounds");

    const existing = await ctx.db
      .query("communitySounds")
      .withIndex("by_community", (q) => q.eq("communityId", communityId))
      .collect();
    if (existing.length >= MAX_SOUND_SLOTS) {
      throw new Error(`This server has reached the ${MAX_SOUND_SLOTS} soundboard slot limit.`);
    }

    const duplicate = await ctx.db
      .query("communitySounds")
      .withIndex("by_community_name", (q) =>
        q.eq("communityId", communityId).eq("name", trimmed)
      )
      .unique();
    if (duplicate) throw new Error(`A sound named "${trimmed}" already exists.`);

    const soundUrl = await ctx.storage.getUrl(storageId);
    if (!soundUrl) throw new Error("Sound upload failed — no URL returned.");

    await ctx.db.insert("communitySounds", {
      communityId,
      name: trimmed,
      emoji: emoji?.trim() || undefined,
      soundUrl,
      storageId,
      durationMs,
      uploadedBy: me._id,
      createdAt: Date.now(),
    });
  },
});

/** Rename / re-emoji an existing clip. Same permission as `add`. */
export const update = mutation({
  args: {
    soundId: v.id("communitySounds"),
    name: v.optional(v.string()),
    emoji: v.optional(v.string()),
  },
  handler: async (ctx, { soundId, name, emoji }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const sound = await ctx.db.get(soundId);
    if (!sound) throw new Error("Sound not found.");
    const community = await requireCommunity(ctx, sound.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_EMOJIS);

    const patch: { name?: string; emoji?: string } = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (trimmed.length < 2 || trimmed.length > 32) {
        throw new Error("Sound name must be 2–32 characters.");
      }
      patch.name = trimmed;
    }
    if (emoji !== undefined) patch.emoji = emoji.trim() || undefined;
    await ctx.db.patch(soundId, patch);
  },
});

export const remove = mutation({
  args: { soundId: v.id("communitySounds") },
  handler: async (ctx, { soundId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const sound = await ctx.db.get(soundId);
    if (!sound) throw new Error("Sound not found.");
    const community = await requireCommunity(ctx, sound.communityId);
    await requireCommunityPermission(ctx, community, me._id, PERMISSIONS.MANAGE_EMOJIS);

    await ctx.storage.delete(sound.storageId).catch(() => {});
    await ctx.db.delete(soundId);
  },
});

/**
 * Every soundboard clip the caller can use, across every community they're
 * in, grouped by community.
 *
 * A join sound can reference a clip from any server the user belongs to, so
 * both the picker and the resolver need the whole accessible set rather than
 * one community's.
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
        const sounds = await ctx.db
          .query("communitySounds")
          .withIndex("by_community", (q) => q.eq("communityId", membership.communityId))
          .collect();
        if (sounds.length === 0) return null;
        return {
          communityId: community._id,
          communityName: community.name,
          communityImageUrl: community.imageUrl,
          sounds: sounds.map((s) => ({
            id: s._id,
            name: s.name,
            emoji: s.emoji,
            soundUrl: s.soundUrl,
          })),
        };
      })
    );

    return groups
      .filter((g): g is NonNullable<typeof g> => g !== null)
      .sort((a, b) => a.communityName.localeCompare(b.communityName));
  },
});

/**
 * The caller's join sound for a given context: the per-server override if one
 * is set, otherwise their global choice. `communityId` is omitted for DM and
 * group calls, which have no server to override from.
 */
export const myJoinSound = query({
  args: { communityId: v.optional(v.id("communities")) },
  handler: async (ctx, { communityId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;

    let soundId = me.joinSoundId;
    if (communityId) {
      const profile = await ctx.db
        .query("serverProfiles")
        .withIndex("by_user_community", (q) =>
          q.eq("userId", me._id).eq("communityId", communityId)
        )
        .unique();
      soundId = profile?.joinSoundId ?? soundId;
    }
    if (!soundId) return null;

    // Built-ins ship with the app, so the client resolves those itself and
    // only uploaded clips need a URL from here.
    if (soundId.startsWith("builtin:")) return { soundId, soundUrl: null };

    const sound = await ctx.db.get(soundId as Id<"communitySounds">).catch(() => null);
    if (!sound) return null;
    return { soundId, soundUrl: sound.soundUrl };
  },
});

/**
 * Set the join sound, globally or for one server. An empty `soundId` clears
 * it — for a server that means falling back to the global choice.
 */
export const setJoinSound = mutation({
  args: { soundId: v.string(), communityId: v.optional(v.id("communities")) },
  handler: async (ctx, { soundId, communityId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const value = soundId.trim() || undefined;

    if (!communityId) {
      await ctx.db.patch(me._id, { joinSoundId: value });
      return;
    }

    await requireMember(ctx, communityId, me._id);
    const profile = await ctx.db
      .query("serverProfiles")
      .withIndex("by_user_community", (q) =>
        q.eq("userId", me._id).eq("communityId", communityId)
      )
      .unique();

    if (profile) {
      await ctx.db.patch(profile._id, { joinSoundId: value });
    } else if (value) {
      await ctx.db.insert("serverProfiles", { userId: me._id, communityId, joinSoundId: value });
    }
  },
});
