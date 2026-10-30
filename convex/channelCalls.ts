"use node";

import { v } from "convex/values";
import { AccessToken, TrackSource } from "livekit-server-sdk";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { closeRoomIfEmpty, ensureRoom, mintScreenToken } from "./lib/liveKitAdmin";

/** Same shape as callTokens.ts's join/leave, but for a community voice
 * channel instead of a DM — see that file for why this needs "use node". */
export const join = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<{ token: string; url: string; roomName: string }> => {
    const { userId, name, canSpeak, canVideo } = await ctx.runQuery(internal.channels.getVoiceJoinContext, { channelId });
    await ctx.runMutation(internal.channels.recordVoiceJoin, { channelId, userId });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit is not configured on the server.");
    }

    const roomName = `channel-${channelId}`;
    await ensureRoom(roomName);

    const at = new AccessToken(apiKey, apiSecret, { identity: userId, name, ttl: "4h" });
    at.addGrant({
      room: roomName,
      roomJoin: true,
      // Without Speak and Video the member listens: they can be heard by nobody and seen by nobody.
      canPublish: canSpeak || canVideo,
      canPublishSources: [
        ...(canSpeak ? [TrackSource.MICROPHONE] : []),
        // Screen share is part of Video too (see getVoiceJoinContext). Once canPublishSources is set
        // LiveKit denies every source not listed, so leaving these out blocks sharing for everyone.
        ...(canVideo ? [TrackSource.CAMERA, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
      ],
      canSubscribe: true,
      canPublishData: true,
    });

    return { token: await at.toJwt(), url, roomName };
  },
});

/** Screen-share companion token for a voice channel — see callTokens.joinScreen. Same permission check
 * as `join`, but no recordVoiceJoin: the companion isn't a voice participant in the DB. */
export const joinScreen = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<{ token: string; url: string; roomName: string }> => {
    const { userId, name, canVideo } = await ctx.runQuery(internal.channels.getVoiceJoinContext, { channelId });
    if (!canVideo) throw new Error("You don't have permission to share your screen in this channel.");
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
