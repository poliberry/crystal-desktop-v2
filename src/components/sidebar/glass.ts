/**
 * The sidebar's floating-glass surface: a translucent, blurred card with a
 * hairline edge lit from the top-left.
 *
 * Shared by the Priority card and the call/stream cards stacked above the user
 * card, so the two read as one family. `tint` is the gradient that fades to
 * transparent; the priority card uses `GLASS_GOLD`, the dock cards stay
 * neutral so a yellow card keeps meaning "this is a VIP".
 */
export const GLASS_BASE =
  "relative overflow-hidden rounded-2xl border bg-gradient-to-br backdrop-blur-xl shadow-lg shadow-black/25 ring-1 ring-inset ring-white/5";

export const GLASS_GOLD = "border-yellow-300/30 from-yellow-300/30 via-yellow-400/10 to-transparent";

export const GLASS_NEUTRAL = "border-white/15 from-white/15 via-white/5 to-transparent";

/**
 * The call card's surface: close to black in dark mode and pale grey in light,
 * with a light raking across it from the top-left corner.
 *
 * One radial gradient over a solid base, rather than a linear gradient with a
 * separate glow laid over it: two gradients meeting is where the seam was. The
 * stops step down gradually (and end well inside the card) so there is no edge
 * for the eye to find, and the glow is the card's own background rather than a
 * layer that has to be clipped to it.
 *
 * The colours are the `--glass-*` variables in globals.css, which is where the
 * two modes differ. Also the surface of the device pickers and the message
 * composer, so all three read as one family.
 */
export const GLASS_DARK =
  "border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] bg-[image:var(--glass-glow)]";

/**
 * `GLASS_DARK` with the base fill turned down, for a card that should nearly
 * dissolve into whatever is behind it (the message composer). Laid after
 * `GLASS_DARK` so it wins the background colour; the glow and the blur stay.
 */
export const GLASS_SOFT = "bg-[color:var(--glass-bg-soft)]";

/** Controls on a `GLASS_DARK` card: a faint fill of the text colour, so it
 * reads as a lighter patch in dark mode and a darker one in light. */
export const GLASS_CONTROL = "bg-foreground/10 hover:bg-foreground/20 border-0";

/**
 * A settings card: the glass family's gradient and blur, tinted with the text
 * colour rather than with white so it is a lighter patch in a dark theme and a
 * darker one in a light theme, and a hairline that reads in both. Flatter than
 * the dock's cards (no ring, a small shadow) because a page has a lot of them
 * side by side.
 */
export const GLASS_SETTINGS =
  "relative rounded-lg border border-foreground/10 bg-gradient-to-br from-foreground/[0.08] via-foreground/[0.03] to-transparent backdrop-blur-xl shadow-sm shadow-black/10";
