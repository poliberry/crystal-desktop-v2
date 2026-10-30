"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { applyParticipantGrant, removeCompanionFromRoom, removeFromRoom } from "./lib/liveKitAdmin";

/**
 * Keeps people who are already connected to a voice channel in line with their permissions.
 *
 * A LiveKit token is a grant that lasts hours, so without this a role edit, a channel overwrite, a server
 * mute or a stage approval would only take effect the next time someone joined. Instead, whatever changes
 * what someone may do schedules `resync` (see `scheduleVoiceSync` in lib/voiceAccess.ts), which compares
 * each affected person's grant with what their permissions say now and updates LiveKit in place:
 * publish rights, the signed attributes the room reads, or — for someone who may no longer be there —
 * the connection itself.
 */

export const resync = internalAction({
  args: {
    communityId: v.optional(v.id("communities")),
    channelId: v.optional(v.id("channels")),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<void> => {
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return;
    const stale = await ctx.runQuery(internal.voiceGrants.staleGrants, args);
    if (stale.length === 0) return;

    const applied: { rowId: (typeof stale)[number]["rowId"]; grantKey: string; stageSpeaker: boolean }[] = [];
    const removed: (typeof stale)[number]["rowId"][] = [];
    for (const check of stale) {
      const roomName = `channel-${check.channelId}`;
      if (!check.allowed) {
        await removeFromRoom(roomName, check.userId);
        removed.push(check.rowId);
        continue;
      }
      const ok = await applyParticipantGrant(roomName, check.userId, check.grant);
      // Their screen-share companion publishes under its own token, so it is held to Video as well.
      if (!check.grant.sources.includes("screen_share")) await removeCompanionFromRoom(roomName, check.userId);
      // Not in the room (yet): leave the row as it is so the next sweep tries again.
      if (ok) applied.push({ rowId: check.rowId, grantKey: check.grantKey, stageSpeaker: check.grant.stageSpeaker });
    }
    if (applied.length > 0 || removed.length > 0) await ctx.runMutation(internal.voiceGrants.recordGrants, { applied, removed });
  },
});

/** End someone's connection to a voice room — for a moderator's disconnect, a kick, a ban or a timeout. */
export const evict = internalAction({
  args: { channelId: v.id("channels"), userId: v.id("users") },
  handler: async (_ctx, { channelId, userId }): Promise<void> => {
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return;
    await removeFromRoom(`channel-${channelId}`, userId);
  },
});
