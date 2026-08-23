"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { computePeaks, formatClipLength, MAX_CLIP_MS } from "@/lib/audio-clip";
import { cn } from "@/lib/utils";

/** Waveform resolution. One bar every ~3px at the dialog's width — fine enough
 * to show the shape of a clip, coarse enough that a 30-second file doesn't
 * become a solid block. */
const BARS = 140;

/** Grab radius for a handle, in pixels either side of it. Wider than the
 * handle is drawn: a 3px target is not something you can reliably hit. */
const HANDLE_GRAB_PX = 10;

/** Refuse to let the two handles cross, or meet. */
const MIN_SELECTION_S = 0.1;

type DragKind = "start" | "end" | "seek";

export interface TrimRange {
  startSec: number;
  endSec: number;
}

/**
 * The waveform scrubber: pick the part of a sound you actually want.
 *
 * Built rather than pulled in because what this needs — two draggable trim
 * handles, a playhead confined to the selection, and a preview that plays only
 * the selected range — is the specific thing, and a general-purpose waveform
 * library would be most of a megabyte to get it.
 *
 * The waveform is drawn to a canvas rather than as a few hundred DOM nodes: at
 * this bar count React would spend more time diffing bars than the canvas
 * spends painting them, and the peaks only change when a new file is picked.
 */
export function WaveformTrimmer({
  buffer,
  value,
  onChange,
  gain = 1,
  className,
}: {
  /** Decoded audio. `null` while a file is still being read. */
  buffer: AudioBuffer | null;
  value: TrimRange;
  onChange: (range: TrimRange) => void;
  /** Preview gain, so what you hear is what gets uploaded. */
  gain?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);
  // Read inside `play` rather than closed over, so changing the volume slider
  // doesn't re-create the callback and restart a preview mid-play.
  const gainRef = useRef(1);
  gainRef.current = gain;
  const dragRef = useRef<DragKind | null>(null);
  const rafRef = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [hovering, setHovering] = useState<DragKind | null>(null);

  const duration = buffer?.duration ?? 0;
  const peaks = useMemo(() => (buffer ? computePeaks(buffer, BARS) : null), [buffer]);

  const stop = useCallback(() => {
    const active = audioRef.current;
    audioRef.current = null;
    if (active) {
      // The `onended` handler is what sets `playing` false; clearing it first
      // stops a manual stop from racing the natural end of the clip.
      active.source.onended = null;
      try {
        active.source.stop();
      } catch {
        // Already stopped — nothing to undo.
      }
      void active.context.close().catch(() => {});
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setPlaying(false);
    setPlayhead(null);
  }, []);

  // Leaving the dialog mid-preview must not leave a clip playing into a room
  // that can no longer stop it.
  useEffect(() => stop, [stop]);

  // A new file invalidates whatever was playing from the old one.
  useEffect(() => {
    stop();
  }, [buffer, stop]);

  const play = useCallback(() => {
    if (!buffer) return;
    stop();

    const context = new AudioContext();
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gainNode = context.createGain();
    gainNode.gain.value = gainRef.current;
    source.connect(gainNode).connect(context.destination);

    const { startSec, endSec } = value;
    const length = Math.max(0, endSec - startSec);
    if (length <= 0) return;

    const startedAt = context.currentTime;
    source.start(0, startSec, length);
    audioRef.current = { context, source };
    setPlaying(true);

    source.onended = () => {
      if (audioRef.current?.source === source) stop();
    };

    // `AudioBufferSourceNode` has no position to read, so the playhead is
    // derived from how long the context has been running — which is the same
    // clock the audio is scheduled against, so the two can't drift.
    const tick = () => {
      const active = audioRef.current;
      if (!active) return;
      setPlayhead(startSec + (active.context.currentTime - startedAt));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [buffer, stop, value]);

  // --- painting -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const barWidth = width / peaks.length;
    const middle = height / 2;
    const selectionStart = duration ? (value.startSec / duration) * width : 0;
    const selectionEnd = duration ? (value.endSec / duration) * width : width;

    for (const [index, [min, max]] of peaks.entries()) {
      const x = index * barWidth;
      // Outside the selection the bar is dimmed rather than hidden — the shape
      // of what you're cutting away is the context that makes the cut make
      // sense.
      const inside = x + barWidth / 2 >= selectionStart && x + barWidth / 2 <= selectionEnd;
      ctx.fillStyle = inside ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.22)";
      // A silent stretch would otherwise draw nothing at all and read as a
      // gap in the file rather than as quiet.
      const top = middle - Math.max(0.5, max * middle * 0.94);
      const bottom = middle + Math.max(0.5, -min * middle * 0.94);
      ctx.fillRect(x, top, Math.max(1, barWidth - 1), bottom - top);
    }
  }, [peaks, duration, value.startSec, value.endSec]);

  // --- dragging -------------------------------------------------------------
  const secondsAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || !duration) return 0;
      const rect = track.getBoundingClientRect();
      const fraction = (clientX - rect.left) / rect.width;
      return Math.max(0, Math.min(duration, fraction * duration));
    },
    [duration]
  );

  const kindAt = useCallback(
    (clientX: number): DragKind => {
      const track = trackRef.current;
      if (!track || !duration) return "seek";
      const rect = track.getBoundingClientRect();
      const x = clientX - rect.left;
      const startX = (value.startSec / duration) * rect.width;
      const endX = (value.endSec / duration) * rect.width;
      if (Math.abs(x - startX) <= HANDLE_GRAB_PX) return "start";
      if (Math.abs(x - endX) <= HANDLE_GRAB_PX) return "end";
      return "seek";
    },
    [duration, value.startSec, value.endSec]
  );

  /** The selection ceiling, in seconds — the soundboard's own clip limit. */
  const maxSelection = MAX_CLIP_MS / 1000;

  const applyDrag = useCallback(
    (kind: DragKind, seconds: number) => {
      if (kind === "start") {
        const startSec = Math.min(seconds, value.endSec - MIN_SELECTION_S);
        // Dragging the start past the window pushes the end along rather than
        // silently refusing to move — the selection stays the same length.
        const endSec = Math.min(duration, Math.max(value.endSec, startSec + MIN_SELECTION_S));
        onChange({
          startSec: Math.max(0, startSec),
          endSec: Math.min(endSec, startSec + maxSelection),
        });
        return;
      }
      if (kind === "end") {
        const endSec = Math.max(seconds, value.startSec + MIN_SELECTION_S);
        onChange({
          startSec: Math.max(value.startSec, endSec - maxSelection),
          endSec: Math.min(duration, endSec),
        });
        return;
      }
      // A click on the body of the waveform moves the whole selection there,
      // keeping its length — the common gesture once the length is right.
      const length = value.endSec - value.startSec;
      const startSec = Math.max(0, Math.min(duration - length, seconds - length / 2));
      onChange({ startSec, endSec: startSec + length });
    },
    [duration, maxSelection, onChange, value.endSec, value.startSec]
  );

  const onPointerDown = (event: React.PointerEvent) => {
    if (!duration) return;
    const kind = kindAt(event.clientX);
    dragRef.current = kind;
    try {
      // Keeps a drag alive when the pointer leaves the waveform, which it
      // routinely does when dragging a handle to either extreme. Throws if the
      // pointer is already gone by the time this runs — a lost capture is
      // recoverable, a thrown handler is not.
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    } catch {
      // Drag still works, it just stops at the element's edge.
    }
    applyDrag(kind, secondsAt(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!duration) return;
    if (!dragRef.current) {
      setHovering(kindAt(event.clientX));
      return;
    }
    applyDrag(dragRef.current, secondsAt(event.clientX));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const pct = (seconds: number) => (duration ? (seconds / duration) * 100 : 0);
  const selectionLength = Math.max(0, value.endSec - value.startSec);

  return (
    <div
      className={cn(
        "relative flex h-28 items-stretch gap-3 overflow-hidden rounded-md bg-black px-3 py-2",
        className
      )}
    >
      <div className="flex shrink-0 flex-col items-center justify-center gap-1">
        <button
          type="button"
          disabled={!buffer}
          onClick={() => (playing ? stop() : play())}
          aria-label={playing ? "Stop preview" : "Play selection"}
          className="flex size-8 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25 disabled:opacity-40"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
        <span className="text-[10px] font-medium tabular-nums text-emerald-400">
          {formatClipLength(selectionLength)}
        </span>
      </div>

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHovering(null)}
        className={cn(
          "relative min-w-0 flex-1 touch-none select-none",
          !buffer && "opacity-40",
          hovering === "seek" ? "cursor-pointer" : hovering ? "cursor-ew-resize" : "cursor-default"
        )}
      >
        <canvas ref={canvasRef} className="h-full w-full" />

        {buffer && (
          <>
            {/* Dimming the cut-away regions as well as the bars: the bars
                alone read as quiet audio, the shading reads as excluded. */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 bg-black/55"
              style={{ width: `${pct(value.startSec)}%` }}
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 bg-black/55"
              style={{ width: `${100 - pct(value.endSec)}%` }}
            />

            {playhead !== null && (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-emerald-400"
                style={{ left: `${pct(playhead)}%` }}
              />
            )}

            {(["start", "end"] as const).map((edge) => (
              <div
                key={edge}
                className={cn(
                  "pointer-events-none absolute inset-y-0 w-1 rounded-full bg-white transition-colors",
                  hovering === edge && "bg-emerald-400"
                )}
                style={{
                  left: `${pct(edge === "start" ? value.startSec : value.endSec)}%`,
                  transform: "translateX(-50%)",
                }}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
