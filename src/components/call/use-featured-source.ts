"use client";

import { useEffect, useRef, useState } from "react";
import type { Participant, RemoteParticipant, Room } from "livekit-client";

export interface FeaturedSource {
  kind: "screen" | "camera";
  identity: string;
  participant: Participant;
}

/** How often the picker re-reads the room. `isSpeaking` is a live property on
 * the participant, so polling it beats subscribing to an event per person in a
 * call that can hold dozens. */
const POLL_MS = 400;

/** Nothing switches faster than this, however much the room churns — a mini
 * player that strobes between two people talking over each other is unreadable. */
const MIN_DWELL_MS = 1200;

/** Silence before the view falls back from whoever last spoke to a stream. */
const SPEAKER_IDLE_MS = 2500;

/** With several streams and nobody talking, how long each gets. */
const STREAM_ROTATE_MS = 10_000;

/**
 * Pick the one thing worth showing in a mini player, and keep re-picking it.
 *
 * The rule, in priority order:
 *
 *  1. Whoever is speaking. If the current pick is still speaking, they keep it
 *     — otherwise two people in conversation would trade the frame every poll.
 *  2. Once the room has been quiet for a moment, whatever stream is being
 *     watched, rotating between them if there's more than one.
 *  3. Failing both, whatever was last shown, so a quiet call doesn't blank out.
 *
 * A remote screen share is only a candidate if we're actually subscribed to it
 * (`watchedShares`): an unsubscribed publication has no track to render, so
 * featuring it would show a black box. Our *own* share is never a candidate —
 * see `streams` below.
 */
export function useFeaturedSource({
  room,
  participants,
  screenShares,
  watchedShares,
  enabled,
}: {
  room: Room;
  /** Remote participants, from `useRoom`. */
  participants: RemoteParticipant[];
  /** Identities with a live, unmuted screen share (including our own). */
  screenShares: string[];
  /** Identities whose share we're subscribed to. */
  watchedShares: string[];
  /** False while the full call screen is up — nothing needs picking then. */
  enabled: boolean;
}): FeaturedSource | null {
  const [featured, setFeatured] = useState<FeaturedSource | null>(null);

  // The evaluator runs on a stable interval, so everything it reads comes from
  // a ref: a dependency on the live room state would tear the timer down and
  // rebuild it several times a second.
  const inputsRef = useRef({ room, participants, screenShares, watchedShares });
  inputsRef.current = { room, participants, screenShares, watchedShares };
  const featuredRef = useRef<FeaturedSource | null>(featured);
  featuredRef.current = featured;
  const lastSwitchRef = useRef(0);
  const lastSpeechRef = useRef(0);
  const streamIndexRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setFeatured(null);
      return;
    }

    const evaluate = () => {
      const { room, participants, screenShares, watchedShares } = inputsRef.current;
      const now = performance.now();
      const localIdentity = room.localParticipant.identity;

      const find = (identity: string): Participant | null =>
        identity === localIdentity
          ? room.localParticipant
          : (participants.find((p) => p.identity === identity) ?? null);

      // Our own share is deliberately excluded. Painting it into a mini
      // player that sits on top of the very desktop being captured is a
      // mirror pointed at itself: the player repaints from the capture, the
      // capture picks up the repaint, and the machine burns compositor,
      // capture and encoder time on a desktop that isn't changing (the same
      // reason `ScreenShareTile` doesn't preview your own share by default).
      // There is also nothing in it for the viewer — they are looking at the
      // screen it is a picture of.
      const streams = screenShares.filter(
        (identity) => identity !== localIdentity && watchedShares.includes(identity)
      );
      const speakers = participants.filter((p) => p.isSpeaking);
      if (speakers.length > 0) lastSpeechRef.current = now;

      const current = featuredRef.current;
      const currentIsValid = current
        ? current.kind === "screen"
          ? streams.includes(current.identity)
          : !!find(current.identity)
        : false;

      const speakerPick = (): FeaturedSource | null => {
        if (speakers.length === 0) return null;
        const holding =
          current?.kind === "camera" &&
          speakers.some((p) => p.identity === current.identity)
            ? find(current.identity)
            : null;
        const speaker = holding ?? speakers[0];
        return { kind: "camera", identity: speaker.identity, participant: speaker };
      };

      const streamPick = (): FeaturedSource | null => {
        if (streams.length === 0) return null;
        if (now - lastSpeechRef.current <= SPEAKER_IDLE_MS) return null;
        if (streams.length > 1 && now - lastSwitchRef.current > STREAM_ROTATE_MS) {
          streamIndexRef.current += 1;
        } else if (current?.kind === "screen" && streams.includes(current.identity)) {
          // Stay where we are, even if the list around us has shifted.
          streamIndexRef.current = streams.indexOf(current.identity);
        }
        const identity = streams[streamIndexRef.current % streams.length];
        const participant = find(identity);
        return participant ? { kind: "screen", identity, participant } : null;
      };

      const fallbackPick = (): FeaturedSource | null => {
        const identity = streams[0] ?? participants[0]?.identity ?? localIdentity;
        const participant = find(identity);
        if (!participant) return null;
        return {
          kind: streams.includes(identity) ? "screen" : "camera",
          identity,
          participant,
        };
      };

      const next =
        speakerPick() ?? streamPick() ?? (currentIsValid ? current : fallbackPick());

      if (!next) {
        if (current) setFeatured(null);
        return;
      }
      if (current && next.kind === current.kind && next.identity === current.identity) {
        return;
      }
      if (current && now - lastSwitchRef.current < MIN_DWELL_MS) return;
      lastSwitchRef.current = now;
      setFeatured(next);
    };

    evaluate();
    const timer = setInterval(evaluate, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return featured;
}
