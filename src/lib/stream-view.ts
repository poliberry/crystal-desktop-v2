/**
 * Telling a streamer that someone is watching.
 *
 * LiveKit doesn't hand a publisher the list of who has subscribed to their
 * track — subscription is negotiated between each viewer and the SFU, and the
 * publisher isn't part of that conversation. So the viewer says so directly,
 * as a data packet addressed to the publisher, in the same way a soundboard
 * hit and a join sound already travel (see src/lib/soundboard.ts).
 *
 * Sent only to the publisher rather than broadcast: who is watching your
 * stream is your business, and nobody else in the call has any use for it.
 */

/** Its own topic, so a view notice can't be confused with a sound to play. */
export const STREAM_VIEW_TOPIC = "streamview";

export interface StreamViewPacket {
  kind: "streamview";
  /** True when they started watching, false when they stopped. */
  watching: boolean;
}

// Return type inferred rather than written as `Uint8Array`: that widens the
// buffer to `ArrayBufferLike`, which LiveKit's `publishData` won't take.
export function encodeStreamView(watching: boolean) {
  const packet: StreamViewPacket = { kind: "streamview", watching };
  return new TextEncoder().encode(JSON.stringify(packet));
}

/** `null` for anything that isn't a well-formed view notice. */
export function decodeStreamView(payload: Uint8Array): StreamViewPacket | null {
  try {
    const packet = JSON.parse(new TextDecoder().decode(payload)) as StreamViewPacket;
    if (packet?.kind !== "streamview" || typeof packet.watching !== "boolean") return null;
    return packet;
  } catch {
    return null;
  }
}
