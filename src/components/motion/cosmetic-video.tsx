"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";

import { continueCosmeticVideo, cosmeticVideoSource, useCosmeticVideoUrl } from "@/lib/cosmetic-video";

/**
 * A cosmetic video (nameplate, profile effect, decoration or sticker layer): muted, inline, transparent, and played
 * the way Crystal's cosmetics are made to be played: the intro once from the start, then round the idle from its loop
 * point for as long as it is allowed to move (see `src/lib/cosmetic-video.ts`).
 *
 * When it is not allowed to move (a list row that isn't pointed at, reduced motion, the app in the background) it rests
 * on its poster, or, once it has played, on the frame it stopped at, but never part-way through the intro's fade-in:
 * a cosmetic paused there would be half there, or not there at all.
 */
export function CosmeticVideo({
  value,
  playing,
  posterUrl: fallbackPoster,
  className,
  style,
}: {
  /** The stored address, fragment and all. */
  value: string;
  playing: boolean;
  /** A poster from somewhere other than the address (a layer's own `posterUrl`). */
  posterUrl?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const source = useMemo(() => cosmeticVideoSource(value), [value]);
  const file = useCosmeticVideoUrl(source) ?? source.url;
  const poster = source.posterUrl ?? fallbackPoster;
  const ref = useRef<HTMLVideoElement>(null);
  const { loopFrom } = source;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) {
      // Refused when the page isn't allowed to start media yet; it then stays on its still.
      void video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
      if (loopFrom !== undefined && video.currentTime < loopFrom) video.currentTime = loopFrom;
    }
  }, [playing, file, loopFrom]);

  // With no poster, a media fragment is what gets a browser that has only loaded metadata to paint a frame, and it
  // asks for one where the picture is whole.
  const src = poster ? file : `${file}#t=${loopFrom ?? 0.001}`;
  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      playsInline
      disablePictureInPicture
      loop={loopFrom === undefined}
      autoPlay={playing}
      preload={playing ? "auto" : "metadata"}
      onEnded={(event) => continueCosmeticVideo(event.currentTarget, loopFrom)}
      // A video element is focusable and draggable by default in a way a decoration shouldn't be.
      tabIndex={-1}
      draggable={false}
      aria-hidden
      className={className}
      style={style}
    />
  );
}
