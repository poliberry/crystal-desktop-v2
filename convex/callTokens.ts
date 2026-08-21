"use node";

import { v } from "convex/values";
import { AccessToken } from "livekit-server-sdk";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { closeRoomIfEmpty, ensureRoom } from "./lib/liveKitAdmin";

/**
 * Mints a LiveKit join token for a conversation's call room. Runs in the Node
 * runtime because `livekit-server-sdk` needs Node's crypto — that means it
 * can't touch `ctx.db` directly, so membership checks and the
 * `callParticipants` upsert are delegated to internal functions in calls.ts.
 */
export const join = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<{ token: string; url: string; roomName: string }> => {
    const { userId, name } = await ctx.runQuery(internal.calls.getJoinContext, { conversationId });
    await ctx.runMutation(internal.calls.recordJoin, { conversationId, userId });

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      throw new Error("LiveKit is not configured on the server.");
    }

    const roomName = `dm-${conversationId}`;
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

/**
 * Leaves a conversation's call: drops the caller's `callParticipants` row
 * and, if that was the last person in it, closes the LiveKit room instead of
 * leaving it to sit empty until its timeout.
 */
export const leave = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<void> => {
    const userId = await ctx.runQuery(internal.users.getCurrentUserIdInternal, {});
    if (!userId) return;
    const remaining = await ctx.runMutation(internal.calls.recordLeave, { conversationId, userId });
    await closeRoomIfEmpty(`dm-${conversationId}`, remaining);
  },
});
