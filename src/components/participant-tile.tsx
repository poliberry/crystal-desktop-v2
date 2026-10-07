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
import { SoundboardBurst } from "@/components/call/soundboard-burst";
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
      ? {
          backgroundImage: gradient,
          // Painted across the border box and not repeated. By default a
          // background is sized to the area *inside* the border and tiles
          // underneath it, so the translucent border at the bottom edge showed
          // the top of the gradient — a thin line in the wrong colour.
          backgroundOrigin: "border-box",
          backgroundRepeat: "no-repeat",
        }
      : avatarBg
        ? { backgroundColor: avatarBg }
        : undefined;

  return (
    <div
      onClick={onClick}
      className={cn(
        // The glass card's edge and shadow, so a tile belongs with the control
        // bar and the sidebar cards; the ring stays the speaking indicator.
        "relative flex w-full items-center justify-center overflow-hidden [container-type:size] rounded-2xl border border-[color:var(--glass-border)] shadow-lg shadow-black/25 ring-2 ring-inset ring-transparent transition-[background-color,box-shadow]",
        backdrop ? "" : "bg-[color:var(--glass-bg)]",
        fill ? "h-full" : "aspect-video",
        onClick && "cursor-pointer",
        // Soundboard wins the ring while it's active: it's the more
        // momentary of the two, so it reads as an event rather than a state.
        soundboardActive ? "ring-sky-500" : isSpeaking && "ring-emerald-500",
      )}
      style={backdrop}
    >
      {/* The glass card's raking light, over the backdrop (an avatar tint or a
          profile gradient) and under the avatar. Not over a camera feed. */}
      {!showVideo && (
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[image:var(--glass-glow)]" />
      )}

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

      {/* Sized from the tile it is in, by its shorter side: about the 100px
            it used to be on an ordinary grid tile, a good deal more on a focused
            one (up to 12rem), and the 60px floor in the strip beneath it.
            One rule instead of a size per layout, which is how the focused tile
            came to have a smaller avatar than the grid. */}
      {!showVideo && (
        <Avatar
          style={{
            width: "clamp(3.75rem, 55cqmin, 12rem)",
            height: "clamp(3.75rem, 55cqmin, 12rem)",
          }}
          className="rounded-[22%]"
        >
          <AvatarImage src={imageUrl} alt={displayName} className="rounded-[22%]" />
          <AvatarFallback className="bg-primary/30 text-[length:clamp(1.25rem,18cqmin,4rem)] font-semibold text-foreground">
            {initials}
          </AvatarFallback>
          {/* Placed in container units against the avatar it's worn on, so
              one decoration fits at any size — see AvatarDecoration. */}
          <AvatarDecoration value={avatarDecoration} />
        </Avatar>
      )}

      {/* Every soundboard press, as its emoji falling across the presser's
          tile — for everyone, since each client draws it from the same packet. */}
      <SoundboardBurst identity={participant.identity} />

      <div className="absolute inset-x-0 bottom-0 z-20 m-2 flex w-fit items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 backdrop-blur-md">
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
