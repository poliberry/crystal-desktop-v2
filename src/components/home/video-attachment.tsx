"use client";

import {
  Download,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadFile } from "@/lib/download";
import { formatClock } from "@/lib/media";
import { cn } from "@/lib/utils";

/** How long the video plays after the pointer stops moving before the bar
 * fades out. Only applies while playing — a paused video keeps its controls. */
const IDLE_HIDE_MS = 2200;

/** Arrow-key seek, and the page-sized jump on shift. */
const SEEK_STEP_S = 5;
const SEEK_STEP_LARGE_S = 30;

/** The controls sit on a dark scrim over the video, so they're white rather
 * than themed — restyled onto the shared Slider instead of forking it. */
const SEEK_SLIDER_CLASSES =
  "[&_[data-slot=slider-track]]:bg-transparent [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:ring-white/40 [&_[data-slot=slider-thumb]]:shadow-none";
const VOLUME_SLIDER_CLASSES =
  "[&_[data-slot=slider-track]]:bg-white/30 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:border-white [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:ring-white/40 [&_[data-slot=slider-thumb]]:shadow-none";

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          className="flex size-7 shrink-0 items-center justify-center rounded text-white/90 transition-colors hover:bg-white/20 hover:text-white focus-visible:bg-white/20 focus-visible:outline-none"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A player for a video attachment, in place of the browser's default
 * `<video controls>`.
 *
 * The native widget can't be styled — it renders Chromium's own grey chrome in
 * the middle of a themed message list, and on a short clip its bar can be
 * wider than the video itself. This is the same set of controls drawn in the
 * app's own language: scrim, white-on-transparent, sized to the frame. The
 * underlying element still does all the actual playback and buffering; nothing
 * here reimplements decoding, only the surface.
 *
 * Deliberately shares its clock (`formatClock`) and its download path
 * (`downloadFile`) with the audio player, so an audio and a video attachment
 * in the same conversation read as two views of one component rather than two
 * unrelated widgets.
 */
export function VideoAttachment({
  url,
  fileName,
  className,
}: {
  url: string;
  fileName: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [pointerIdle, setPointerIdle] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pipSupported =
    typeof document !== "undefined" && (document as Document).pictureInPictureEnabled === true;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // `buffered` can hold several ranges after seeking around; the one that
    // matters is whichever contains the playhead.
    const syncBuffered = () => {
      const ranges = video.buffered;
      for (let i = ranges.length - 1; i >= 0; i--) {
        if (ranges.start(i) <= video.currentTime) {
          setBuffered(ranges.end(i));
          return;
        }
      }
      setBuffered(0);
    };

    const onLoaded = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      syncBuffered();
    };
    const onTime = () => {
      setPosition(video.currentTime);
      syncBuffered();
    };
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
      setError(null);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => {
      setWaiting(false);
      syncBuffered();
    };
    const onProgress = syncBuffered;
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const onError = () => {
      setWaiting(false);
      setError("This video couldn't be played.");
    };
    const onEnterPip = () => setPipActive(true);
    const onLeavePip = () => setPipActive(false);

    // Catch up on everything that happened before this effect ran. A video
    // already in the HTTP cache — scrolling back to a message you've seen — is
    // fully loaded before React attaches a single listener, so `loadedmetadata`
    // and `progress` have both been and gone: without this the seek bar stays
    // disabled at 0:00 and the buffered range reads empty on exactly the
    // videos that loaded fastest.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onLoaded();
    if (!video.paused) {
      setPlaying(true);
      setStarted(true);
    }
    setPosition(video.currentTime);
    setVolume(video.volume);
    setMuted(video.muted);

    video.addEventListener("loadedmetadata", onLoaded);
    video.addEventListener("durationchange", onLoaded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeked", onTime);
    video.addEventListener("canplay", onLoaded);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("progress", onProgress);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("error", onError);
    video.addEventListener("enterpictureinpicture", onEnterPip);
    video.addEventListener("leavepictureinpicture", onLeavePip);
    return () => {
      video.removeEventListener("loadedmetadata", onLoaded);
      video.removeEventListener("durationchange", onLoaded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeked", onTime);
      video.removeEventListener("canplay", onLoaded);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("error", onError);
      video.removeEventListener("enterpictureinpicture", onEnterPip);
      video.removeEventListener("leavepictureinpicture", onLeavePip);
    };
  }, []);

  // Fullscreen can also be left with Escape or the OS, so the button's state
  // comes from the document rather than from having pressed it.
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, []);

  /** Any pointer activity shows the bar and restarts the fade-out timer. */
  const wakeControls = () => {
    setPointerIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setPointerIdle(true), IDLE_HIDE_MS);
  };

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setError("This video couldn't be played."));
    else video.pause();
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video || !duration) return;
    const next = Math.min(duration, Math.max(0, video.currentTime + delta));
    video.currentTime = next;
    setPosition(next);
    wakeControls();
  };

  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    setPosition(seconds);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    // Unmuting a video whose volume was dragged to zero should make a sound.
    if (video.muted && video.volume === 0) video.volume = 1;
    video.muted = !video.muted;
  };

  const changeVolume = (next: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = next;
    video.muted = next === 0;
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void containerRef.current?.requestFullscreen().catch(() => {});
  };

  const togglePip = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void video.requestPictureInPicture().catch(() => {});
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadFile(url, fileName);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Let the controls' own buttons handle their keys.
    if (event.target !== event.currentTarget) return;
    switch (event.key) {
      case " ":
      case "k":
        event.preventDefault();
        toggle();
        break;
      case "ArrowRight":
        event.preventDefault();
        seekBy(event.shiftKey ? SEEK_STEP_LARGE_S : SEEK_STEP_S);
        break;
      case "ArrowLeft":
        event.preventDefault();
        seekBy(-(event.shiftKey ? SEEK_STEP_LARGE_S : SEEK_STEP_S));
        break;
      case "m":
        event.preventDefault();
        toggleMute();
        break;
      case "f":
        event.preventDefault();
        toggleFullscreen();
        break;
    }
  };

  // Visible whenever there's a reason to be: not playing yet, paused, or the
  // pointer has moved recently. Hiding chrome over a playing video is the
  // whole point of a custom player.
  const controlsVisible = !playing || !pointerIdle;
  const bufferedPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="group"
      aria-label={`Video: ${fileName}`}
      onKeyDown={onKeyDown}
      onPointerMove={wakeControls}
      onPointerLeave={() => setPointerIdle(true)}
      className={cn(
        "group/video relative mt-1 w-fit max-w-full overflow-hidden rounded-md border bg-black focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        // In fullscreen the container *is* the screen, so the frame styling
        // that makes it a card in a message list has to come off.
        fullscreen && "flex h-full w-full max-w-none items-center justify-center rounded-none border-0",
        playing && pointerIdle && "cursor-none",
        className
      )}
    >
      <video
        ref={videoRef}
        src={url}
        preload="metadata"
        playsInline
        className={cn("block max-h-80 max-w-full", fullscreen && "max-h-full h-full w-full")}
      />

      {/* Click target for play/pause. Separate from the <video> so it can sit
          under the control bar without the bar's own clicks reaching it. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        className="absolute inset-0 cursor-pointer"
      />

      {/* The one control that has to be findable before anything else. */}
      {(!started || (!playing && !error)) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Play className="size-5 translate-x-px fill-current" />
          </span>
        </div>
      )}

      {waiting && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-7 animate-spin text-white/80" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-4 text-center">
          <p className="text-xs text-white/90">{error}</p>
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className="flex items-center gap-1.5 rounded bg-white/15 px-2.5 py-1 text-xs text-white hover:bg-white/25 disabled:opacity-70"
          >
            {downloading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Download instead
          </button>
        </div>
      )}

      <TooltipProvider delayDuration={400}>
        <div
          // The scrim is a tall gradient so the controls stay readable over a
          // bright frame, but most of its box is fully transparent — and a
          // transparent box still eats clicks. Left as-is it swallowed every
          // click on the bottom half of the video, which is where play/pause
          // is. The rows below opt back in.
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2 pt-8 pb-1.5 transition-opacity",
            controlsVisible ? "opacity-100" : "opacity-0",
            error && "hidden"
          )}
        >
          <div className="pointer-events-auto flex items-center gap-2">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-white/80">
              {formatClock(position)}
            </span>

            <div className="relative min-w-0 flex-1">
              {/* Base track and the buffered range, drawn behind the slider —
                  the shared Slider has no slot for "loaded but not played",
                  so its own track goes transparent and these show through. */}
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
                <div className="h-full bg-white/40" style={{ width: `${bufferedPct}%` }} />
              </div>
              <Slider
                value={[Math.min(position, duration || 0)]}
                min={0}
                max={duration || 1}
                step={0.05}
                disabled={!duration}
                aria-label="Seek"
                onValueChange={([value]) => setPosition(value ?? 0)}
                onValueCommit={([value]) => seekTo(value ?? 0)}
                className={cn("relative", SEEK_SLIDER_CLASSES)}
              />
            </div>

            <span className="w-9 shrink-0 text-[10px] tabular-nums text-white/80">
              {formatClock(duration)}
            </span>
          </div>

          <div className="pointer-events-auto mt-0.5 flex items-center gap-0.5">
            <ControlButton label={playing ? "Pause" : "Play"} onClick={toggle}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </ControlButton>

            {/* The slider stays collapsed until the group is hovered — a
                permanent one would crowd the bar on a narrow clip. */}
            <div className="group/volume flex items-center">
              <ControlButton label={muted ? "Unmute" : "Mute"} onClick={toggleMute}>
                <VolumeIcon className="size-4" />
              </ControlButton>
              <div className="w-0 overflow-hidden opacity-0 transition-all group-hover/volume:w-16 group-hover/volume:opacity-100 group-focus-within/volume:w-16 group-focus-within/volume:opacity-100">
                <Slider
                  value={[muted ? 0 : volume]}
                  min={0}
                  max={1}
                  step={0.01}
                  aria-label="Volume"
                  onValueChange={([value]) => changeVolume(value ?? 0)}
                  className={cn("mx-1 w-14", VOLUME_SLIDER_CLASSES)}
                />
              </div>
            </div>

            <p className="mx-1 min-w-0 flex-1 truncate text-[10px] text-white/70">{fileName}</p>

            <ControlButton
              label={downloading ? "Downloading…" : `Download ${fileName}`}
              onClick={() => void handleDownload()}
            >
              {downloading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Download className="size-4" />
              )}
            </ControlButton>

            {pipSupported && (
              <ControlButton
                label={pipActive ? "Exit picture in picture" : "Picture in picture"}
                onClick={togglePip}
              >
                <PictureInPicture2 className="size-4" />
              </ControlButton>
            )}

            <ControlButton
              label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </ControlButton>
          </div>
        </div>
      </TooltipProvider>
    </div>
  );
}
