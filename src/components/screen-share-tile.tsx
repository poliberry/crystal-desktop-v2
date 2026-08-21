"use client";

import { useEffect, useRef, useState } from "react";
import {
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from "livekit-client";
import { Eye, EyeOff, Plus } from "lucide-react";

import { routeElementToPlayback } from "@/lib/system-audio";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ScreenShareTileProps {
  participant: Participant;
  isLocal?: boolean;
  fill?: boolean;
  onClick?: () => void;
  /** Controls whether screen-share audio plays (used when multiple shares are active). */
  audioEnabled?: boolean;
  watching?: boolean;
  canWatch?: boolean;
  onWatch?: () => void;
  /** Add this stream alongside any currently-watched streams. Only provided when applicable. */
  onWatchAdd?: () => void;
  localVolume?: number;
  localMuted?: boolean;
}

export function ScreenShareTile({
  participant,
  isLocal = false,
  fill = false,
  onClick,
  audioEnabled = true,
  watching,
  canWatch,
  onWatch,
  onWatchAdd,
  localVolume,
  localMuted,
}: ScreenShareTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [hasScreen, setHasScreen] = useState(false);

  // Keep refs in sync so closures read fresh values without re-running effects
  const localVolumeRef = useRef(localVolume ?? 1);
  const localMutedRef = useRef(!!localMuted);
  localVolumeRef.current = localVolume ?? 1;
  localMutedRef.current = !!localMuted;

  // --- Video effect (re-runs when the watch gate changes, in addition to
  // participant changes, so a tile only downloads/decodes video once
  // watched) ---
  useEffect(() => {
    const el = videoRef.current;
    // `canWatch` false means gating doesn't apply to this tile at all (e.g.
    // the local user's own share, handled separately via `isLocal` below) —
    // in that case behave as before and always attach. Otherwise only attach
    // once the viewer has explicitly clicked "Watch".
    const gated = !isLocal && canWatch;
    const allowed = !gated || watching;

    const attachVideo = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      if (!el) return;
      if (allowed && track && track.kind === Track.Kind.Video) {
        track.attach(el);
        setHasScreen(true);
      } else {
        el.srcObject = null;
        setHasScreen(false);
      }
    };

    const refresh = () => attachVideo(participant.getTrackPublication(Track.Source.ScreenShare));

    const onTrackSubscribed = (track: { source?: Track.Source }) => {
      if (track.source === Track.Source.ScreenShare) refresh();
    };
    const onTrackUnsubscribed = () => refresh();
    const onLocalTrackPublished = () => refresh();
    const onTrackMuted = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.ScreenShare) setHasScreen(false);
    };
    const onTrackUnmuted = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.ScreenShare) refresh();
    };

    refresh();
    participant
      .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
      .on(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
      .on(RoomEvent.LocalTrackUnpublished, onLocalTrackPublished)
      .on(RoomEvent.TrackMuted, onTrackMuted)
      .on(RoomEvent.TrackUnmuted, onTrackUnmuted);

    return () => {
      participant
        .off(RoomEvent.TrackSubscribed, onTrackSubscribed)
        .off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed)
        .off(RoomEvent.LocalTrackPublished, onLocalTrackPublished)
        .off(RoomEvent.LocalTrackUnpublished, onLocalTrackPublished)
        .off(RoomEvent.TrackMuted, onTrackMuted)
        .off(RoomEvent.TrackUnmuted, onTrackUnmuted);
      const track = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (el && track) track.detach(el);
      if (el) el.srcObject = null;
    };
  }, [participant, isLocal, canWatch, watching]);

  // --- Audio effect (re-runs when audioEnabled changes to attach/detach) ---
  useEffect(() => {
    const container = audioRef.current;
    const clear = () => container?.replaceChildren();

    const attachAudio = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      if (!track || track.kind !== Track.Kind.Audio) return;
      if (isLocal || !audioEnabled) return;
      const el = track.attach();
      el.style.display = "none";
      el.volume = localMutedRef.current ? 0 : localVolumeRef.current;
      container?.appendChild(el);
      void routeElementToPlayback(el);
    };

    const refresh = () => {
      clear();
      attachAudio(participant.getTrackPublication(Track.Source.ScreenShareAudio));
    };

    const onTrackSubscribed = (track: { source?: Track.Source }) => {
      if (track.source === Track.Source.ScreenShareAudio) refresh();
    };
    const onTrackUnsubscribed = () => clear();

    refresh();
    participant
      .on(RoomEvent.TrackSubscribed, onTrackSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);

    return () => {
      participant
        .off(RoomEvent.TrackSubscribed, onTrackSubscribed)
        .off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      clear();
    };
  }, [participant, isLocal, audioEnabled]);

  // --- Volume / mute updates applied live to existing audio elements ---
  useEffect(() => {
    const vol = localMuted ? 0 : (localVolume ?? 1);
    audioRef.current?.querySelectorAll("audio").forEach((el) => {
      (el as HTMLAudioElement).volume = vol;
    });
  }, [localVolume, localMuted]);

  const name = participant.name || participant.identity;

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex max-h-full max-w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/40",
        fill ? "h-full w-full" : "aspect-video w-full",
        onClick && "cursor-pointer"
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn("h-full w-full object-contain", !hasScreen && "hidden")}
      />

      {!hasScreen && (
        <div className="flex flex-col items-center gap-1 text-muted-foreground">
          <span className="text-sm">No screen shared</span>
        </div>
      )}

      <Badge variant="secondary" className="absolute left-2 top-2">
        Screen
      </Badge>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
        <span className="text-xs font-medium text-white drop-shadow">
          {name}
          {isLocal ? " (You)" : ""}
        </span>

        {!isLocal && canWatch && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {onWatchAdd && (
              <button
                type="button"
                onClick={onWatchAdd}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white/80 hover:bg-white/20 hover:text-white"
              >
                <Plus className="size-3" />
                Add
              </button>
            )}
            <button
              type="button"
              onClick={onWatch}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-white/20",
                watching ? "text-emerald-400" : "text-white/80 hover:text-white"
              )}
            >
              {watching ? (
                <><EyeOff className="size-3" />Unwatch</>
              ) : (
                <><Eye className="size-3" />Watch</>
              )}
            </button>
          </div>
        )}
      </div>

      <div ref={audioRef} className="hidden" aria-hidden />
    </div>
  );
}
