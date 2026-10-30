"use client";

import { useMutation, useQuery } from "convex/react";
import { Clapperboard, Crown, Loader2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useAudioPreferences } from "@/components/audio-provider";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  clockSkewMs,
  expectedPositionMs,
  formatPosition,
  needsSeek,
} from "../../../convex/lib/watchTogether";
import { createDirectPlayer, createYouTubePlayer, type WatchPlayer } from "@/lib/watch-player";
import { cn } from "@/lib/utils";

/** How often a follower checks itself against the clock. */
const FOLLOW_INTERVAL_MS = 1000;
/** Fewer than this between two things the host did and the second one waits, so a scrub isn't a flood of writes. */
const EMIT_GAP_MS = 250;
/** How long a follower waits for playback to start before asking for a click (browsers block unmuted autoplay). */
const AUTOPLAY_GRACE_MS = 2500;

type Activity = NonNullable<ReturnType<typeof useActivity>>;

function useActivity(channelId: Id<"channels">) {
  return useQuery(api.voiceActivities.current, { channelId });
}

/**
 * "Watch together": the voice channel's shared video, shown above the call while one is running.
 *
 * The state is a small clock on the server (convex/voiceActivities.ts). The host's player is the source of
 * truth — whatever they play, pause or scrub is written to the clock — and everyone else's player follows it,
 * correcting itself when it drifts more than a second and a half. Each person's player loads the video
 * itself; the server never touches it. A member without Use Activities is told one is running and gets
 * nothing else: no link, and no way to join.
 */
export function WatchTogether({ channelId }: { channelId: Id<"channels"> }) {
  const activity = useActivity(channelId);
  const stop = useMutation(api.voiceActivities.stop);
  const takeHost = useMutation(api.voiceActivities.takeHost);
  const [collapsed, setCollapsed] = useState(false);

  if (!activity) return null;

  const title = activity.title ?? (activity.allowed && activity.provider === "youtube" ? "YouTube" : "A video");
  const header = (
    <div className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2 text-sm">
      <Clapperboard className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate font-medium">Watch together</span>
      <span className="truncate text-xs text-muted-foreground">
        {title} · hosted by {activity.hostName}
      </span>
      <div className="ml-auto flex items-center gap-1">
        {activity.allowed && !activity.isHost && activity.canControl && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void takeHost({ channelId }).catch(() => {})}>
            <Crown className="size-3.5" /> Take over
          </Button>
        )}
        {activity.allowed && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? "Show" : "Hide"}
          </Button>
        )}
        {activity.allowed && activity.canControl && (
          <Button variant="ghost" size="icon" className="size-7" aria-label="End activity" onClick={() => void stop({ channelId }).catch(() => {})}>
            <X className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] shadow-lg shadow-black/20">
      {header}
      {!activity.allowed ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          An activity is running in this channel. You don&apos;t have permission to use activities here, so you can&apos;t watch along.
        </p>
      ) : (
        // Hidden rather than unmounted, so hiding it doesn't lose your place or the player.
        <div className={cn(collapsed && "hidden")}>
          <Player channelId={channelId} activity={activity} />
        </div>
      )}
    </div>
  );
}

function Player({ channelId, activity }: { channelId: Id<"channels">; activity: Extract<Activity, { allowed: true }> }) {
  const control = useMutation(api.voiceActivities.controlWatch);
  const { deafened } = useAudioPreferences();
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<WatchPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [needsClick, setNeedsClick] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [position, setPosition] = useState(0);

  const { isHost, provider, source } = activity;
  const latest = useRef(activity);
  latest.current = activity;

  // The offset between this device's clock and the server's, from the last time the server told us the time.
  const skewRef = useRef(0);
  useEffect(() => {
    skewRef.current = clockSkewMs(Date.now(), activity.serverNow);
  }, [activity.serverNow, activity.version]);
  const serverTime = useCallback(() => Date.now() - skewRef.current, []);

  // --- The host's side: what they do to their player becomes the clock. ---
  const lastEmit = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const emit = useCallback(
    (action: "play" | "pause" | "seek") => {
      const send = () => {
        const player = playerRef.current;
        if (!player) return;
        lastEmit.current = Date.now();
        void control({ channelId, action, positionMs: Math.round(player.position()) }).catch(() => {});
      };
      clearTimeout(pending.current);
      const wait = EMIT_GAP_MS - (Date.now() - lastEmit.current);
      if (wait <= 0) send();
      else pending.current = setTimeout(send, wait);
    },
    [channelId, control],
  );
  // A change we made to the player ourselves (following the clock) raises the same events as a person using it; those are not the host's doing.
  const quietUntil = useRef(0);
  const quiet = () => Date.now() < quietUntil.current;
  const hush = () => {
    quietUntil.current = Date.now() + 1200;
  };

  // --- Build the player. A new one when the video or the role changes (the host gets controls). ---
  useEffect(() => {
    setReady(false);
    setFailed(null);
    let cancelled = false;
    const startMs = expectedPositionMs(
      { playing: latest.current.playing, positionMs: latest.current.positionMs, updatedAt: latest.current.updatedAt },
      serverTime(),
    );
    const events = {
      onReady: () => {
        if (!cancelled) setReady(true);
      },
      onUserPlay: () => {
        if (isHost && !quiet()) emit("play");
      },
      onUserPause: () => {
        if (isHost && !quiet()) emit("pause");
      },
      onUserSeek: () => {
        if (isHost && !quiet()) emit("seek");
      },
      onEnded: () => {
        if (isHost && !quiet()) emit("pause");
      },
    };

    hush();
    if (provider === "youtube") {
      const host = stageRef.current;
      if (!host) return;
      createYouTubePlayer(host, source, { controls: isHost, startMs }, events)
        .then((player) => {
          if (cancelled) player.destroy();
          else playerRef.current = player;
        })
        .catch((err: unknown) => !cancelled && setFailed(err instanceof Error ? err.message : "The player couldn't load."));
    } else {
      const el = videoRef.current;
      if (!el) return;
      el.src = source;
      el.currentTime = startMs / 1000;
      playerRef.current = createDirectPlayer(el, events);
    }
    return () => {
      cancelled = true;
      clearTimeout(pending.current);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // The host's own events must see the current role, so a role change rebuilds the player.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, source, isHost]);

  // --- A follower's side: steer the player to the clock. ---
  const follow = useCallback(() => {
    const player = playerRef.current;
    const a = latest.current;
    if (!player || a.isHost) return;
    const want = expectedPositionMs(
      { playing: a.playing, positionMs: a.positionMs, updatedAt: a.updatedAt },
      serverTime(),
      player.duration(),
    );
    hush();
    if (a.playing) {
      if (!player.isPlaying()) player.play();
      if (needsSeek(want, player.position())) player.seek(want);
    } else {
      if (player.isPlaying()) player.pause();
      if (needsSeek(want, player.position(), 400)) player.seek(want);
    }
  }, [serverTime]);

  useEffect(() => {
    if (!ready) return;
    follow();
    const timer = setInterval(follow, FOLLOW_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [ready, follow, activity.version, activity.playing]);

  // Browsers won't start unmuted playback until the page has been interacted with in the player's own frame.
  useEffect(() => {
    if (!ready || isHost || !activity.playing) {
      setNeedsClick(false);
      return;
    }
    const timer = setTimeout(() => {
      if (!playerRef.current?.isPlaying()) setNeedsClick(true);
    }, AUTOPLAY_GRACE_MS);
    return () => clearTimeout(timer);
  }, [ready, isHost, activity.playing, activity.version]);

  // Deafened means silent, here as everywhere.
  useEffect(() => {
    if (!ready) return;
    playerRef.current?.setMuted(muted || deafened);
    playerRef.current?.setVolume(volume);
  }, [ready, muted, deafened, volume]);

  // A readout of where the video is.
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => setPosition(playerRef.current?.position() ?? 0), 500);
    return () => clearInterval(timer);
  }, [ready]);

  const hostToggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying()) player.pause();
    else player.play();
  };

  return (
    <div className="flex flex-col">
      <div className="relative aspect-video max-h-[42vh] w-full bg-black">
        {provider === "youtube" ? (
          <div ref={stageRef} className={cn("absolute inset-0 [&>iframe]:h-full [&>iframe]:w-full", !isHost && "pointer-events-none")} />
        ) : (
          <video
            ref={videoRef}
            playsInline
            controls={isHost}
            className={cn("absolute inset-0 h-full w-full object-contain", !isHost && "pointer-events-none")}
          />
        )}
        {!ready && !failed && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <Loader2 className="size-5 animate-spin" />
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white/80">{failed}</div>
        )}
        {needsClick && !failed && (
          <button
            type="button"
            className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-medium text-white"
            onClick={() => {
              setNeedsClick(false);
              follow();
              playerRef.current?.play();
            }}
          >
            <span className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 backdrop-blur">
              <Play className="size-4" /> Click to join the video
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        {isHost ? (
          <Button variant="ghost" size="icon" className="size-7" aria-label={activity.playing ? "Pause for everyone" : "Play for everyone"} onClick={hostToggle}>
            {activity.playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
        ) : null}
        <span className="tabular-nums">{formatPosition(position)}</span>
        <span className="truncate">
          {isHost ? "You control playback for everyone." : `${activity.hostName} controls playback — you follow along.`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-7" aria-label={muted ? "Unmute video" : "Mute video"} onClick={() => setMuted((m) => !m)}>
            {muted || deafened ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </Button>
          <Slider className="w-24" value={[Math.round(volume * 100)]} min={0} max={100} step={5} onValueChange={([v]) => setVolume((v ?? 0) / 100)} />
        </div>
      </div>
    </div>
  );
}
