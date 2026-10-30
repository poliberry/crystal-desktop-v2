import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireCommunity, requireMember } from "./communities";
import { PERMISSIONS, can, getChannelPermissions, requireAnyCommunityPermission, requireCommunityPermission } from "./permissions";
import { MAX_SOUND_BYTES, requireWithinUploadLimit } from "./uploadLimits";
import type { Id } from "./_generated/dataModel";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";
import { logCommunityAudit } from "./lib/communityAudit";

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
    await getCurrentUserOrThrow(ctx, "upload_media");
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
    const me = await getCurrentUserOrThrow(ctx, "upload_media");
    const community = await requireCommunity(ctx, communityId);
    await requireAnyCommunityPermission(ctx, community, me._id, [PERMISSIONS.MANAGE_EMOJIS, PERMISSIONS.CREATE_EXPRESSIONS]);

    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      throw new Error("Sound name must be 2–32 characters.");
    }
    if (durationMs !== undefined && durationMs > MAX_SOUND_MS) {
      throw new Error(`Sounds must be shorter than ${MAX_SOUND_MS / 1000} seconds.`);
    }

    await requireWithinUploadLimit(ctx, storageId, MAX_SOUND_BYTES, "Sounds");

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

    const soundId = await ctx.db.insert("communitySounds", {
      communityId,
      name: trimmed,
      emoji: emoji?.trim() || undefined,
      soundUrl,
      storageId,
      durationMs,
      uploadedBy: me._id,
      createdAt: Date.now(),
    });
    await logCommunityAudit(ctx, { communityId, actorId: me._id, action: "sound.create", target: { type: "sound", id: soundId, name: trimmed } });
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
    await logCommunityAudit(ctx, { communityId: sound.communityId, actorId: me._id, action: "sound.update", target: { type: "sound", id: soundId, name: patch.name ?? sound.name }, details: patch.name !== undefined && patch.name !== sound.name ? `Renamed from "${sound.name}"` : undefined });
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
    await logCommunityAudit(ctx, { communityId: sound.communityId, actorId: me._id, action: "sound.delete", target: { type: "sound", id: soundId, name: sound.name } });
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
  args: {
    communityId: v.optional(v.id("communities")),
    /** The voice channel being joined: the join sound is a soundboard press, so that channel's Use Soundboard /
     * Use External Sounds decide whether it plays (listeners check again on arrival — see `verifyClip`). */
    channelId: v.optional(v.id("channels")),
  },
  handler: async (ctx, { communityId, channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const channel = channelId ? await ctx.db.get(channelId) : null;
    const channelCommunity = channel ? await ctx.db.get(channel.communityId) : null;
    const perms = channel && channelCommunity ? await getChannelPermissions(ctx, channelCommunity, channel._id, me._id) : null;
    if (perms !== null && !can(perms, PERMISSIONS.USE_SOUNDBOARD)) return null;

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
    // A clip from another community plays only where that is allowed.
    if (perms !== null && channel && sound.communityId !== channel.communityId && !can(perms, PERMISSIONS.USE_EXTERNAL_SOUNDS)) return null;
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

/**
 * What the soundboard offers in a voice channel, which is a question about the channel and not just the
 * community: Use Soundboard decides whether there is anything to press, and Use External Sounds whether
 * clips from the member's other communities are on offer alongside this one's.
 */
export const listForChannel = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const channel = await ctx.db.get(channelId);
    if (!channel) throw new Error("Channel not found.");
    const community = await requireCommunity(ctx, channel.communityId);
    await requireMember(ctx, channel.communityId, me._id);
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    const canUse = can(perms, PERMISSIONS.USE_SOUNDBOARD);
    const canUseExternal = canUse && can(perms, PERMISSIONS.USE_EXTERNAL_SOUNDS);
    if (!canUse) return { canUse, canUseExternal: false, current: [], external: [] };

    const sounds = await ctx.db
      .query("communitySounds")
      .withIndex("by_community", (q) => q.eq("communityId", channel.communityId))
      .collect();
    const current = sounds.map((s) => ({ id: s._id, name: s.name, emoji: s.emoji, soundUrl: s.soundUrl }));

    // Other communities' clips only when this channel lets this member use them.
    let external: { communityId: Id<"communities">; communityName: string; sounds: typeof current }[] = [];
    if (canUseExternal) {
      const memberships = await ctx.db
        .query("communityMembers")
        .withIndex("by_user", (q) => q.eq("userId", me._id))
        .collect();
      const groups = await Promise.all(
        memberships
          .filter((m) => m.communityId !== channel.communityId)
          .map(async (m) => {
            const other = await ctx.db.get(m.communityId);
            if (!other) return null;
            const clips = await ctx.db
              .query("communitySounds")
              .withIndex("by_community", (q) => q.eq("communityId", m.communityId))
              .collect();
            if (clips.length === 0) return null;
            return {
              communityId: other._id,
              communityName: other.name,
              sounds: clips.map((s) => ({ id: s._id, name: s.name, emoji: s.emoji, soundUrl: s.soundUrl })),
            };
          }),
      );
      external = groups
        .filter((g): g is NonNullable<typeof g> => g !== null)
        .sort((a, b) => a.communityName.localeCompare(b.communityName));
    }
    return { canUse, canUseExternal, current, external };
  },
});

/**
 * Whether a soundboard packet in a voice channel is one its sender was allowed to send, and the clip it
 * names as the server knows it.
 *
 * A soundboard press is a LiveKit data packet that every listener plays for itself, so nothing about the
 * packet can be trusted — not the clip's url, not that the sender may use the soundboard at all. Each
 * listener asks this instead, naming the sender by the identity LiveKit stamped on the packet (which a
 * client can't choose), and plays only what comes back: the sender needs Use Soundboard in this channel;
 * a clip from another community also needs Use External Sounds and for the sender to belong to that
 * community. The url played is the server's own record of the clip, never the one in the packet.
 */
export const verifyClip = query({
  args: { channelId: v.id("channels"), senderId: v.string(), soundId: v.string() },
  handler: async (ctx, { channelId, senderId, soundId }) => {
    const deny = (reason: string) => ({ ok: false as const, reason });
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return deny("Not signed in.");
    const channel = await ctx.db.get(channelId);
    if (!channel) return deny("Channel not found.");
    const community = await ctx.db.get(channel.communityId);
    if (!community) return deny("Channel not found.");
    // Only people in the channel's community hear its calls.
    const listener = await ctx.db
      .query("communityMembers")
      .withIndex("by_community_user", (q) => q.eq("communityId", channel.communityId).eq("userId", me._id))
      .unique();
    if (!listener) return deny("Not a member.");

    const sender = ctx.db.normalizeId("users", senderId);
    if (!sender) return deny("Unknown sender.");
    const inCall = await ctx.db
      .query("channelCallParticipants")
      .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", sender))
      .unique();
    if (!inCall) return deny("The sender isn't in this channel.");

    const perms = await getChannelPermissions(ctx, community, channelId, sender);
    if (!can(perms, PERMISSIONS.USE_SOUNDBOARD)) return deny("The sender can't use the soundboard here.");
    // A stage's audience has no voice, and no soundboard either.
    if (channel.isStage && !inCall.stageSpeaker) return deny("Only speakers can use the soundboard on a stage.");

    // The app's own clips ship with it; the listener already has them.
    if (soundId.startsWith("builtin:")) return { ok: true as const, builtin: true as const };

    const clipId = ctx.db.normalizeId("communitySounds", soundId);
    const clip = clipId ? await ctx.db.get(clipId) : null;
    if (!clip) return deny("That clip no longer exists.");
    const external = clip.communityId !== channel.communityId;
    if (external) {
      if (!can(perms, PERMISSIONS.USE_EXTERNAL_SOUNDS)) return deny("The sender can't use sounds from other communities here.");
      const senderIn = await ctx.db
        .query("communityMembers")
        .withIndex("by_community_user", (q) => q.eq("communityId", clip.communityId).eq("userId", sender))
        .unique();
      if (!senderIn) return deny("The sender isn't in the community that clip belongs to.");
    }
    return { ok: true as const, builtin: false as const, url: clip.soundUrl, emoji: clip.emoji ?? null, name: clip.name };
  },
});
