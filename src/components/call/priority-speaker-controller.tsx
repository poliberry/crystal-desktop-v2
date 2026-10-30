"use client";

import { RoomEvent, type Room } from "livekit-client";
import { useEffect } from "react";

import { isCompanion } from "@/lib/companion";
import {
  PriorityTracker,
  priorityIsSpeaking,
  priorityTargetGain,
  setPriorityGain,
  stepPriorityGain,
  getPriorityGain,
} from "@/lib/priority-speaker";

/**
 * Drives priority-speaker ducking for the call you are in (src/lib/priority-speaker.ts has the rules).
 * Renders nothing. Mounted once, inside the call provider.
 *
 * It watches who is speaking; while someone with the Priority Speaker permission (read from the attribute the
 * server signed into their token, so it can't be claimed) is talking, it eases one shared level down, and back
 * up when they stop. Participant tiles read that level and set their own audio volume — this never touches an
 * audio element. Someone who has priority themselves is not ducked, and neither is anyone for the priority
 * speaker's own ears.
 *
 * Like Audio Attention, the loop only runs while there is something to do: with no priority speaker in the
 * room it doesn't run at all.
 */
export function PrioritySpeakerController({ room }: { room: Room }) {
  useEffect(() => {
    const tracker = new PriorityTracker();
    let raf = 0;
    let last = performance.now();
    let prioritySpeaking = false;

    const read = () => {
      const self = room.localParticipant;
      // I have priority myself: other voices are not turned down for me, and my own voice is not a duck.
      const iHavePriority = self.attributes?.priority === "1";
      prioritySpeaking =
        !iHavePriority &&
        priorityIsSpeaking(
          room.activeSpeakers.filter((p) => !isCompanion(p)),
          self.identity,
        );
    };

    const frame = (now: number) => {
      const ducked = tracker.update(now, prioritySpeaking);
      const next = stepPriorityGain(getPriorityGain(), priorityTargetGain(ducked), now - last);
      last = now;
      setPriorityGain(next);
      // Settled with nobody priority talking: stop until the next speaker event wakes it.
      if (next === 1 && !ducked && !prioritySpeaking) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      read();
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    room.on(RoomEvent.ActiveSpeakersChanged, wake);
    room.on(RoomEvent.ParticipantAttributesChanged, wake);
    room.on(RoomEvent.ParticipantDisconnected, wake);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, wake);
      room.off(RoomEvent.ParticipantAttributesChanged, wake);
      room.off(RoomEvent.ParticipantDisconnected, wake);
      if (raf) cancelAnimationFrame(raf);
      setPriorityGain(1);
    };
  }, [room]);

  // A new call starts at full level.
  useEffect(() => {
    const reset = () => setPriorityGain(1);
    room.on(RoomEvent.Disconnected, reset);
    return () => void room.off(RoomEvent.Disconnected, reset);
  }, [room]);

  return null;
}
