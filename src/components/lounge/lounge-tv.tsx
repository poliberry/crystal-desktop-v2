"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { RoomEvent, Track, type Room, type TrackPublication } from "livekit-client";
import { ChevronDown, ChevronUp, Maximize2, Minimize2, Power, Radio, Tv, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { routeElementToPlayback } from "@/lib/system-audio";
import { cn } from "@/lib/utils";

export interface TvChannel {
  identity: string;
  name: string;
  thumbnailUrl?: string;
}

const NOISE_TILE = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='96' height='96' filter='url(%23n)'/></svg>",
)}")`;

/** Static, for a TV with nothing on: a flicker of grain under scanlines. */
function Static({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-neutral-950">
      <div
        aria-hidden
        className="absolute -inset-[4%] opacity-[0.22]"
        style={{
          // One small tile of noise, repeated and nudged — painting a tile is
          // cheap, where a full-size gradient redrawn every frame is not.
          backgroundImage: NOISE_TILE,
          backgroundSize: "96px 96px",
          animation: "lounge-static 0.4s steps(3) infinite",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{ backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0 1px, transparent 1px 3px)" }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-white/80">
        <Tv className="size-[18%] min-h-5 min-w-5 opacity-70" />
        <p className="font-semibold [font-size:clamp(10px,1.9cqw,22px)]">{label}</p>
        {sub && <p className="text-white/55 [font-size:clamp(9px,1.2cqw,14px)]">{sub}</p>}
      </div>
    </div>
  );
}

/**
 * What is on the TV: somebody's shared screen, or static.
 *
 * Subscribing is the remote's job, not this component's — this only attaches
 * what the room has already been told to receive, so switching channel is what
 * starts one download and ends another.
 */
export function TvScreen({
  room,
  channel,
  volume,
  muted,
  liveCount,
}: {
  room: Room;
  channel: TvChannel | null;
  volume: number;
  muted: boolean;
  liveCount: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioHost = useRef<HTMLDivElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const volumeRef = useRef(muted ? 0 : volume);
  volumeRef.current = muted ? 0 : volume;
  const identity = channel?.identity ?? null;

  useEffect(() => {
    const video = videoRef.current;
    const host = audioHost.current;
    if (!identity) {
      setHasVideo(false);
      return;
    }
    const participant = room.getParticipantByIdentity(identity);
    if (!participant) {
      setHasVideo(false);
      return;
    }

    const attach = (pub: TrackPublication | undefined) => {
      const track = pub?.track;
      if (video && track && track.kind === Track.Kind.Video && !pub.isMuted) {
        track.attach(video);
        setHasVideo(true);
      } else {
        if (video) video.srcObject = null;
        setHasVideo(false);
      }
    };
    const attachAudio = () => {
      host?.replaceChildren();
      const track = participant.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
      if (!track || track.kind !== Track.Kind.Audio || !host) return;
      const el = track.attach();
      el.style.display = "none";
      el.volume = volumeRef.current;
      host.appendChild(el);
      void routeElementToPlayback(el);
    };
    const refresh = () => {
      attach(participant.getTrackPublication(Track.Source.ScreenShare));
      attachAudio();
    };
    const onSub = (track: { source?: Track.Source }) => {
      if (track.source === Track.Source.ScreenShare || track.source === Track.Source.ScreenShareAudio) refresh();
    };

    refresh();
    room.on(RoomEvent.TrackSubscribed, onSub as never);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.TrackMuted, refresh);
    room.on(RoomEvent.TrackUnmuted, refresh);
    return () => {
      room.off(RoomEvent.TrackSubscribed, onSub as never);
      room.off(RoomEvent.TrackUnsubscribed, refresh);
      room.off(RoomEvent.TrackMuted, refresh);
      room.off(RoomEvent.TrackUnmuted, refresh);
      const track = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
      if (video && track) track.detach(video);
      if (video) video.srcObject = null;
      host?.replaceChildren();
    };
  }, [room, identity]);

  // Volume follows the slider on whatever is already playing.
  useEffect(() => {
    const v = muted ? 0 : volume;
    audioHost.current?.querySelectorAll("audio").forEach((el) => {
      (el as HTMLAudioElement).volume = v;
    });
  }, [volume, muted]);

  // The channel's name flashes up in the corner when it changes, as on a real set.
  useEffect(() => {
    if (!channel) return;
    setBanner(channel.name);
    const timer = window.setTimeout(() => setBanner(null), 1800);
    return () => window.clearTimeout(timer);
  }, [channel]);

  return (
    <div className="absolute inset-0 overflow-hidden rounded-[0.3cqw] bg-black [container-type:size]">
      <video ref={videoRef} autoPlay playsInline muted className={cn("size-full object-contain", !hasVideo && "hidden")} />
      <div ref={audioHost} className="hidden" />
      {!hasVideo &&
        (channel ? (
          <Static label="Tuning in…" sub={channel.name} />
        ) : liveCount > 0 ? (
          <Static label={`${liveCount} live`} sub="Pick a channel on the remote" />
        ) : (
          <Static label="No signal" sub="Share your screen to put something on" />
        ))}
      <AnimatePresence>
        {banner && hasVideo && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-[3%] left-[2%] flex items-center gap-1 rounded-sm bg-black/40 px-[0.9cqw] py-[0.3cqw] font-mono text-emerald-300/80 [font-size:clamp(8px,1.1cqw,11px)]"
          >
            <Radio className="size-[1.1em]" /> {banner}
          </motion.div>
        )}
      </AnimatePresence>
      {/* the glass */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-transparent" />
    </div>
  );
}

/**
 * The remote: change channel, turn it down, turn it off, and lean in. Two
 * buttons with no frame of their own, to sit in a group with others.
 * A "channel" is whoever in the room is sharing their screen; choosing one
 * subscribes to that stream and drops the one before.
 */
export function LoungeRemote({
  channels,
  current,
  onTune,
  onOff,
  volume,
  onVolume,
  muted,
  onMuted,
  focused,
  onFocus,
}: {
  channels: TvChannel[];
  current: string | null;
  onTune: (identity: string) => void;
  onOff: () => void;
  volume: number;
  onVolume: (v: number) => void;
  muted: boolean;
  onMuted: (m: boolean) => void;
  focused: boolean;
  onFocus: () => void;
}) {
  const index = channels.findIndex((c) => c.identity === current);
  const step = (delta: number) => {
    if (channels.length === 0) return;
    const next = index === -1 ? (delta > 0 ? 0 : channels.length - 1) : (index + delta + channels.length) % channels.length;
    onTune(channels[next].identity);
  };
  const live = channels.length;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="relative h-8 gap-1.5 rounded-full px-3 text-white hover:bg-white/10 hover:text-white">
            <Tv className="size-4" />
            Remote
            {live > 0 && !current && (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold">
                {live}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 rounded-3xl border-white/10 bg-neutral-900/95 p-3 text-white">
          <div className="flex items-center justify-between pb-2">
            <Button size="icon" variant="ghost" className={cn("size-9 rounded-full bg-red-500/90 text-white hover:bg-red-500", !current && "opacity-50")} onClick={onOff} aria-label="Turn the TV off">
              <Power className="size-4" />
            </Button>
            <span className="font-mono text-xs text-white/60">{current ? `CH ${index + 1} / ${live}` : "OFF"}</span>
            <div className="flex flex-col rounded-full bg-white/10">
              <Button size="icon" variant="ghost" className="size-8 rounded-full text-white hover:bg-white/15" onClick={() => step(1)} disabled={live === 0} aria-label="Next channel">
                <ChevronUp className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" className="size-8 rounded-full text-white hover:bg-white/15" onClick={() => step(-1)} disabled={live === 0} aria-label="Previous channel">
                <ChevronDown className="size-4" />
              </Button>
            </div>
          </div>

          <div className="max-h-44 space-y-1 overflow-y-auto">
            {live === 0 ? (
              <p className="rounded-xl bg-white/5 p-3 text-center text-xs text-white/60">Nobody is sharing yet. Share your screen and it becomes a channel.</p>
            ) : (
              channels.map((c, i) => (
                <button
                  key={c.identity}
                  type="button"
                  onClick={() => onTune(c.identity)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors",
                    c.identity === current ? "bg-emerald-500/20 ring-1 ring-emerald-400/50" : "hover:bg-white/10",
                  )}
                >
                  <span className="w-5 text-center font-mono text-xs text-white/50">{i + 1}</span>
                  {c.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbnailUrl} alt="" className="h-8 w-14 rounded object-cover" />
                  ) : (
                    <span className="flex h-8 w-14 items-center justify-center rounded bg-white/10">
                      <Radio className="size-3.5 text-white/50" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                  {c.identity === current && <span className="size-2 animate-pulse rounded-full bg-emerald-400" />}
                </button>
              ))
            )}
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
            <button type="button" onClick={() => onMuted(!muted)} className="text-white/80 hover:text-white" aria-label={muted ? "Unmute the TV" : "Mute the TV"}>
              {muted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <Slider min={0} max={100} step={1} value={[muted ? 0 : Math.round(volume * 100)]} onValueChange={([v]) => { onVolume(v / 100); if (muted && v > 0) onMuted(false); }} />
            <span className="w-8 text-right font-mono text-xs text-white/60">{muted ? 0 : Math.round(volume * 100)}</span>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="sm"
        onClick={onFocus}
        className="h-8 gap-1.5 rounded-full px-3 text-white hover:bg-white/10 hover:text-white"
      >
        {focused ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        {focused ? "Back to room" : "Focus TV"}
      </Button>
    </>
  );
}
