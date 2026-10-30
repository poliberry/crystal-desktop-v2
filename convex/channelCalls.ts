"use node";

import { v } from "convex/values";
import { AccessToken } from "livekit-server-sdk";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { closeRoomIfEmpty, ensureRoom, mintScreenToken, trackSourcesFor } from "./lib/liveKitAdmin";

/** Same shape as callTokens.ts's join/leave, but for a community voice channel
 * instead of a DM — see that file for why this needs "use node".
 *
 * The token is the server's word on what this person may do in the room (lib/voiceGrant.ts): the
 * microphone needs Speak, the camera and screen need Video, a server mute or deafen is held in the
 * grant itself, and on a stage the audience gets no publish rights until a moderator brings them up.
 * Attributes (priority speaker, push-to-talk required, stage role, soundboard rights) are signed in
 * with it, and `canUpdateOwnMetadata` is off so a client can't rewrite them. When any of that changes
 * while someone is connected, voiceSync.ts updates the room in place. */
export const join = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<{ token: string; url: string; roomName: string }> => {
    const { userId, name, grant, grantKey } = await ctx.runQuery(internal.channels.getVoiceJoinContext, { channelId });
    await ctx.runMutation(internal.channels.recordVoiceJoin, { channelId, userId, grantKey, stageSpeaker: grant.stageSpeaker });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit is not configured on the server.");
    }

    const roomName = `channel-${channelId}`;
    await ensureRoom(roomName);

    const at = new AccessToken(apiKey, apiSecret, { identity: userId, name, ttl: "4h", attributes: grant.attributes });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: grant.canPublish,
      // Once canPublishSources is set LiveKit denies every source not listed, so this is the whole list:
      // Speak is the microphone; Video is the camera, screen share and its audio.
      canPublishSources: trackSourcesFor(grant.sources),
      canSubscribe: grant.canSubscribe,
      canPublishData: grant.canPublishData,
      canUpdateOwnMetadata: false,
    });

    return { token: await at.toJwt(), url, roomName };
  },
});

/** Screen-share companion token for a voice channel — see callTokens.joinScreen. Same permission check
 * as `join`, but no recordVoiceJoin: the companion isn't a voice participant in the DB. */
export const joinScreen = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<{ token: string; url: string; roomName: string }> => {
    const { userId, name, grant, stage } = await ctx.runQuery(internal.channels.getVoiceJoinContext, { channelId });
    if (!grant.sources.includes("screen_share")) {
      throw new Error(
        stage && !grant.stageSpeaker
          ? "Only speakers can share their screen on a stage."
          : "You don't have permission to share your screen in this channel.",
      );
    }
    return mintScreenToken(`channel-${channelId}`, userId, name);
  },
});

export const leave = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<void> => {
    const userId = await ctx.runQuery(internal.users.getCurrentUserIdInternal, {});
    if (!userId) return;
    const remaining = await ctx.runMutation(internal.channels.recordVoiceLeave, { channelId, userId });
    await closeRoomIfEmpty(`channel-${channelId}`, remaining);
  },
});
