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

/** How an uploaded frame relates to the card it's drawn against. */
export type ProfileFrameMode = "wrap" | "overlay";

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
export const FRAME_WRAP_OVERHANG_PX = 14;

export const FRAME_MODES: {
  mode: ProfileFrameMode;
  label: string;
  hint: string;
}[] = [
  {
    mode: "overlay",
    label: "Sit on top",
    hint: "Drawn at exactly the size of the card — or of the dialog, when the profile is opened into one.",
  },
  {
    mode: "wrap",
    label: "Wrap around",
    hint: "Drawn a little larger, so a border of its own sits outside the edges.",
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
