"use node";

import { RoomServiceClient } from "livekit-server-sdk";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";

function getClient(): RoomServiceClient | null {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) return null;
  return new RoomServiceClient(url, apiKey, apiSecret);
}

type Row = { kind: "dm"; id: Id<"conversations">; userId: Id<"users"> } | { kind: "channel"; id: Id<"channels">; userId: Id<"users"> };

/**
 * Defense-in-depth for the LiveKit webhook (convex/http.ts): a refresh, crash,
 * or force-quit disconnects the client without ever running the explicit
 * `leave` action, leaving a stale `callParticipants`/`channelCallParticipants`
 * row behind (shown as a "ghost" connected member). The webhook usually
 * catches this immediately; this sweep catches whatever it misses (webhook
 * delivery failure, or the LiveKit project's webhook URL not configured yet)
 * by asking LiveKit directly who's actually still in each room.
 */
export const reconcile = internalAction({
  args: {},
  handler: async (ctx) => {
    const svc = getClient();
    if (!svc) return;

    const [dmRows, channelRows] = await Promise.all([
      ctx.runQuery(internal.calls.listAllParticipants, {}),
      ctx.runQuery(internal.channels.listAllVoiceParticipants, {}),
    ]);

    const byRoom = new Map<string, Row[]>();
    for (const row of dmRows) {
      const roomName = `dm-${row.conversationId}`;
      const list = byRoom.get(roomName) ?? [];
      list.push({ kind: "dm", id: row.conversationId, userId: row.userId });
      byRoom.set(roomName, list);
    }
    for (const row of channelRows) {
      const roomName = `channel-${row.channelId}`;
      const list = byRoom.get(roomName) ?? [];
      list.push({ kind: "channel", id: row.channelId, userId: row.userId });
      byRoom.set(roomName, list);
    }

    for (const [roomName, rows] of byRoom) {
      let liveIdentities: Set<string>;
      try {
        const participants = await svc.listParticipants(roomName);
        liveIdentities = new Set(participants.map((p) => p.identity));
      } catch {
        liveIdentities = new Set(); // Room doesn't exist anymore — every row here is stale.
      }

      for (const row of rows) {
        if (liveIdentities.has(row.userId)) continue;
        if (row.kind === "dm") {
          await ctx.runMutation(internal.calls.recordLeave, { conversationId: row.id, userId: row.userId });
        } else {
          await ctx.runMutation(internal.channels.recordVoiceLeave, { channelId: row.id, userId: row.userId });
        }
      }
    }
  },
});
