"use client";

import { Download, Loader2, Music4, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { downloadFile } from "@/lib/download";
import { formatClock } from "@/lib/media";
import { cn } from "@/lib/utils";

/**
 * A player for an audio attachment, in place of the browser's default
 * `<audio controls>` — that widget can't be styled and looks nothing like the
 * rest of the app. Transport, seek bar and download only; the underlying
 * element does the actual playback.
 */
export function AudioAttachment({
  url,
  fileName,
  className,
}: {
  url: string;
  fileName: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  // While the thumb is held, the bar follows the pointer rather than the
  // element — otherwise timeupdate yanks it back mid-drag.
  const [scrubbing, setScrubbing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoaded = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onTime = () => setPosition(audio.currentTime);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setPosition(0);
    };

    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setError("Couldn't play this file."));
    else audio.pause();
  };

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadFile(url, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={cn(
        "mt-1 flex max-w-md flex-col gap-2 rounded-md border bg-muted/30 p-2.5",
        className
      )}
    >
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />

      <div className="flex items-center gap-2">
        <Music4 className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{fileName}</p>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          title={`Download ${fileName}`}
          disabled={downloading}
          onClick={() => void handleDownload()}
        >
          {downloading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="icon"
          className="size-8 shrink-0 rounded-full"
          onClick={toggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>

        <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {formatClock(position)}
        </span>

        <Slider
          value={[Math.min(position, duration || 0)]}
          min={0}
          max={duration || 1}
          step={0.1}
          disabled={!duration}
          onValueChange={([value]) => {
            setScrubbing(true);
            setPosition(value ?? 0);
          }}
          onValueCommit={([value]) => {
            setScrubbing(false);
            seek(value ?? 0);
          }}
          className="min-w-0 flex-1"
        />

        <span className="w-9 shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {formatClock(duration)}
        </span>
      </div>

      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
