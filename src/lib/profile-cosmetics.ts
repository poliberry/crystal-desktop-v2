/**
 * Profile cosmetics that dress the card rather than the avatar — the display
 * name's style, the effect played over the card, and the frame drawn around
 * it.
 *
 * The avatar's own frame lives in src/lib/avatar-decorations.ts and is a
 * different problem: it has built-in presets to encode, so its stored value is
 * a tagged string. An effect or a frame is always a file somebody uploaded, so
 * the stored value is simply its URL and there is nothing here to resolve. What
 * *is* here is the part neither the schema nor the renderer should have an
 * opinion about on its own: how big a frame is drawn, and what a name style
 * actually looks like.
 */

import {
  normalizeLayers,
  type CosmeticLayer,
} from "@/lib/cosmetic-layers";

/** How an uploaded frame relates to the card it's drawn against. */
export type ProfileFrameMode = "wrap" | "overlay";

export type ProfileFrameFit = "stretch" | "aspect";
export type ProfileFrameAnchor = "top" | "center" | "bottom";

/**
 * Where a frame is drawn.
 *
 * Placement is per-upload rather than inferred, because frames are user
 * artwork of unknown shape: a border drawn to a card's proportions and a tall
 * piece meant to grow out of the card's top want opposite treatment, and
 * nothing in the file says which one you've got.
 */
export interface ProfileFrameLayout {
  fit: ProfileFrameFit;
  anchor: ProfileFrameAnchor;
  /** Width, as a percentage of the card. */
  scale: number;
  /** Pixels to shift it; negative is up. */
  offsetY: number;
}

/**
 * What a frame does when nobody has placed it.
 *
 * Matched to how Discord's profile decorations read: a little wider than the
 * card, keeping their own proportions, pinned to the top and lifted so the
 * artwork rises above the card's edge rather than starting at it.
 */
export const DEFAULT_FRAME_LAYOUT: ProfileFrameLayout = {
  fit: "aspect",
  anchor: "top",
  scale: 112,
  offsetY: -28,
};

export const FRAME_SCALE_RANGE = { min: 60, max: 220 } as const;
export const FRAME_OFFSET_RANGE = { min: -240, max: 240 } as const;

export const FRAME_FITS: { fit: ProfileFrameFit; label: string; hint: string }[] = [
  {
    fit: "aspect",
    label: "Keep shape",
    hint: "The artwork's own proportions. What most decorations want.",
    },
  {
    fit: "stretch",
    label: "Stretch",
    hint: "Pulled to the card's shape — for a border drawn to fit one.",
  },
];

export const FRAME_ANCHORS: {
  anchor: ProfileFrameAnchor;
  label: string;
}[] = [
  { anchor: "top", label: "Top" },
  { anchor: "center", label: "Centre" },
  { anchor: "bottom", label: "Bottom" },
];

/**
 * The room a card needs around it for its frame.
 *
 * A frame is drawn outside the card by design, and the boxes a card sits in —
 * the editor's preview column, the profile page's left column — are scroll
 * containers that clip. Rather than each of them guessing, they ask for the
 * padding the current placement actually needs and the card moves down (or
 * over) by that much.
 *
 * The vertical figure can only be approximate when the artwork keeps its own
 * proportions, because its height isn't known until it loads. What *is* known
 * is the offset, which is the part somebody drags until it looks right — so
 * that's what this follows, plus a margin so the last few pixels aren't shaved
 * off.
 */
export function frameHeadroom(
  layout: ProfileFrameLayout,
  hasFrame: boolean,
): { paddingTop: number; paddingBottom: number; paddingInline: number } {
  if (!hasFrame) return { paddingTop: 8, paddingBottom: 8, paddingInline: 8 };

  const MARGIN = 24;
  const lift = Math.max(0, -layout.offsetY);
  const drop = Math.max(0, layout.offsetY);
  // Half the extra width goes to each side.
  const sideways = Math.max(0, (layout.scale - 100) / 2);

  if (layout.anchor === "bottom") {
    return { paddingTop: MARGIN, paddingBottom: lift + MARGIN, paddingInline: sideways + 8 };
  }
  if (layout.anchor === "center") {
    return {
      paddingTop: lift + MARGIN,
      paddingBottom: drop + MARGIN,
      paddingInline: sideways + 8,
    };
  }
  return { paddingTop: lift + MARGIN, paddingBottom: MARGIN, paddingInline: sideways + 8 };
}

/**
 * A profile's frame as the list of layers to draw.
 *
 * Two eras of storage in one function. A profile edited since frames became a
 * list carries `profileFrameLayers`, and that is the whole answer. One that
 * isn't carries a single image and the four numbers that placed it, which are
 * turned into one layer meaning the same thing — approximately, because the
 * old offset was in pixels against a card of unknown width and the new one is
 * a percentage of it. `LEGACY_CARD_WIDTH` is the conversion, and the editor
 * shows the result live, which is where anybody who cares about the last few
 * pixels will fix it.
 *
 * Nothing is written back: a profile is converted when its owner next saves
 * the frame, so an older client goes on drawing what it always drew.
 */
export function frameLayersFrom(stored: {
  profileFrame?: string;
  profileFrameFit?: string;
  profileFrameAnchor?: string;
  profileFrameScale?: number;
  profileFrameOffsetY?: number;
  profileFrameLayers?: CosmeticLayer[];
}): CosmeticLayer[] {
  if (stored.profileFrameLayers?.length) {
    return normalizeLayers(stored.profileFrameLayers);
  }
  if (!stored.profileFrame) return [];

  const layout = frameLayout(stored);
  const y = (layout.offsetY / LEGACY_CARD_WIDTH) * 100;
  return normalizeLayers([
    {
      id: "legacy",
      url: stored.profileFrame,
      anchor: layout.anchor,
      x: 50,
      // The old numbers placed the artwork's *top edge*; the new ones place
      // its centre. Half a layer's height is not knowable from here — the file
      // hasn't loaded — so half its width stands in, which is right for the
      // square-ish artwork most frames are.
      y: layout.anchor === "bottom" ? y - layout.scale / 2 : y + layout.scale / 2,
      width: layout.scale,
      stretchY: layout.fit === "stretch" || undefined,
    },
  ]);
}

/** The card width the old pixel offsets were dragged against — the editor's
 * preview, which is what everybody was looking at when they placed one. */
const LEGACY_CARD_WIDTH = 320;

/** Read a stored layout, filling in the defaults for anything unset — every
 * frame uploaded before placement existed lands on the Discord-ish default
 * rather than in the corner. */
export function frameLayout(stored: {
  profileFrameFit?: string;
  profileFrameAnchor?: string;
  profileFrameScale?: number;
  profileFrameOffsetY?: number;
}): ProfileFrameLayout {
  const clamp = (n: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, n));
  return {
    fit: stored.profileFrameFit === "stretch" ? "stretch" : "aspect",
    anchor:
      stored.profileFrameAnchor === "center"
        ? "center"
        : stored.profileFrameAnchor === "bottom"
          ? "bottom"
          : "top",
    scale:
      typeof stored.profileFrameScale === "number"
        ? clamp(stored.profileFrameScale, FRAME_SCALE_RANGE.min, FRAME_SCALE_RANGE.max)
        : DEFAULT_FRAME_LAYOUT.scale,
    offsetY:
      typeof stored.profileFrameOffsetY === "number"
        ? clamp(
            stored.profileFrameOffsetY,
            FRAME_OFFSET_RANGE.min,
            FRAME_OFFSET_RANGE.max,
          )
        : DEFAULT_FRAME_LAYOUT.offsetY,
  };
}

/**
 * How far a `wrap` frame hangs past each edge of the card, in pixels.
 *
 * The same idea as `AvatarDecoration`'s 126%, but a fixed distance rather than
 * a ratio. An avatar is a square, so a percentage overhangs it evenly; a
 * profile card is roughly 320 by 500, and 6% of that is nineteen pixels at the
 * sides against thirty at the top — a frame with visibly different thicknesses
 * on two axes, which reads as a stretched picture rather than a border.
 *
 * The size is still written as a width and a height (via `calc`) rather than as
 * four insets, for the reason spelled out on `AvatarDecoration`: an `<img>`
 * given only insets is a replaced element and falls back to its intrinsic pixel
 * size, so an uploaded PNG would render at whatever it was exported at.
 */
export const FRAME_WRAP_OVERHANG_PX = 22;

/**
 * How far an `overlay` frame sits outside the card.
 *
 * Small: this is the mode for artwork that hugs the card, sitting just off its
 * edges the way an avatar decoration sits just off an avatar's.
 */
export const FRAME_OVERLAY_INSET_PX = 10;

export const FRAME_MODES: {
  mode: ProfileFrameMode;
  label: string;
  hint: string;
}[] = [
  {
    mode: "overlay",
    label: "Sit on top",
    hint: "Hugs the card, sitting just off every edge.",
  },
  {
    mode: "wrap",
    label: "Wrap around",
    hint: "Further out again, for artwork with a thick border of its own.",
  },
];

/**
 * `overlay` is what an absent mode means.
 *
 * Sitting on top is what almost every frame is: artwork drawn to the shape of
 * the thing it decorates. Wrapping is the special case — a frame with a
 * visible thickness that is supposed to hang past the edges — so it's the one
 * you have to ask for.
 */
export function frameMode(value: string | null | undefined): ProfileFrameMode {
  return value === "wrap" ? "wrap" : "overlay";
}

/**
 * A way of drawing the display name on a profile card.
 *
 * `className` is applied to the name element itself, so a style is a few
 * Tailwind utilities and nothing more — no extra element, no state, and no
 * cost at all for the default. Gradient styles need `bg-clip-text` plus a
 * transparent fill, which is why they carry `text-transparent` rather than a
 * colour.
 */
export interface DisplayNameStyle {
  key: string;
  label: string;
  className: string;
}

export const DISPLAY_NAME_STYLES: DisplayNameStyle[] = [
  { key: "default", label: "Default", className: "" },
  {
    key: "serif",
    label: "Serif",
    className: "font-serif italic tracking-tight",
  },
  {
    key: "mono",
    label: "Mono",
    className: "font-mono tracking-tight",
  },
  {
    key: "sunset",
    label: "Sunset",
    className:
      "bg-gradient-to-r from-amber-300 via-rose-400 to-fuchsia-500 bg-clip-text text-transparent",
  },
  {
    key: "aurora",
    label: "Aurora",
    className:
      "bg-gradient-to-r from-sky-300 via-violet-400 to-emerald-300 bg-clip-text text-transparent",
  },
  {
    key: "glow",
    label: "Glow",
    className: "text-white [text-shadow:0_0_12px_rgba(255,255,255,0.75)]",
  },
];

/**
 * The classes for a stored style key.
 *
 * An unknown key renders as the default rather than throwing, the same
 * forgiveness `decorationSrc` extends to an unknown decoration: a client on an
 * older build should show a plain name, not a broken card.
 */
export function displayNameStyleClass(key: string | null | undefined): string {
  return DISPLAY_NAME_STYLES.find((s) => s.key === key)?.className ?? "";
}
