"use client";

import { useLoopedPlayback } from "@/hooks/use-looped-playback";
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

/**
 * The effect, played on a loop with a long pause between plays.
 *
 * An effect left to loop the way a GIF does is a card with something moving in
 * it for as long as it's open, which stops being decoration and becomes a
 * distraction. It plays once, holds still for twenty seconds, and plays again
 * — see `useLoopedPlayback`, which also explains why the `key` has to change.
 */
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
  const playback = useLoopedPlayback(src, animate);

  if (!src) return null;
  return (
    <img
      // A new element per play: an `<img>` cannot be rewound, but a fresh one
      // starts its animation from the beginning even on a cached file.
      key={playback.cycle}
      src={playback.src}
      alt=""
      aria-hidden
      draggable={false}
      className={cn(
        "pointer-events-none absolute inset-0 z-20 h-full w-full select-none object-cover",
        rounded,
      )}
    />
  );
}

/**
 * The frame, drawn over whatever is hosting the profile.
 *
 * The host is the profile card in most places, and the *whole dialog* when the
 * profile has been opened into one — a frame is meant to surround the thing
 * you are looking at, and in the dialog the thing you are looking at is the
 * dialog. Which of those it is isn't decided here: this fills its positioned
 * parent, and the parent is whichever box should be framed.
 *
 * `overlay` — the default — lies over that box at exactly its size, which is
 * what artwork drawn for a card expects. `wrap` scales it out past the edges
 * instead, for a frame with a border thickness of its own.
 */
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
      // Above the effect: a frame is the outermost thing here, and an effect
      // drawn over its border would look like the effect had leaked.
      className="top-1/2 left-1/2 z-30 max-w-none -translate-x-1/2 -translate-y-1/2"
      style={
        wrap
          ? {
              // A fixed overhang rather than a percentage, so the border is the
              // same thickness on all four edges of a tall box — see
              // FRAME_WRAP_OVERHANG_PX.
              width: `calc(100% + ${FRAME_WRAP_OVERHANG_PX * 2}px)`,
              height: `calc(100% + ${FRAME_WRAP_OVERHANG_PX * 2}px)`,
            }
          : { width: "100%", height: "100%" }
      }
    />
  );
}

/**
 * A box that wears somebody's frame around itself.
 *
 * The frame belongs to the thing you are looking at, and what that thing is
 * depends on where the profile turned up: a popover *is* the profile, a dialog
 * *is* the profile, and only in a list is the card a component of something
 * else. Wrapping the container in this rather than letting the card draw its
 * own is what makes the frame surround the popover instead of the card sitting
 * inside it — the two are usually the same size, but the popover has a border
 * and a radius of its own that the card knows nothing about.
 *
 * `overflow-visible` matters: a wrapping frame is drawn past these edges, and
 * a scroll container or a rounded box would cut off exactly the part that
 * makes it a frame.
 */
export function ProfileFrameHost({
  src,
  mode,
  className,
  children,
}: {
  src?: string;
  mode?: ProfileFrameMode | string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative overflow-visible", className)}>
      {children}
      <ProfileFrameLayer src={src} mode={mode} />
    </div>
  );
}
