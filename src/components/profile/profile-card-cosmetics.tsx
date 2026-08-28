"use client";

import { useStaticFrame } from "@/hooks/use-static-frame";
import {
  FRAME_WRAP_OVERHANG_PX,
  frameMode,
  type ProfileFrameMode,
} from "@/lib/profile-cosmetics";
import { cn } from "@/lib/utils";

/**
 * The two layers a profile card wears over its content: the effect, and the
 * frame.
 *
 * Both are children of the card's *outer* box rather than of the box that
 * clips its content, because a wrapping frame is drawn past the card's edges
 * and `overflow-hidden` would cut exactly the part that makes it a frame.
 *
 * Neither is ever hit-tested. An effect covers the whole card including its
 * buttons, and a frame overhangs into whatever is beside it — a layer that
 * swallowed clicks would make the card underneath unusable, which is a high
 * price for jewellery.
 */

/** A still is used for the same reason avatars use one — see `useStaticFrame`.
 * A profile card is opened to be looked at, so the default here is to play;
 * `animate={false}` is for the places showing many cards at once. */
function CosmeticLayer({
  src,
  animate,
  className,
  style,
}: {
  src: string;
  animate: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const poster = useStaticFrame(src, !animate);
  return (
    <img
      src={poster ?? src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn("pointer-events-none absolute select-none", className)}
      style={style}
    />
  );
}

export function ProfileEffectLayer({
  src,
  animate = true,
  /** Matches the radius of the box it's drawn over, so a full-bleed effect
   * doesn't square off the card's corners. */
  rounded = "rounded-[5px]",
}: {
  src?: string;
  animate?: boolean;
  rounded?: string;
}) {
  if (!src) return null;
  return (
    <CosmeticLayer
      src={src}
      animate={animate}
      className={cn("inset-0 z-20 h-full w-full object-cover", rounded)}
    />
  );
}

export function ProfileFrameLayer({
  src,
  mode,
  animate = true,
}: {
  src?: string;
  mode?: ProfileFrameMode | string;
  animate?: boolean;
}) {
  if (!src) return null;
  const wrap = frameMode(mode) === "wrap";

  return (
    <CosmeticLayer
      src={src}
      animate={animate}
      // Above the effect: a frame is the outermost thing on the card, and an
      // effect drawn over its border would look like the effect had leaked.
      className="top-1/2 left-1/2 z-30 max-w-none -translate-x-1/2 -translate-y-1/2"
      style={
        wrap
          ? {
              // A fixed overhang rather than a percentage, so the border is the
              // same thickness on all four edges of a tall card — see
              // FRAME_WRAP_OVERHANG_PX.
              width: `calc(100% + ${FRAME_WRAP_OVERHANG_PX * 2}px)`,
              height: `calc(100% + ${FRAME_WRAP_OVERHANG_PX * 2}px)`,
            }
          : { width: "100%", height: "100%" }
      }
    />
  );
}

/** True when a card is wearing anything from this file — the card uses it to
 * decide whether it needs its own stacking context. */
export function hasCardCosmetics(effect?: string, frame?: string): boolean {
  return !!effect || !!frame;
}
