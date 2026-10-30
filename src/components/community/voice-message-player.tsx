"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { formatVoiceTime, nextVoiceSpeed, seekFraction } from "./voice-format";

/** The audio element that is playing right now. Starting another voice message pauses it. */
let currentlyPlaying: HTMLAudioElement | null = null;

/** Arrow keys move the position by this much of the message, in seconds. */
const KEY_SEEK_SECONDS = 5;

/**
 * A voice message as it appears in chat: play button, waveform you can click or drag to seek,
 * the time, and a speed toggle. `durationMs` comes from the server and is what's shown until the
 * audio element knows better, because a recorded webm file often reports an infinite length.
 */
export function VoiceMessagePlayer({
  url,
  durationMs,
  waveform,
  className,
}: {
  url: string;
  durationMs: number;
  waveform: number[];
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const barsRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0); // seconds
  const [knownDuration, setKnownDuration] = useState<number | null>(null); // seconds, only once finite
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  // While dragging, the bars follow the pointer instead of the element, or timeupdate would tug them back.
  const [dragging, setDragging] = useState(false);

  const total = knownDuration ?? Math.max(0, durationMs) / 1000;
  const shownPosition = Math.min(position, total || position);
  const progress = total > 0 ? Math.min(1, shownPosition / total) : 0;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onMeta = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setKnownDuration(audio.duration);
    };
    const onTime = () => {
      // Recorded webm only learns its real length while playing, so keep checking until it is finite.
      setPosition(audio.currentTime);
      onMeta();
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
      if (currentlyPlaying === audio) currentlyPlaying = null;
    };
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      // A message scrolled out of the list or deleted shouldn't keep talking.
      audio.pause();
      if (currentlyPlaying === audio) currentlyPlaying = null;
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    setError(null);
    if (currentlyPlaying && currentlyPlaying !== audio) currentlyPlaying.pause();
    currentlyPlaying = audio;
    audio.playbackRate = speed;
    void audio.play().catch(() => {
      if (currentlyPlaying === audio) currentlyPlaying = null;
      setError("Couldn't play this voice message.");
    });
  };

  const seekTo = useCallback(
    (fraction: number) => {
      const audio = audioRef.current;
      if (!audio || total <= 0) return;
      const seconds = fraction * total;
      try {
        audio.currentTime = seconds;
      } catch {
        /* not seekable until the file has loaded */
      }
      setPosition(seconds);
    },
    [total]
  );

  const seekFromPointer = (clientX: number) => {
    const rect = barsRef.current?.getBoundingClientRect();
    if (!rect) return;
    seekTo(seekFraction(clientX, rect.left, rect.width));
  };

  const cycleSpeed = () => {
    const next = nextVoiceSpeed(speed);
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (total <= 0) return;
    let target: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") target = shownPosition + KEY_SEEK_SECONDS;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") target = shownPosition - KEY_SEEK_SECONDS;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = total;
    if (target === null) return;
    e.preventDefault();
    seekTo(Math.min(1, Math.max(0, target / total)));
  };

  const bars = waveform.length > 0 ? waveform : new Array<number>(64).fill(0);

  return (
    <div className={cn("mt-1 flex w-full max-w-[18rem] flex-col gap-1 rounded-2xl border bg-muted/30 px-2.5 py-2", className)}>
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          className="size-8 shrink-0 rounded-full"
          onClick={toggle}
          aria-label={playing ? "Pause voice message" : "Play voice message"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>

        <div
          ref={barsRef}
          role="slider"
          tabIndex={0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(shownPosition)}
          aria-valuetext={`${formatVoiceTime(shownPosition * 1000)} of ${formatVoiceTime(total * 1000)}`}
          className="flex h-8 min-w-0 flex-1 cursor-pointer touch-none select-none items-center gap-[2px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (dragging) seekFromPointer(e.clientX);
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setDragging(false);
          }}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={onKeyDown}
        >
          {bars.map((v, i) => (
            <span
              key={i}
              className={cn("min-h-[3px] flex-1 rounded-full", i / bars.length < progress ? "bg-primary" : "bg-muted-foreground/40")}
              style={{ height: `${Math.max(10, (Math.min(255, Math.max(0, v)) / 255) * 100)}%` }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pl-10 text-[11px] tabular-nums text-muted-foreground">
        <span>
          {formatVoiceTime(playing || shownPosition > 0 ? shownPosition * 1000 : total * 1000)}
          {(playing || shownPosition > 0) && ` / ${formatVoiceTime(total * 1000)}`}
        </span>
        <button
          type="button"
          onClick={cycleSpeed}
          aria-label={`Playback speed ${speed}x, change`}
          className="rounded-full px-1.5 py-0.5 font-medium hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          {speed}x
        </button>
      </div>

      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
