"use client";

import { useEffect, useRef, useState } from "react";
import {
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from "livekit-client";

import { routeElementToPlayback } from "@/lib/system-audio";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface ScreenShareTileProps {
  participant: Participant;
  isLocal?: boolean;
}

/**
 * Renders a participant's screen-share as its own card in the grid, separate
 * from their camera tile. Screen-share audio (if any) is played back for
 * remote participants only.
 */
export function ScreenShareTile({ participant, isLocal = false }: ScreenShareTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [hasScreen, setHasScreen] = useState(false);

  useEffect(() => {
    const attachVideo = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      const el = videoRef.current;
      if (!el) return;

      if (track && track.kind === Track.Kind.Video) {
        track.attach(el);
        setHasScreen(true);
      } else {
        el.srcObject = null;
        setHasScreen(false);
      }
    };

    const attachAudio = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      if (!track || track.kind !== Track.Kind.Audio) return;
      if (isLocal) return;

      const el = track.attach();
      el.style.display = "none";
      audioRef.current?.appendChild(el);
      void routeElementToPlayback(el);
    };

    // Fetch publications fresh each time: the screen-share *audio* track is
    // subscribed slightly after the video, so a reference captured at mount is
    // stale and would silently drop the audio.
    const refresh = () => {
      attachVideo(participant.getTrackPublication(Track.Source.ScreenShare));
      attachAudio(participant.getTrackPublication(Track.Source.ScreenShareAudio));
    };

    const onTrackSubscribed = (track: { source?: Track.Source }) => {
      if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) {
        refresh();
      }
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
      const videoElement = videoRef.current;
      if (videoElement && track) {
        track.detach(videoElement);
      }
      audioRef.current?.replaceChildren();
    };
  }, [participant, isLocal]);

  const name = participant.name || participant.identity;

  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn("h-full w-full object-cover", !hasScreen && "hidden")}
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
      </div>

      <div ref={audioRef} className="hidden" aria-hidden />
    </div>
  );
}
