"use node";

import { v } from "convex/values";
import { WebhookReceiver } from "livekit-server-sdk";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { isCompanionIdentity } from "./companion";
import { closeRoomIfEmpty } from "./liveKitAdmin";

function parseRoomName(roomName: string): { kind: "dm"; conversationId: string } | { kind: "channel"; channelId: string } | null {
  if (roomName.startsWith("dm-")) return { kind: "dm", conversationId: roomName.slice(3) };
  if (roomName.startsWith("channel-")) return { kind: "channel", channelId: roomName.slice(8) };
  return null;
}

/**
 * Receives LiveKit's room webhooks (see convex/http.ts) — in particular
 * `participant_left`, which fires for every disconnect (explicit leave,
 * refresh, crash, network drop, force-quit) regardless of whether our own
 * client-side `leave` action ever ran. Without this, a refresh mid-call
 * leaves a stale `callParticipants`/`channelCallParticipants` row behind
 * (a "ghost" participant that's still shown as connected). The cron sweep in
 * callReconciliation.ts is the fallback for whatever this misses.
 *
 * Requires the LiveKit project's webhook URL to be configured (in the
 * LiveKit Cloud dashboard, or self-hosted server config) to point at this
 * deployment's `/livekit/webhook` HTTP Action URL, signed with the same
 * LIVEKIT_API_KEY/SECRET already used for token minting.
 */
export const handle = internalAction({
  args: { body: v.string(), authorization: v.string() },
  handler: async (ctx, { body, authorization }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) return;

    const receiver = new WebhookReceiver(apiKey, apiSecret);
    let event: Awaited<ReturnType<WebhookReceiver["receive"]>>;
    try {
      event = await receiver.receive(body, authorization);
    } catch {
      return; // Bad/missing signature — ignore rather than throw on a webhook endpoint.
    }

    if (event.event !== "participant_left") return;

    const roomName = event.room?.name;
    const identity = event.participant?.identity;
    if (!roomName || !identity) return;
    // A screen-share companion (`<userId>:screen`, see ./companion.ts) has no participant row of its own,
    // and its owner may well still be connected — it must never count as anyone leaving.
    if (isCompanionIdentity(identity, event.participant?.attributes)) return;

    const parsed = parseRoomName(roomName);
    if (!parsed) return;

    // When that connection joined LiveKit. Our own row is written just before the client connects, so a
    // row newer than this belongs to a later connection (a rejoin, a second device) and stays.
    const joinedSeconds = Number(event.participant?.joinedAt ?? 0);
    const joinedBefore = joinedSeconds > 0 ? joinedSeconds * 1000 : undefined;

    if (parsed.kind === "dm") {
      const remaining = await ctx.runMutation(internal.calls.recordLeave, {
        conversationId: parsed.conversationId as Id<"conversations">,
        userId: identity as Id<"users">,
        joinedBefore,
      });
      await closeRoomIfEmpty(roomName, remaining);
    } else {
      const remaining = await ctx.runMutation(internal.channels.recordVoiceLeave, {
        channelId: parsed.channelId as Id<"channels">,
        userId: identity as Id<"users">,
        joinedBefore,
      });
      await closeRoomIfEmpty(roomName, remaining);
    }
  },
});
