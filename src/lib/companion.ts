"use client";

import { useEffect, useState } from "react";
import {
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type Room,
  type TrackPublication,
} from "livekit-client";

/**
 * Screen-share "companion" participants.
 *
 * Mobile WebRTC can only send mic audio per connection, so a phone sharing its
 * screen with device audio opens a second LiveKit connection in the same room
 * as `<userId>:screen`, publishing only ScreenShare + ScreenShareAudio (tokens
 * from `callTokens.joinScreen` / `channelCalls.joinScreen`; server side in
 * convex/lib/companion.ts).
 *
 * Viewers must never show a companion as a participant of its own: its tracks
 * belong to the owner. `useRoom` filters companions out of `participants` and
 * reports their shares under the owner's identity in `screenShares`; anything
 * that attaches screen-share tracks resolves them through
 * `screenSharePublication`, which looks at the owner's companion first.
 */

export const COMPANION_IDENTITY_SUFFIX = ":screen";
export const COMPANION_OF_ATTRIBUTE = "crystal.companionOf";

type Identified = Pick<Participant, "identity"> & { attributes?: Readonly<Record<string, string>> };

export function isCompanion(p: Identified): boolean {
  if (p.attributes?.[COMPANION_OF_ATTRIBUTE]) return true;
  return p.identity.endsWith(COMPANION_IDENTITY_SUFFIX);
}

/** The user a participant's media belongs to: the owner for a companion, itself otherwise. */
export function ownerIdentity(p: Identified): string {
  const owner = p.attributes?.[COMPANION_OF_ATTRIBUTE];
  if (owner) return owner;
  if (p.identity.endsWith(COMPANION_IDENTITY_SUFFIX)) {
    return p.identity.slice(0, -COMPANION_IDENTITY_SUFFIX.length);
  }
  return p.identity;
}

/** Remote participants that are actual people (companions excluded). */
export function realRemoteParticipants(room: Room): RemoteParticipant[] {
  return Array.from(room.remoteParticipants.values()).filter((p) => !isCompanion(p));
}

/** The screen-share companion connected for `owner`, if any. */
export function findCompanion(room: Room | null | undefined, owner: string): RemoteParticipant | undefined {
  if (!room) return undefined;
  const direct = room.remoteParticipants.get(`${owner}${COMPANION_IDENTITY_SUFFIX}`);
  if (direct) return direct;
  for (const p of room.remoteParticipants.values()) {
    if (p.attributes?.[COMPANION_OF_ATTRIBUTE] === owner) return p;
  }
  return undefined;
}

type ScreenSource = Track.Source.ScreenShare | Track.Source.ScreenShareAudio;

/**
 * The owner's screen-share publication for `source`, wherever it lives: on
 * their companion when one is publishing it, else on the owner themselves
 * (desktop shares from its main participant).
 */
export function screenSharePublication(
  owner: Participant,
  companion: Participant | null | undefined,
  source: ScreenSource
): TrackPublication | undefined {
  return companion?.getTrackPublication(source) ?? owner.getTrackPublication(source);
}

/** Participant that carries `owner`'s screen-share video (companion or owner). */
export function screenShareCarrier(room: Room | null | undefined, owner: Participant): Participant {
  const companion = findCompanion(room, owner.identity);
  if (companion?.getTrackPublication(Track.Source.ScreenShare)) return companion;
  return owner;
}

/**
 * The owner's companion, kept current as companions connect and disconnect.
 * Components that attach screen-share tracks listen for track events on both
 * the owner and this.
 */
export function useCompanion(room: Room | null | undefined, owner: string | null | undefined): RemoteParticipant | undefined {
  const [companion, setCompanion] = useState<RemoteParticipant | undefined>(() =>
    owner ? findCompanion(room, owner) : undefined
  );
  useEffect(() => {
    if (!room || !owner) {
      setCompanion(undefined);
      return;
    }
    const refresh = () => setCompanion(findCompanion(room, owner));
    refresh();
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ParticipantAttributesChanged, refresh)
      .on(RoomEvent.Connected, refresh)
      .on(RoomEvent.Disconnected, refresh);
    return () => {
      room
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.ParticipantAttributesChanged, refresh)
        .off(RoomEvent.Connected, refresh)
        .off(RoomEvent.Disconnected, refresh);
    };
  }, [room, owner]);
  return companion;
}
