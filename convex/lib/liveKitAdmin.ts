"use node";

import { RoomServiceClient } from "livekit-server-sdk";

/**
 * Shared LiveKit room-lifecycle helpers used by both DM calls (callTokens.ts)
 * and community voice channels (channelCalls.ts), so a LiveKit room never
 * outlives everyone having left it — belt and suspenders:
 *
 *  - `ensureRoom` sets a short server-side `emptyTimeout` when a room is
 *    first created, so LiveKit itself closes it even if a client disconnects
 *    ungracefully (crash, force-quit) and our own leave-cleanup never runs.
 *  - `closeRoomIfEmpty` proactively deletes the room the moment our own
 *    participant bookkeeping says it's empty, instead of waiting out that
 *    timeout — keeps things tidy without depending on it.
 */

const EMPTY_TIMEOUT_SECONDS = 60;

let client: RoomServiceClient | null = null;

function getClient(): RoomServiceClient {
  if (client) return client;
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error("LiveKit is not configured on the server.");
  }
  client = new RoomServiceClient(url, apiKey, apiSecret);
  return client;
}

export async function ensureRoom(roomName: string): Promise<void> {
  const svc = getClient();
  try {
    await svc.createRoom({ name: roomName, emptyTimeout: EMPTY_TIMEOUT_SECONDS });
  } catch {
    // Room already exists (or LiveKit didn't like being asked twice) — the
    // room's settings from its first creation still apply either way.
  }
}

export async function closeRoomIfEmpty(roomName: string, remainingParticipants: number): Promise<void> {
  if (remainingParticipants > 0) return;
  const svc = getClient();
  await svc.deleteRoom(roomName).catch(() => {
    // Already gone — e.g. the empty-timeout beat us to it. Fine either way.
  });
}
