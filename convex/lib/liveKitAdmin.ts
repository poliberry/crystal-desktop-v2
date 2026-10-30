"use node";

import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

import { COMPANION_KIND_ATTRIBUTE, COMPANION_OF_ATTRIBUTE, companionIdentity } from "./companion";
import type { VoiceGrant, VoiceSource } from "./voiceGrant";

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

/**
 * Token for a screen-share companion connection (see ./companion.ts), shared
 * by `callTokens.joinScreen` and `channelCalls.joinScreen`. The caller has
 * already authorized `userId` for `roomName`.
 */
export async function mintScreenToken(
  roomName: string,
  userId: string,
  name: string
): Promise<{ token: string; url: string; roomName: string }> {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    throw new Error("LiveKit is not configured on the server.");
  }

  // Idempotent: on an existing room createRoom fails silently and nothing changes.
  await ensureRoom(roomName);

  const at = new AccessToken(apiKey, apiSecret, {
    identity: companionIdentity(userId),
    name,
    ttl: "4h",
    attributes: { [COMPANION_OF_ATTRIBUTE]: userId, [COMPANION_KIND_ATTRIBUTE]: "screen" },
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    canSubscribe: false,
    canPublishData: false,
  });

  return { token: await at.toJwt(), url, roomName };
}

// --- Voice grants ---------------------------------------------------------------------------------

const TRACK_SOURCES: Record<VoiceSource, TrackSource> = {
  microphone: TrackSource.MICROPHONE,
  camera: TrackSource.CAMERA,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

/** A voice grant's sources as LiveKit's enum. Once `canPublishSources` is set LiveKit denies everything not listed. */
export function trackSourcesFor(sources: VoiceSource[]): TrackSource[] {
  return sources.map((s) => TRACK_SOURCES[s]);
}

/** The participant attributes the server signs into a voice token (convex/lib/voiceGrant.ts). Anything in this list that a grant no longer carries is removed when it is updated. */
const SIGNED_ATTRIBUTES = ["priority", "ptt", "stage", "sb", "xs"];

/**
 * Bring a connected participant's grant in line with `grant`, without reconnecting them: their publish
 * rights change at once (LiveKit stops any track they may no longer send) and the attributes the rest of
 * the room reads are rewritten. Returns false when they aren't in the room, which is fine — their next
 * token will carry the right grant anyway.
 */
export async function applyParticipantGrant(roomName: string, identity: string, grant: VoiceGrant): Promise<boolean> {
  const svc = getClient();
  try {
    const info = await svc.getParticipant(roomName, identity);
    const attributes: Record<string, string> = { ...grant.attributes };
    for (const key of SIGNED_ATTRIBUTES) if (!(key in attributes) && info.attributes?.[key] !== undefined) attributes[key] = "";
    await svc.updateParticipant(roomName, identity, {
      attributes,
      // Permissions are replaced as a whole, so what isn't changing is carried over.
      permission: {
        ...info.permission,
        canPublish: grant.canPublish,
        canPublishSources: trackSourcesFor(grant.sources),
        canSubscribe: grant.canSubscribe,
        canPublishData: grant.canPublishData,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a person from a voice room: their connection and any screen-share companion. `before` (ms)
 * spares a connection that began after the removal was decided — someone moved on and came straight back.
 */
export async function removeFromRoom(roomName: string, userId: string, before?: number): Promise<void> {
  const svc = getClient();
  for (const identity of [userId, companionIdentity(userId)]) {
    try {
      if (before !== undefined) {
        const info = await svc.getParticipant(roomName, identity);
        if (Number(info.joinedAt) * 1000 > before) continue;
      }
      await svc.removeParticipant(roomName, identity);
    } catch {
      // Not in the room (any more): nothing to remove.
    }
  }
}

/** Drop only the screen-share companion connection (the person's own connection stays). */
export async function removeCompanionFromRoom(roomName: string, userId: string): Promise<void> {
  await getClient().removeParticipant(roomName, companionIdentity(userId)).catch(() => undefined);
}
