import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireCommunity } from "./communities";
import { logCommunityAudit, auditUserTarget } from "./lib/communityAudit";
import { loadMemberVoiceAccess, scheduleVoiceSync } from "./lib/voiceAccess";
import { cleanVoiceStatus } from "./lib/voiceGrant";
import { PERMISSIONS, can, getChannelPermissions, requireChannelPermission } from "./permissions";
import { getCurrentUserOrNull, getCurrentUserOrThrow } from "./users";

/**
 * Voice-channel features that sit on top of the room itself: the status line and stage channels.
 * (The publish rights that make a stage's audience listen-only are held by LiveKit — see
 * lib/voiceGrant.ts and voiceSync.ts; these are the mutations that change who is up there.)
 */

async function requireVoiceChannel(ctx: Parameters<typeof requireCommunity>[0], channelId: Doc<"channels">["_id"]) {
  const channel = await ctx.db.get(channelId);
  if (!channel || channel.type !== "voice") throw new Error("Not a voice channel.");
  const community = await requireCommunity(ctx, channel.communityId);
  return { channel, community };
}

async function myRow(ctx: Parameters<typeof requireCommunity>[0], channelId: Doc<"channels">["_id"], userId: Doc<"users">["_id"]) {
  return ctx.db
    .query("channelCallParticipants")
    .withIndex("by_channel_user", (q) => q.eq("channelId", channelId).eq("userId", userId))
    .unique();
}

// --- Status line --------------------------------------------------------------------------------

/** A voice channel's status line, for the channel list and the call header. Separate from the channel list query because that one is cached. */
export const status = query({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }) => {
    const me = await getCurrentUserOrNull(ctx);
    if (!me) return null;
    const channel = await ctx.db.get(channelId);
    if (!channel || channel.type !== "voice" || !channel.voiceStatus) return null;
    // Same audience as the channel itself.
    const community = await ctx.db.get(channel.communityId);
    if (!community) return null;
    if (!can(await getChannelPermissions(ctx, community, channelId, me._id), PERMISSIONS.VIEW_CHANNELS)) return null;
    return channel.voiceStatus;
  },
});

/**
 * Set (or, with an empty string, clear) the line under a voice channel's name — "Playing ranked".
 *
 * Needs Set Voice Status in the channel, and the person has to be in it: the status describes what the
 * people in the channel are doing, and it goes when the last of them leaves. Whoever manages the channel
 * can always clear it.
 */
export const setStatus = mutation({
  args: { channelId: v.id("channels"), status: v.string() },
  handler: async (ctx, { channelId, status }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const { channel, community } = await requireVoiceChannel(ctx, channelId);
    const next = cleanVoiceStatus(status);
    const perms = await getChannelPermissions(ctx, community, channelId, me._id);
    const mayClear = next === undefined && can(perms, PERMISSIONS.MANAGE_CHANNELS);
    if (!mayClear) {
      await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.SET_VOICE_STATUS);
      if (!(await myRow(ctx, channelId, me._id))) throw new Error("Join the voice channel to set its status.");
    }
    if ((channel.voiceStatus ?? undefined) === next) return;
    await ctx.db.patch(channelId, next === undefined
      ? { voiceStatus: undefined, voiceStatusBy: undefined, voiceStatusAt: undefined }
      : { voiceStatus: next, voiceStatusBy: me._id, voiceStatusAt: Date.now() });
  },
});

// --- Stage channels -----------------------------------------------------------------------------

/** Make a voice channel a stage, or an ordinary voice channel again. People already inside are brought in line at once. */
export const setStage = mutation({
  args: { channelId: v.id("channels"), enabled: v.boolean() },
  handler: async (ctx, { channelId, enabled }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const { channel, community } = await requireVoiceChannel(ctx, channelId);
    await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.MANAGE_CHANNELS);
    if (channel.isLounge && enabled) throw new Error("A lounge can't also be a stage.");
    if ((channel.isStage ?? false) === enabled) return;
    await ctx.db.patch(channelId, { isStage: enabled ? true : undefined });
    // Hands and approvals belong to the stage that was; start the next one clean.
    for (const row of await ctx.db.query("channelCallParticipants").withIndex("by_channel", (q) => q.eq("channelId", channelId)).collect()) {
      await ctx.db.patch(row._id, { handRaisedAt: undefined, stageApproved: undefined });
    }
    await scheduleVoiceSync(ctx, { communityId: channel.communityId, channelId });
    await logCommunityAudit(ctx, {
      communityId: channel.communityId,
      actorId: me._id,
      action: "channel.update",
      target: { type: "channel", id: channelId, name: channel.name },
      details: `Stage channel: ${enabled ? "on" : "off"}`,
    });
    try {
      const { cacheInvalidateKeys } = await import("./cache");
      await cacheInvalidateKeys(`community:${channel.communityId}:user:${me._id}:channels`, `channel:${channelId}:meta`);
    } catch {}
  },
});

/** Raise or lower your hand in a stage channel. Takes Request to Speak, and you have to be in the audience. */
export const raiseHand = mutation({
  args: { channelId: v.id("channels"), raised: v.boolean() },
  handler: async (ctx, { channelId, raised }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const { channel, community } = await requireVoiceChannel(ctx, channelId);
    if (!channel.isStage) throw new Error("This isn't a stage channel.");
    const row = await myRow(ctx, channelId, me._id);
    if (!row) throw new Error("Join the stage to raise your hand.");
    if (!raised) {
      if (row.handRaisedAt !== undefined) await ctx.db.patch(row._id, { handRaisedAt: undefined });
      return;
    }
    await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.REQUEST_TO_SPEAK);
    const access = await loadMemberVoiceAccess(ctx, community, channel, me._id, row);
    if (access.grant.stageSpeaker) throw new Error("You're already speaking.");
    // Raising your hand when you couldn't speak even if you were let up would only queue a request that can't be granted.
    if (!access.input.canSpeak) throw new Error("You don't have permission to speak in this channel.");
    if (row.handRaisedAt === undefined) await ctx.db.patch(row._id, { handRaisedAt: Date.now() });
  },
});

/**
 * Bring someone up to speak on a stage, or send them back to the audience. Needs Mute Members in the
 * channel (the same people who can mute can run the stage), except that anyone may step down themselves.
 * The person has to be there and be allowed to speak at all; anyone can be invited up, with or without a
 * raised hand.
 */
export const setSpeaker = mutation({
  args: { channelId: v.id("channels"), userId: v.id("users"), speaker: v.boolean() },
  handler: async (ctx, { channelId, userId, speaker }) => {
    const me = await getCurrentUserOrThrow(ctx);
    const { channel, community } = await requireVoiceChannel(ctx, channelId);
    if (!channel.isStage) throw new Error("This isn't a stage channel.");
    // Anyone can step down off the stage themselves; bringing someone up, or sending someone down, is a moderator's.
    const stepDown = userId === me._id && !speaker;
    if (!stepDown) await requireChannelPermission(ctx, community, channelId, me._id, PERMISSIONS.MUTE_MEMBERS);
    const row = await myRow(ctx, channelId, userId);
    if (!row) throw new Error("That member isn't in this channel.");

    if (speaker) {
      const access = await loadMemberVoiceAccess(ctx, community, channel, userId, row);
      if (!access.input.canSpeak) throw new Error("That member isn't allowed to speak in this channel.");
      await ctx.db.patch(row._id, { stageApproved: true, handRaisedAt: undefined });
    } else {
      // A moderator is up by right, so there is nothing to send them down from.
      const access = await loadMemberVoiceAccess(ctx, community, channel, userId, row);
      if (access.input.stageModerator) throw new Error("Moderators are always on the stage.");
      await ctx.db.patch(row._id, { stageApproved: undefined, handRaisedAt: undefined });
    }
    // Rewrites their LiveKit grant now: publish rights, and the attribute everyone reads their role from.
    await scheduleVoiceSync(ctx, { communityId: channel.communityId, channelId, userId });
    await logCommunityAudit(ctx, {
      communityId: channel.communityId,
      actorId: me._id,
      action: "voice.stage",
      target: await auditUserTarget(ctx, userId),
      details: `${speaker ? "Brought up to speak" : "Sent to the audience"} in #${channel.name}`,
    });
  },
});
