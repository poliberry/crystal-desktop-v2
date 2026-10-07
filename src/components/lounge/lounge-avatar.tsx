"use client";

import { useEffect, useRef, useState } from "react";
import { ParticipantEvent, Track, type Participant } from "livekit-client";
import { MicOff, VolumeX } from "lucide-react";

import { AvatarEffects, Megaphones, type LoungeEvent } from "@/components/lounge/lounge-effects";
import { Avatar, AvatarDecoration, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Whether somebody is talking, live. */
export function useIsSpeaking(participant: Participant): boolean {
  const [speaking, setSpeaking] = useState(participant.isSpeaking);
  useEffect(() => {
    setSpeaking(participant.isSpeaking);
    const on = (value: boolean) => setSpeaking(value);
    participant.on(ParticipantEvent.IsSpeakingChanged, on);
    return () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, on);
    };
  }, [participant]);
  return speaking;
}

/** Whether somebody's camera is on, and a video element showing it. */
function useCamera(participant: Participant) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    const refresh = () => {
      const pub = participant.getTrackPublication(Track.Source.Camera);
      const track = pub?.track;
      if (el && track && !pub.isMuted && track.kind === Track.Kind.Video) {
        track.attach(el);
        setOn(true);
      } else {
        if (el) el.srcObject = null;
        setOn(false);
      }
    };
    refresh();
    participant
      .on(ParticipantEvent.TrackSubscribed, refresh)
      .on(ParticipantEvent.TrackUnsubscribed, refresh)
      .on(ParticipantEvent.TrackMuted, refresh)
      .on(ParticipantEvent.TrackUnmuted, refresh)
      .on(ParticipantEvent.LocalTrackPublished, refresh)
      .on(ParticipantEvent.LocalTrackUnpublished, refresh);
    return () => {
      participant
        .off(ParticipantEvent.TrackSubscribed, refresh)
        .off(ParticipantEvent.TrackUnsubscribed, refresh)
        .off(ParticipantEvent.TrackMuted, refresh)
        .off(ParticipantEvent.TrackUnmuted, refresh)
        .off(ParticipantEvent.LocalTrackPublished, refresh)
        .off(ParticipantEvent.LocalTrackUnpublished, refresh);
      const track = participant.getTrackPublication(Track.Source.Camera)?.track;
      if (el && track) track.detach(el);
    };
  }, [participant]);

  return { videoRef, on };
}

export interface LoungeAvatarProps {
  participant: Participant;
  isLocal: boolean;
  name: string;
  imageUrl?: string;
  decoration?: string;
  /** Where they are, in percent of the scene. */
  x: number;
  y: number;
  /** 0 at the back wall, 1 at the front edge — what makes people nearer look bigger. */
  depth: number;
  muted: boolean;
  deafened: boolean;
  typing: boolean;
  walking: boolean;
  sitting: boolean;
  /** Talking, or a clip is playing. */
  soundboard: boolean;
  chattedRecently: boolean;
  events: LoungeEvent[];
  onClick?: () => void;
}

/**
 * One person in the room.
 *
 * Their avatar — or their camera, while it is on — bobs while they talk or type
 * (which is the whole of the "speaking" indicator: no ring, the bob says it),
 * hops while they walk and breathes while they sit. Muted, it is dimmed and
 * drained of colour; deafened, the same but red. The size and the stacking are
 * both set by how far forward they are standing, which is what makes a flat
 * picture read as a room.
 */
export function LoungeAvatar({
  participant,
  isLocal,
  name,
  imageUrl,
  decoration,
  x,
  y,
  depth,
  muted,
  deafened,
  typing,
  walking,
  sitting,
  soundboard,
  chattedRecently,
  events,
  onClick,
}: LoungeAvatarProps) {
  const speaking = useIsSpeaking(participant);
  const { videoRef, on: cameraOn } = useCamera(participant);

  // A person in a room, not a face on a wall: about a twentieth of its width.
  const size = 3.3 + depth * 1.5;
  const talking = (speaking && !muted) || typing || chattedRecently;
  const motionClass = walking ? "lounge-walk" : talking ? "lounge-bob" : sitting ? "lounge-breathe" : "";
  const dim = muted || deafened;

  return (
    <div
      className="absolute"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}cqw`,
        // Feet on the spot, not the middle of the picture.
        transform: "translate(-50%, -88%)",
        zIndex: Math.round(y * 10) + (sitting ? 5 : 0),
        // The local avatar moves every frame; everyone else's packets arrive ten
        // times a second, and a short glide fills in between them.
        transition: isLocal ? "none" : "left 140ms linear, top 140ms linear, width 200ms ease",
      }}
    >
      <div className="relative aspect-square w-full" onClick={onClick}>
        <AvatarEffects events={events} />
        <Megaphones active={soundboard} />

        <div className={cn("size-full", motionClass)}>
          <div
            className={cn(
              "relative size-full transition-[filter,opacity] duration-300",
              dim && "opacity-55 grayscale",
            )}
          >
            <Avatar className="size-full overflow-visible rounded-[24%] shadow-lg shadow-black/40">
              <AvatarImage src={imageUrl} alt="" className={cn("rounded-[24%]", cameraOn && "invisible")} />
              <AvatarFallback className={cn("rounded-[24%] text-[1.6cqw]", cameraOn && "invisible")}>
                {name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
              {!cameraOn && decoration && <AvatarDecoration value={decoration} animate="hover" />}
            </Avatar>
            {/* Their camera takes the avatar's place. */}
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                "absolute inset-0 size-full rounded-[24%] object-cover shadow-lg shadow-black/40",
                !cameraOn && "hidden",
                isLocal && "-scale-x-100",
              )}
            />
            {deafened && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[24%] bg-red-600/55 mix-blend-multiply"
              />
            )}
          </div>

          {(muted || deafened) && (
            <span
              className={cn(
                "absolute -right-[10%] -bottom-[10%] flex size-[38%] items-center justify-center rounded-full border border-black/30 text-white shadow",
                deafened ? "bg-red-600" : "bg-neutral-700",
              )}
            >
              {deafened ? <VolumeX className="size-[62%]" /> : <MicOff className="size-[62%]" />}
            </span>
          )}

          {typing && (
            <span className="absolute -top-[2%] left-1/2 flex -translate-x-1/2 -translate-y-full gap-[0.35cqw] rounded-full bg-neutral-900/80 px-[1cqw] py-[0.6cqw]">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-[0.4cqw] min-h-[3px] min-w-[3px] animate-bounce rounded-full bg-white/90"
                  style={{ animationDelay: `${i * 0.14}s` }}
                />
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="pointer-events-none mt-[2%] flex justify-center">
        <span className="max-w-[12cqw] truncate rounded-full bg-black/55 px-[0.6cqw] py-[0.1cqw] text-center text-white [font-size:clamp(8px,0.78cqw,11px)]">
          {isLocal ? `${name} (you)` : name}
        </span>
      </div>
    </div>
  );
}
