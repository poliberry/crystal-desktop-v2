"use client";

import { useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { HeadphoneOff, MicOff } from "lucide-react";
import { ParticipantEvent, RoomEvent, type Participant } from "livekit-client";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useCall } from "@/components/call/call-provider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSoundboardActivity } from "@/hooks/use-soundboard-activity";
import { cn } from "@/lib/utils";

interface ParticipantMeta {
  name?: string;
  imageUrl?: string;
}

/**
 * One avatar in the mini call panel — the same speaking (emerald) and
 * soundboard (sky) rings as a full call tile, plus a mute / deafen corner
 * badge. Deliberately no video: this is the persistent bar shown while you
 * browse elsewhere, not the call screen.
 *
 * Per-participant event wiring mirrors ParticipantTile, minus everything to
 * do with tracks that carry pictures.
 */
export function ParticipantChip({
  participant,
  soundboardActive,
  meta,
  className,
}: {
  participant: Participant;
  soundboardActive: boolean;
  meta: ParticipantMeta;
  className?: string;
}) {
  const [isSpeaking, setIsSpeaking] = useState(participant.isSpeaking);
  const [micMuted, setMicMuted] = useState(!participant.isMicrophoneEnabled);
  // Mirrored from the participant's own attributes — see `useRoom`, which
  // publishes it whenever the local deafen state changes.
  const [deafened, setDeafened] = useState(participant.attributes?.deafened === "1");

  useEffect(() => {
    const syncSpeaking = () => setIsSpeaking(participant.isSpeaking);
    const syncState = () => {
      setMicMuted(!participant.isMicrophoneEnabled);
      setDeafened(participant.attributes?.deafened === "1");
    };
    syncSpeaking();
    syncState();
    participant
      .on(ParticipantEvent.IsSpeakingChanged, syncSpeaking)
      .on(ParticipantEvent.TrackMuted, syncState)
      .on(ParticipantEvent.TrackUnmuted, syncState)
      .on(ParticipantEvent.TrackPublished, syncState)
      .on(ParticipantEvent.TrackUnpublished, syncState)
      .on(ParticipantEvent.AttributesChanged, syncState);
    return () => {
      participant
        .off(ParticipantEvent.IsSpeakingChanged, syncSpeaking)
        .off(ParticipantEvent.TrackMuted, syncState)
        .off(ParticipantEvent.TrackUnmuted, syncState)
        .off(ParticipantEvent.TrackPublished, syncState)
        .off(ParticipantEvent.TrackUnpublished, syncState)
        .off(ParticipantEvent.AttributesChanged, syncState);
    };
  }, [participant]);

  const name = meta.name || participant.name || participant.identity;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("relative shrink-0", className)}>
            <Avatar
              className={cn(
                "size-7 rounded-md ring-2 ring-transparent transition-shadow",
                // Soundboard wins the ring while it's active — it's the more
                // momentary of the two, so it reads as an event not a state.
                soundboardActive
                  ? "ring-sky-500"
                  : isSpeaking && "ring-emerald-500",
                deafened && "opacity-60"
              )}
            >
              <AvatarImage src={meta.imageUrl} alt={name} className="rounded-md" />
              <AvatarFallback className="rounded-md text-[9px]">
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {(deafened || micMuted) && (
              <span className="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-card text-destructive">
                {deafened ? (
                  <HeadphoneOff className="size-2.5" aria-label="Deafened" />
                ) : (
                  <MicOff className="size-2.5" aria-label="Muted" />
                )}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          {name}
          {deafened ? " · Deafened" : micMuted ? " · Muted" : ""}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Everyone in the call, with the profile each is shown under and who is making
 * a soundboard noise right now. Shared by the strip below and by the sidebar's
 * call card, which shows the same people differently.
 *
 * Re-renders when the active speakers change as well as when people come and
 * go, so anything sorting by who spoke last stays current.
 */
export function useCallRoster() {
  const { activeCall, controller } = useCall();
  const { room } = controller;
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [, setSpeakerTick] = useState(0);
  const soundboardActive = useSoundboardActivity();

  useEffect(() => {
    const refresh = () =>
      setParticipants([
        room.localParticipant,
        ...Array.from(room.remoteParticipants.values()),
      ]);
    const speakersChanged = () => setSpeakerTick((n) => n + 1);
    refresh();
    room
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.Connected, refresh)
      .on(RoomEvent.Disconnected, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, speakersChanged);
    return () => {
      room
        .off(RoomEvent.ParticipantConnected, refresh)
        .off(RoomEvent.ParticipantDisconnected, refresh)
        .off(RoomEvent.Connected, refresh)
        .off(RoomEvent.Disconnected, refresh)
        .off(RoomEvent.ActiveSpeakersChanged, speakersChanged);
    };
  }, [room]);

  const identityKey = participants.map((p) => p.identity).join(",");
  const userIds = useMemo(
    () => participants.map((p) => p.identity as Id<"users">),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [identityKey]
  );
  const userData = useQuery(
    api.users.getUsersByIds,
    userIds.length
      ? {
          userIds,
          communityId:
            activeCall?.kind === "channel" ? activeCall.communityId : undefined,
        }
      : "skip"
  );
  const metaByIdentity = new Map(
    (userData ?? []).map((u) => [u.id as string, u as ParticipantMeta])
  );

  return { participants, metaByIdentity, soundboardActive };
}

/**
 * Whoever is talking, then whoever talked most recently, then everyone else —
 * with you last among equals, since you know what you sound like.
 */
export function sortByActivity(participants: Participant[]): Participant[] {
  return [...participants].sort(
    (a, b) =>
      Number(b.isSpeaking) - Number(a.isSpeaking) ||
      (b.lastSpokeAt?.getTime() ?? 0) - (a.lastSpokeAt?.getTime() ?? 0) ||
      Number(a.isLocal) - Number(b.isLocal)
  );
}

/**
 * Everyone in the current call, as avatars with live speaking / soundboard
 * rings — the mini-panel version of the call grid, shown in the user card
 * while a call is running so you can see who's in it and who's talking
 * without opening the full screen.
 */
export function CallParticipantStrip() {
  const { participants, metaByIdentity, soundboardActive } = useCallRoster();

  if (participants.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {participants.map((p) => (
        <ParticipantChip
          key={p.identity}
          participant={p}
          soundboardActive={soundboardActive.has(p.identity)}
          meta={metaByIdentity.get(p.identity) ?? {}}
        />
      ))}
    </div>
  );
}
