"use client";

import { useLoopedPlayback } from "@/hooks/use-looped-playback";
import { useStaticFrame } from "@/hooks/use-static-frame";
import { useEffect, useRef, useState } from "react";

import { LayerContent } from "@/components/profile/layer-content";
import {
  DEFAULT_VARIANT,
  layerStyle,
  resolveLayer,
  variantForHeight,
  type CosmeticLayer as Layer,
} from "@/lib/cosmetic-layers";
import {
  DEFAULT_FRAME_LAYOUT,
  type ProfileFrameLayout,
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

/** One placed layer of a frame — a picture, a shape or a line of text. The
 * box comes from `layerStyle`; what goes in it is `LayerContent`, which the
 * canvas editor draws with too, so what you arrange is what everyone sees. */
function PlacedLayer({ layer, animate }: { layer: Layer; animate: boolean }) {
  return (
    <div
      className="pointer-events-none absolute select-none"
      style={layerStyle(layer)}
    >
      <LayerContent layer={layer} frozen={!animate} />
    </div>
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
 * The frame as a stack of placed images — one, or eight.
 *
 * The stack is a *container*, so `cqw` is one percent of the card's width and
 * `cqh` one percent of its height, which is what every layer's geometry is
 * written in (see src/lib/cosmetic-layers.ts). Two things fall out of that for
 * free: one placement is right at every size the card is drawn at, and a
 * `stretchY` layer follows the card's height when a long bio makes it grow.
 *
 * Not hit-tested, like everything else here: a frame overhangs into whatever
 * is beside the card, and a layer that swallowed clicks would make its
 * neighbours unusable.
 */
export function ProfileFrameLayers({
  layers,
  animate = true,
}: {
  layers: Layer[];
  animate?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState(DEFAULT_VARIANT);

  /**
   * Which shape of card this is, measured rather than declared.
   *
   * A layer may be placed differently per card shape (see `resolveLayer`), and
   * the card's height is whatever its owner has written — so the only way to
   * know which placement applies is to look. A container query could ask the
   * same question in CSS, but the answer has to pick between whole sets of
   * numbers rather than switch one property, which is a thing only JavaScript
   * can do.
   *
   * Watched rather than measured once, because a card grows under its own
   * frame: a rich presence card arriving is one of the things that changes the
   * shape.
   */
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0) setVariant(variantForHeight((height / width) * 100));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (layers.length === 0) return null;
  return (
    <div
      ref={ref}
      aria-hidden
      data-slot="profile-frame"
      className="pointer-events-none absolute inset-0 z-30 [container-type:size]"
    >
      {layers.map((layer) => (
        <PlacedLayer key={layer.id} layer={resolveLayer(layer, variant)} animate={animate} />
      ))}
    </div>
  );
}

/**
 * The frame — artwork that hangs off the card rather than being printed on it.
 *
 * Where exactly is the owner's decision, not this file's: frames are uploaded
 * art of unknown shape, and a border drawn to a card's proportions and a tall
 * piece meant to grow out of the card's top need opposite treatment. The four
 * numbers in `ProfileFrameLayout` are what places it; the defaults land where
 * Discord's decorations do, a little wider than the card and lifted above its
 * top edge.
 *
 * Whatever the placement, every ancestor between here and the window has to
 * leave the overhang alone — hence the padding around the card in the profile
 * editor and on the profile page, both of which sit inside scroll containers
 * that would otherwise clip exactly the part that makes this work.
 */
export function ProfileFrameLayer({
  src,
  layout,
  animate = true,
}: {
  src?: string;
  /** Where to draw it. Absent uses the defaults, which is what every frame
   * uploaded before placement existed gets. */
  layout?: Partial<ProfileFrameLayout>;
  animate?: boolean;
}) {
  if (!src) return null;

  const { fit, anchor, scale, offsetY } = { ...DEFAULT_FRAME_LAYOUT, ...layout };

  // Horizontal placement is always centred — a frame off to one side is not
  // something anybody has ever wanted, and leaving it out keeps the controls
  // to four.
  const style: React.CSSProperties = {
    width: `${scale}%`,
    // `auto` is what preserves the artwork's proportions: an `<img>` with a
    // width and no height takes its intrinsic ratio.
    height: fit === "stretch" ? `${scale}%` : "auto",
  };

  if (anchor === "center") {
    style.top = "50%";
    style.transform = `translate(-50%, calc(-50% + ${offsetY}px))`;
  } else if (anchor === "bottom") {
    style.bottom = `${-offsetY}px`;
    style.transform = "translateX(-50%)";
  } else {
    style.top = `${offsetY}px`;
    style.transform = "translateX(-50%)";
  }

  return (
    <CosmeticLayer
      src={src}
      animate={animate}
      // Above the effect — a frame is the outermost decoration, and an effect
      // drawn over its border would look like the effect had leaked. Below the
      // card's own buttons, which are `z-40`: jewellery must never cover a
      // control.
      className={cn(
        "left-1/2 z-30 max-w-none",
        fit === "stretch" ? "object-fill" : "object-contain",
      )}
      style={style}
    />
  );
}
