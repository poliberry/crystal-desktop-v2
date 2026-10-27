"use node";

import { v } from "convex/values";
import { AccessToken, TrackSource } from "livekit-server-sdk";

import { internal } from "./_generated/api";
import type { OpResult } from "./botOps";
import { internalAction } from "./_generated/server";
import { closeRoomIfEmpty, ensureRoom } from "./lib/liveKitAdmin";

/**
 * Joining voice as a bot — to speak and to play soundboard clips, not to share video or a screen.
 * Two steps, because only Node can mint a LiveKit token: the checks and the
 * participant row happen in `botOps` (so a bot that isn't allowed in never gets a token and is never
 * shown in the channel), then this signs a token for the bot's own account.
 *
 * The token is the same kind a person gets — it names the bot's user id as the identity, which is
 * what the call-reconciliation sweep compares against LiveKit's live participants — so a bot that
 * is shown in a channel but never actually connects is removed again within a minute, as a person
 * whose client crashed would be.
 */

const args = { prefix: v.string(), hash: v.string(), params: v.record(v.string(), v.string()) };

export const join = internalAction({
  args,
  handler: async (ctx, { prefix, hash, params }): Promise<OpResult> => {
    const prepared: OpResult = await ctx.runMutation(internal.botOps.execute, { prefix, hash, op: "voice.prepare", params, body: {}, query: {} });
    if (!prepared.ok) return prepared;
    const info = prepared.data as { channelId: string; userId: string; name: string };
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !url) {
      // Give the row back: nobody is going to connect.
      await ctx.runMutation(internal.botOps.execute, { prefix, hash, op: "voice.leave", params, body: {}, query: {} });
      return { ok: false, status: 503, message: "Voice isn't available right now." };
    }
    const roomName = `channel-${info.channelId}`;
    await ensureRoom(roomName);
    const at = new AccessToken(apiKey, apiSecret, { identity: info.userId, name: info.name, ttl: "4h" });
    // Audio and soundboard only. A bot may publish a microphone track and data packets (a soundboard
    // press is a data packet); the token itself forbids camera and screen-share tracks, so LiveKit
    // refuses them whatever the bot's code tries — it isn't a rule the bot is trusted to keep.
    at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canSubscribe: true, canPublishData: true });
    return { ok: true, status: 200, botId: prepared.botId, data: { url, token: await at.toJwt(), roomName, identity: info.userId, expiresInSeconds: 4 * 3600 } };
  },
});

export const leave = internalAction({
  args,
  handler: async (ctx, { prefix, hash, params }): Promise<OpResult> => {
    const result: OpResult = await ctx.runMutation(internal.botOps.execute, { prefix, hash, op: "voice.leave", params, body: {}, query: {} });
    if (result.ok) {
      const remaining = (result.data as { remaining?: number }).remaining ?? 1;
      await closeRoomIfEmpty(`channel-${params.channelId}`, remaining).catch(() => undefined);
    }
    return result;
  },
});

/**
 * Remove an account from a voice room in LiveKit itself.
 *
 * A person's app leaves the call when its participant row disappears (it is subscribed to the row);
 * a bot isn't, so when a bot is removed, suspended or disconnected by a moderator the row going
 * away isn't enough — it would stay connected and keep talking. This is what actually ends it.
 */
export const evict = internalAction({
  args: { channelId: v.string(), identity: v.string() },
  handler: async (_ctx, { channelId, identity }) => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) return;
    const { RoomServiceClient } = await import("livekit-server-sdk");
    await new RoomServiceClient(url, apiKey, apiSecret).removeParticipant(`channel-${channelId}`, identity).catch(() => undefined);
  },
});
