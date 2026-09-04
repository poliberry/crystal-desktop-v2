"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { HeadphoneOff, MicOff } from "lucide-react";
import {
  ParticipantEvent,
  RoomEvent,
  Track,
  type Participant,
  type TrackPublication,
} from "livekit-client";

import {
  Avatar,
  AvatarDecoration,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { useAvatarAccent } from "@/hooks/use-avatar-accent";
import { routeElementToPlayback } from "@/lib/system-audio";
import { cn } from "@/lib/utils";

interface ParticipantTileProps {
  participant: Participant;
  isLocal?: boolean;
  imageUrl?: string;
  /** Display name resolved against the community this call belongs to (see
   * `RoomView`). Falls back to whatever name the LiveKit token carried. */
  name?: string;
  /** Cached dominant colour of `imageUrl`. Sampled locally when absent. */
  accent?: string;
  /** The profile border gradient this call's community sees — a server
   * profile's pair wins over the global one (see `getUsersByIds`). Painted as
   * the tile's backdrop behind the avatar; with either end missing the tile
   * falls back to the avatar's accent tint above. */
  gradientStart?: string;
  gradientEnd?: string;
  /** The decoration worn around the avatar, resolved the same way the name
   * and gradient are (see `getUsersByIds`). Drawn only when there's no video
   * — a camera covers the avatar it would be worn on. */
  avatarDecoration?: string;
  /** How large the avatar placeholder is drawn. `"sm"` is the expanded view's
   * size — used by the focused tile and the thumbnail rail beside it, where
   * the tile is either far bigger than the avatar needs to be or too small to
   * hold the full-size one. */
  avatarSize?: "default" | "sm";
  /** Fill the parent's box exactly (grid/focused view) instead of the
   * default fixed 16:9 card (bottom rail thumbnails). */
  fill?: boolean;
  onClick?: () => void;
  localVolume?: number;
  localMuted?: boolean;
  /** Highlights the tile while this participant is playing a soundboard clip
   * — the speaking ring's sibling, in a different colour. */
  soundboardActive?: boolean;
}

/**
 * Renders a participant's camera / screen-share video and wires up audio
 * playback. When the app is sharing system audio, every audio element is
 * additionally routed to the hardware sink (Linux) so the app never
 * accidentally re-captures itself.
 */
export function ParticipantTile({
  participant,
  isLocal = false,
  imageUrl,
  name,
  accent,
  gradientStart,
  gradientEnd,
  avatarDecoration,
  avatarSize = "default",
  fill = false,
  onClick,
  localVolume,
  localMuted,
  soundboardActive = false,
}: ParticipantTileProps) {
  const displayName = name || participant.name || participant.identity;
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [micMuted, setMicMuted] = useState(true);
  // Mirrored from the participant's own attributes — see `useRoom`, which
  // publishes it whenever the local deafen state changes.
  const [deafened, setDeafened] = useState(
    participant.attributes?.deafened === "1",
  );
  const [isSpeaking, setIsSpeaking] = useState(participant.isSpeaking);
  const avatarBg = useAvatarAccent(imageUrl, accent);

  // Keep refs fresh for use inside audio-attachment closure
  const localVolumeRef = useRef(localVolume ?? 1);
  const localMutedRef = useRef(!!localMuted);
  localVolumeRef.current = localVolume ?? 1;
  localMutedRef.current = !!localMuted;

  useEffect(() => {
    setIsSpeaking(participant.isSpeaking);
    const onSpeakingChanged = (speaking: boolean) => setIsSpeaking(speaking);
    participant.on(ParticipantEvent.IsSpeakingChanged, onSpeakingChanged);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, onSpeakingChanged);
    };
  }, [participant]);

  useEffect(() => {
    const sync = () => setDeafened(participant.attributes?.deafened === "1");
    sync();
    participant.on(ParticipantEvent.AttributesChanged, sync);
    return () => {
      participant.off(ParticipantEvent.AttributesChanged, sync);
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
      const isVideo =
        track?.kind === Track.Kind.Video || pub?.kind === Track.Kind.Video;
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
      if (
        track.source === Track.Source.Camera ||
        track.source === Track.Source.Microphone
      ) {
        refresh();
      }
    };
    const onTrackUnsubscribed = () => refresh();
    const onLocalTrackPublished = () => refresh();
    const onTrackMuted = (pub: { source?: Track.Source }) => {
      if (
        pub.source === Track.Source.Camera ||
        pub.source === Track.Source.Microphone
      ) {
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
  const initials = (displayName || "?").slice(0, 2).toUpperCase();

  // The profile gradient takes the place of the avatar's sampled tint when
  // there's one to draw. Both ends are needed — half a gradient is just a
  // colour, and not the one the user chose.
  const gradient =
    gradientStart && gradientEnd
      ? `linear-gradient(to bottom, ${gradientStart}, ${gradientEnd})`
      : undefined;
  const backdrop: CSSProperties | undefined = showVideo
    ? undefined
    : gradient
      ? { backgroundImage: gradient }
      : avatarBg
        ? { backgroundColor: avatarBg }
        : undefined;

  return (
    <div
      onClick={onClick}
      className={cn(
        "relative flex w-full items-center justify-center overflow-hidden rounded-lg ring-2 ring-inset ring-transparent transition-[background-color,box-shadow]",
        backdrop ? "" : "bg-muted/40",
        fill ? "h-full" : "aspect-video",
        onClick && "cursor-pointer",
        // Soundboard wins the ring while it's active: it's the more
        // momentary of the two, so it reads as an event rather than a state.
        soundboardActive ? "ring-sky-500" : isSpeaking && "ring-emerald-500",
      )}
      style={backdrop}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={cn(
          "h-full w-full object-cover",
          !showVideo && "hidden",
          isLocal && hasVideo && "-scale-x-100",
        )}
      />

      {!showVideo && (
        <Avatar className={avatarSize === "sm" ? "size-15 rounded-md" : "size-25 rounded-xl"}>
          <AvatarImage src={imageUrl} alt={displayName} className="rounded-xl" />
          <AvatarFallback className="bg-primary/30 text-2xl font-semibold text-foreground">
            {initials}
          </AvatarFallback>
          {/* Placed in container units against the avatar it's worn on, so
              one decoration fits both sizes above — see AvatarDecoration. */}
          <AvatarDecoration value={avatarDecoration} />
        </Avatar>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between w-fit bg-background/80 rounded-md gap-2 m-1 px-2 py-1.5">
        {deafened ||
          (micMuted && (
            <span className="flex shrink-0 items-center gap-1 text-white/90">
              {deafened && (
                <HeadphoneOff className="size-3.5" aria-label="Deafened" />
              )}
              {micMuted && <MicOff className="size-3.5" aria-label="Muted" />}
            </span>
          ))}
        <span className="text-xs font-medium text-white drop-shadow">
          {displayName}
        </span>
        {/* Status is shown as glyphs rather than words so it reads the same
            at thumbnail size and needs no translation. */}
      </div>

      <div ref={audioRef} className="hidden" aria-hidden />
    </div>
  );
}
