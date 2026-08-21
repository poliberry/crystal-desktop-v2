"use client";

import { useEffect, useRef, useState } from "react";
import {
  ParticipantEvent,
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from "livekit-client";

import { getAvatarColor } from "@/lib/avatar-color";
import { routeElementToPlayback } from "@/lib/system-audio";
import { cn } from "@/lib/utils";

interface ParticipantTileProps {
  participant: Participant;
  isLocal?: boolean;
  imageUrl?: string;
  /** Fill the parent's box exactly (grid/focused view) instead of the
   * default fixed 16:9 card (bottom rail thumbnails). */
  fill?: boolean;
  onClick?: () => void;
  localVolume?: number;
  localMuted?: boolean;
}

/**
 * Renders a participant's camera / screen-share video and wires up audio
 * playback. When the app is sharing system audio, every audio element is
 * additionally routed to the hardware sink (Linux) so the app never
 * accidentally re-captures itself.
 */
export function ParticipantTile({ participant, isLocal = false, imageUrl, fill = false, onClick, localVolume, localMuted }: ParticipantTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(participant.isSpeaking);
  const [avatarBg, setAvatarBg] = useState<string | null>(null);

  // Keep refs fresh for use inside audio-attachment closure
  const localVolumeRef = useRef(localVolume ?? 1);
  const localMutedRef = useRef(!!localMuted);
  localVolumeRef.current = localVolume ?? 1;
  localMutedRef.current = !!localMuted;

  useEffect(() => {
    if (!imageUrl) { setAvatarBg(null); return; }
    getAvatarColor(imageUrl).then(setAvatarBg);
  }, [imageUrl]);

  useEffect(() => {
    setIsSpeaking(participant.isSpeaking);
    const onSpeakingChanged = (speaking: boolean) => setIsSpeaking(speaking);
    participant.on(ParticipantEvent.IsSpeakingChanged, onSpeakingChanged);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, onSpeakingChanged);
    };
  }, [participant]);

  useEffect(() => {
    const attachVideo = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      const el = videoRef.current;
      if (!el) return;

      // A muted camera shows a black frame; drop to the initials placeholder
      // instead. Applies to the first publish too (local tracks fire
      // `LocalTrackPublished`, not `TrackUnmuted`).
      const isVideo = track?.kind === Track.Kind.Video || pub?.kind === Track.Kind.Video;
      if (isVideo && pub && track && !pub.isMuted) {
        track.attach(el);
        setHasVideo(true);
      } else {
        el.srcObject = null;
        setHasVideo(false);
      }
    };

    const attachAudio = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      if (!track || track.kind !== Track.Kind.Audio) return;
      if (isLocal) return;

      const el = track.attach();
      el.style.display = "none";
      el.volume = localMutedRef.current ? 0 : localVolumeRef.current;
      audioRef.current?.appendChild(el);
      void routeElementToPlayback(el);
    };

    const refresh = () => {
      const videoPub = participant.getTrackPublication(Track.Source.Camera);
      const audioPub = participant.getTrackPublication(Track.Source.Microphone);
      setMicMuted(!participant.isMicrophoneEnabled);

      attachVideo(videoPub);
      attachAudio(audioPub);
    };

    const onTrackSubscribed = (track: { source?: Track.Source }) => {
      if (track.source === Track.Source.Camera || track.source === Track.Source.Microphone) {
        refresh();
      }
    };
    const onTrackUnsubscribed = () => refresh();
    const onLocalTrackPublished = () => refresh();
    const onTrackMuted = (pub: { source?: Track.Source }) => {
      if (pub.source === Track.Source.Camera || pub.source === Track.Source.Microphone) {
        refresh();
      }
    };
    const onTrackUnmuted = onTrackMuted;

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

      const videoPub = participant.getTrackPublication(Track.Source.Camera);
      const videoElement = videoRef.current;
      if (videoElement && videoPub?.track) {
        videoPub.track.detach(videoElement);
      }
      audioRef.current?.replaceChildren();
    };
  }, [participant, isLocal]);

  // Apply volume / mute changes live to existing audio elements
  useEffect(() => {
    const vol = localMuted ? 0 : (localVolume ?? 1);
    audioRef.current?.querySelectorAll("audio").forEach((el) => {
      (el as HTMLAudioElement).volume = vol;
    });
  }, [localVolume, localMuted]);

  const showVideo = hasVideo;
  const initials = (participant.name || participant.identity || "?").slice(0, 2).toUpperCase();

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden rounded-lg border ring-2 ring-inset ring-transparent transition-[background-color,box-shadow]",
        !avatarBg || showVideo ? "bg-muted/40" : "",
        fill ? "h-full" : "aspect-video",
        isLocal && "border-dashed",
        onClick && "cursor-pointer",
        isSpeaking && "ring-emerald-500"
      )}
      style={!showVideo && avatarBg ? { backgroundColor: avatarBg } : undefined}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn(
          "h-full w-full object-cover",
          !showVideo && "hidden",
          isLocal && hasVideo && "-scale-x-100"
        )}
      />

      {!showVideo && (
        <div className="flex size-15 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-2xl font-semibold text-foreground">
          {imageUrl ? (
            <img src={imageUrl} alt={participant.name || participant.identity} className="size-full object-cover" />
          ) : (
            initials
          )}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
        <span className="text-xs font-medium text-white drop-shadow">
          {participant.name || participant.identity}
          {isLocal ? " (You)" : ""}
        </span>
        <span className="text-xs text-white/90">
          {micMuted ? "Muted" : ""}
        </span>
      </div>

      <div ref={audioRef} className="hidden" aria-hidden />
    </div>
  );
}
