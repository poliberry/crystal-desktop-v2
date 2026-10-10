"use client";

import { isMotionUrl } from "../../../convex/lib/motion";
import { MotionPlayer } from "@/components/motion/motion-player";
import { cn } from "@/lib/utils";

/**
 * A nameplate or profile effect shown as a plain picture in a settings preview: an `<img>` for a file, a live player
 * for an animated design made in Crystal Studio (which is a JSON file, and would be a broken image).
 * The parent decides the box; this fills it.
 */
export function CosmeticMedia({ src, className }: { src?: string | null; className?: string }) {
  if (!src) return null;
  if (isMotionUrl(src)) {
    // The player fills whatever box it is in, so it gets one of its own (with the caller's classes: masks, opacity).
    return (
      <div className={cn("relative size-full", className)}>
        <MotionPlayer url={src} />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" draggable={false} className={cn("h-full w-full object-cover", className)} />;
}
