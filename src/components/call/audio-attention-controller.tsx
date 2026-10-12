"use client";

import { RoomEvent, type Room } from "livekit-client";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useAudioPreferences } from "@/components/audio-provider";
import {
  AttentionTracker,
  attentionApplies,
  attentionOverrideVersion,
  getAttentionGain,
  resetAttention,
  setAttentionGain,
  stepGain,
  subscribeAttentionOverrides,
  targetGain,
} from "@/lib/audio-attention";

/**
 * Drives Audio Attention for the call you are in (see src/lib/audio-attention.ts for what it does and why it fades the
 * way it does). Renders nothing. Mounted once, inside the call provider.
 *
 * It watches who is speaking and which streams you are watching, works out whether any stream that is subject to ducking
 * is playing under someone else's voice, and eases one shared level towards the right value. The stream tiles read that
 * level and set their own audio volume; this component never touches an audio element.
 *
 * The loop only runs while there is something to do: while a stream is being watched. With nothing watched, or the feature
 * off everywhere, there is no timer and no listener doing work.
 */
export function AudioAttentionController({ room, watchedShares }: { room: Room; watchedShares: string[] }) {
  const { audioAttention, audioAttentionStrength } = useAudioPreferences();
  const latest = useRef({ audioAttention, audioAttentionStrength, watchedShares });
  latest.current = { audioAttention, audioAttentionStrength, watchedShares };

  // A right-click choice about one stream changes whether the loop should run at all, so it redraws this too.
  useSyncExternalStore(subscribeAttentionOverrides, attentionOverrideVersion, () => 0);
  const kick = useRef<() => void>(() => {});
  useEffect(() => subscribeAttentionOverrides(() => kick.current()), []);

  const active = watchedShares.some((id) => attentionApplies(id, audioAttention));
  useEffect(() => {
    if (!active) {
      setAttentionGain(1);
      return;
    }
    const tracker = new AttentionTracker();
    let raf = 0;
    let last = performance.now();
    let speaking = 0;

    // Other people only: your own voice doesn't turn the stream down.
    const readSpeakers = () => {
      speaking = room.activeSpeakers.filter((p) => p.identity !== room.localParticipant.identity).length;
    };
    readSpeakers();

    const frame = (now: number) => {
      const { audioAttention: setting, audioAttentionStrength: strength, watchedShares: shares } = latest.current;
      // Watching something that ducking applies to.
      const watching = shares.some((id) => attentionApplies(id, setting));
      const ducked = tracker.update(now, { watching, othersSpeaking: speaking });
      const next = stepGain(getAttentionGain(), targetGain(ducked, strength), now - last);
      last = now;
      setAttentionGain(next);
      // Settled with nobody talking: stop spinning until the next speaker event wakes it.
      if (next === 1 && !ducked && speaking === 0) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    kick.current = wake;
    const onSpeakers = () => {
      readSpeakers();
      wake();
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers);
    wake();

    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, onSpeakers);
      if (raf) cancelAnimationFrame(raf);
      kick.current = () => {};
      setAttentionGain(1);
    };
  }, [active, room]);

  // A new call starts clean: no leftover level and no choices about streams that are gone.
  useEffect(() => {
    const clear = () => resetAttention();
    room.on(RoomEvent.Disconnected, clear);
    return () => void room.off(RoomEvent.Disconnected, clear);
  }, [room]);

  return null;
}
