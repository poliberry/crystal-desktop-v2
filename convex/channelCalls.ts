"use node";

import { v } from "convex/values";
import { AccessToken } from "livekit-server-sdk";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { closeRoomIfEmpty, ensureRoom } from "./lib/liveKitAdmin";

/** Same shape as callTokens.ts's join/leave, but for a community voice
 * channel instead of a DM — see that file for why this needs "use node". */
export const join = action({
  args: { channelId: v.id("channels") },
  handler: async (ctx, { channelId }): Promise<{ token: string; url: string; roomName: string }> => {
    const { userId, name } = await ctx.runQuery(internal.channels.getVoiceJoinContext, { channelId });
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
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return { token: await at.toJwt(), url, roomName };
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
