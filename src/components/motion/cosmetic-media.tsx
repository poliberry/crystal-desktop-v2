"use client";

import { useRef } from "react";

import { isMotionUrl } from "../../../convex/lib/motion";
import { isVideoUrl } from "@/lib/media";
import { CosmeticVideo } from "@/components/motion/cosmetic-video";
import { MotionPlayer } from "@/components/motion/motion-player";
import { useAncestorHover } from "@/hooks/use-ancestor-hover";
import { useMotionAllowed } from "@/hooks/use-motion-allowed";
import { useStaticFrame } from "@/hooks/use-static-frame";
import { cn } from "@/lib/utils";

/**
 * A nameplate or profile effect shown as a plain picture in a settings preview: an `<img>` for a file, a live player
 * for an animated design made in Crystal Studio (which is a JSON file, and would be a broken image).
 * The parent decides the box; this fills it.
 *
 * `animate` is when it may move: always (the default — a preview is for looking at it), never, or `"hover"` to wait
 * until whatever it sits in is pointed at, for the places that use it as wallpaper behind other things.
 */
export function CosmeticMedia({
  src,
  className,
  animate = true,
}: {
  src?: string | null;
  className?: string;
  animate?: boolean | "hover";
}) {
  const motion = isMotionUrl(src);
  const video = isVideoUrl(src);
  const box = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);
  const hovered = useAncestorHover(motion || video ? box : marker, animate === "hover" && !!src);
  const motionAllowed = useMotionAllowed();
  const playing = motionAllowed && (animate === true || (animate === "hover" && hovered));
  const poster = useStaticFrame(src && !motion && !video ? src : undefined, !playing);

  if (!src) return null;
  if (motion) {
    // The player fills whatever box it is in, so it gets one of its own (with the caller's classes: masks, opacity).
    return (
      <div ref={box} className={cn("relative size-full", className)}>
        <MotionPlayer url={src} animate={playing} />
      </div>
    );
  }
  if (video) {
    return (
      <div ref={box} className={cn("relative size-full overflow-hidden", className)}>
        <CosmeticVideo value={src} playing={playing} className="h-full w-full object-cover" />
      </div>
    );
  }
  // The `<img>` can't be pointed at for its own hover when the caller makes it `pointer-events-none`, so a
  // `"hover"` one is looked for from a marker beside it: `useAncestorHover` only needs *an* element in the same place.
  return (
    <>
      {animate === "hover" && <span ref={marker} hidden />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster ?? src}
        alt=""
        draggable={false}
        className={cn("h-full w-full object-cover", className)}
      />
    </>
  );
}
