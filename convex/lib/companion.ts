/**
 * Screen-share "companion" participants.
 *
 * Mobile WebRTC can only send mic audio per connection, so a phone that wants
 * to share its screen *with* device audio opens a second LiveKit connection in
 * the same room under the identity `<userId>:screen`. That connection
 * publishes only ScreenShare + ScreenShareAudio and is not a call participant:
 * it has no `callParticipants` / `channelCallParticipants` row, never rings,
 * and must be ignored by all participant bookkeeping (webhook, reconciliation,
 * room-empty checks). Tokens are minted by `callTokens.joinScreen` /
 * `channelCalls.joinScreen`.
 */

export const COMPANION_IDENTITY_SUFFIX = ":screen";
export const COMPANION_OF_ATTRIBUTE = "crystal.companionOf";
export const COMPANION_KIND_ATTRIBUTE = "crystal.kind";

export function companionIdentity(userId: string): string {
  return `${userId}${COMPANION_IDENTITY_SUFFIX}`;
}

/** True for a companion participant, judged by identity and (when known) attributes. */
export function isCompanionIdentity(identity: string, attributes?: Record<string, string> | null): boolean {
  if (attributes && attributes[COMPANION_OF_ATTRIBUTE]) return true;
  return identity.endsWith(COMPANION_IDENTITY_SUFFIX);
}
