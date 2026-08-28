/**
 * Avatar decorations — the frame drawn *around* someone's avatar.
 *
 * A decoration is stored on the user as one string, and that string says which
 * of three kinds it is:
 *
 *   `builtin:<key>`   one of the presets below, drawn from code
 *   `birthday:<a>-<b>` the temporary one generated for someone's birthday,
 *                      carrying the two hues it was generated with
 *   `https://…`       a picture the user uploaded themselves
 *
 * One field rather than a key *and* a URL because every query that returns a
 * user would otherwise have to carry both, and every render site would have to
 * know which one wins. `decorationSrc` collapses all three to the one thing a
 * renderer wants: an image URL.
 *
 * The presets are drawn as SVG data URIs rather than shipped as files: they're
 * a few hundred bytes each, they need no network (this is a desktop app that
 * may never have one), and generating them means the birthday one can be
 * recoloured per person from a pair of hues without shipping a picture for
 * every combination.
 *
 * The `birthday:` form is written by the server — see convex/lib/birthday.ts,
 * which generates the hues and the expiry. Change the format here, change it
 * there.
 */

export interface DecorationPreset {
  key: string;
  name: string;
  /** The stored value that selects it. */
  value: string;
  src: string;
}

/** `hsl()` rather than `oklch()`: this is standalone SVG rendered through an
 * `<img>`, where the app's colour tokens don't reach and older renderers
 * shouldn't be relied on. */
const hue = (h: number, s = 85, l = 62) => `hsl(${h} ${s}% ${l}%)`;

/**
 * Wrap SVG markup as a data URI.
 *
 * The viewBox is 100×100 and the avatar occupies the centred 76-unit square
 * (the overlay is drawn at 132% of the avatar — see `AvatarDecoration`), so
 * anything a decoration draws inside that square lands on top of the picture.
 * Deliberate for the crown, avoided by everything else.
 *
 * That square is a *rounded* square, because the app's avatars are: `rounded-md`
 * in lists and `rounded-xl` on a profile card both work out to about a fifth of
 * the width. A ring follows the same shape — a circle drawn around a squircle
 * reads as a mistake at the corners — which is what `SQUIRCLE_R` and
 * `squircleRing` below are for.
 */
function svg(body: string): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(markup)}`;
}

/** A four-pointed star centred on the origin, for the sparkle preset. */
const STAR_PATH =
  "M0,-7 C1,-2 2,-1 7,0 C2,1 1,2 0,7 C-1,2 -2,1 -7,0 C-2,-1 -1,-2 0,-7 Z";

const HEART_PATH =
  "M0,5 C-6.5,0.5 -5.5,-6 -1.6,-4.4 C-0.6,-3.9 0,-3.1 0,-2.5 C0,-3.1 0.6,-3.9 1.6,-4.4 C5.5,-6 6.5,0.5 0,5 Z";

/**
 * Corner radius of a frame drawn `inset` units in from the edge.
 *
 * Kept proportional as the frame moves outwards, the way a border-radius does:
 * a ring 4 units outside another with the *same* radius has visibly tighter
 * corners, which reads as two unrelated shapes rather than two rings.
 */
const SQUIRCLE_R = (inset: number) => round((100 - inset * 2) * 0.2);

/**
 * How far in from the overlay's edge a ring is drawn.
 *
 * The avatar occupies the middle 76 units — from 12 to 88 — and a ring is
 * drawn *on* that edge rather than out from it: with a 4.5-wide stroke centred
 * at 10 the two touch, which is what a frame around a picture does. Any gap
 * reads as the decoration having missed.
 */
const RING_INSET = 10;

/**
 * Where ornaments sit, per preset: on the same rounded-square path as a ring,
 * near enough in to sit against the avatar and far enough in that the shape
 * itself still fits — the viewBox clips, so a star of radius 7 cannot be
 * centred further out than 43.
 */
const SPARKLE_RADIUS = 42.5;
const HEART_RADIUS = 44;
const CONFETTI_RADIUS = 44;

/**
 * Points spaced around a rounded square, in SVG coordinates.
 *
 * A superellipse rather than a circle, for the same reason the rings are: an
 * ornament placed by angle alone drifts inwards at the corners and leaves a
 * gap. `radius` is the half-width, so the points sit on the square spanning
 * `50 ± radius` with its corners pulled in.
 */
function squircleRing(count: number, radius: number, startDeg = -90) {
  return Array.from({ length: count }, (_, i) => {
    const angle = ((startDeg + (360 / count) * i) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // |cos|^(1/2) with the sign put back: the exponent is what rounds the
    // square off, and 1/2 lands close to a `rounded-xl` corner.
    const project = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
    return {
      x: 50 + project(cos) * radius,
      y: 50 + project(sin) * radius,
      index: i,
    };
  });
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function auroraRing(): string {
  return svg(
    `<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${hue(265)}"/>` +
      `<stop offset="0.5" stop-color="${hue(200)}"/>` +
      `<stop offset="1" stop-color="${hue(330)}"/>` +
      `</linearGradient></defs>` +
      // One ring, out at the edge of the overlay. Drawn there rather than
      // hugging the avatar so there's daylight between the picture and the
      // frame — a ring a few pixels off the edge reads as a border on the
      // avatar itself, which is not what a decoration is.
      `<rect x="${RING_INSET}" y="${RING_INSET}" width="${100 - RING_INSET * 2}" height="${
        100 - RING_INSET * 2
      }" rx="${SQUIRCLE_R(RING_INSET)}" stroke="url(#a)" stroke-width="4.5"/>`
  );
}

function sparkles(): string {
  const stars = squircleRing(6, SPARKLE_RADIUS, -110)
    .map(({ x, y, index }) => {
      // Alternating sizes so the ring reads as scattered rather than as six
      // copies of one shape.
      const scale = index % 2 === 0 ? 1 : 0.62;
      const colour = index % 2 === 0 ? hue(88, 95, 70) : hue(45, 100, 82);
      return `<path d="${STAR_PATH}" fill="${colour}" transform="translate(${round(x)} ${round(
        y
      )}) scale(${scale})"/>`;
    })
    .join("");
  return svg(stars);
}

function hearts(): string {
  const shapes = squircleRing(5, HEART_RADIUS, -90)
    .map(({ x, y, index }) => {
      const scale = index % 2 === 0 ? 1.05 : 0.7;
      const colour = index % 2 === 0 ? hue(348, 90, 66) : hue(320, 85, 74);
      return `<path d="${HEART_PATH}" fill="${colour}" transform="translate(${round(x)} ${round(
        y
      )}) scale(${scale})"/>`;
    })
    .join("");
  return svg(shapes);
}

function crown(): string {
  // Sits over the top of the avatar rather than clear of it: a crown floating
  // above someone's head reads as a mistake.
  return svg(
    `<path d="M31,21 L31,7 L40.5,14.5 L50,3 L59.5,14.5 L69,7 L69,21 Z" fill="${hue(
      45,
      95,
      60
    )}" stroke="${hue(38, 90, 45)}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<rect x="31" y="20" width="38" height="4.5" rx="2.2" fill="${hue(45, 95, 66)}"/>` +
      `<circle cx="50" cy="18.5" r="2.4" fill="${hue(348, 85, 62)}"/>` +
      `<circle cx="38.5" cy="19" r="1.6" fill="${hue(200, 85, 66)}"/>` +
      `<circle cx="61.5" cy="19" r="1.6" fill="${hue(200, 85, 66)}"/>`
  );
}

/**
 * The birthday decoration, in the two hues it was generated with.
 *
 * A dashed ring, confetti around it, and a party hat off the top corner — the
 * same vocabulary as the celebration overlay, so the frame someone wears on
 * the day and the thing that popped up that morning look related.
 */
export function birthdayDecorationSrc(hueA: number, hueB: number): string {
  const confetti = squircleRing(9, CONFETTI_RADIUS, -70)
    .map(({ x, y, index }) => {
      const colour = index % 2 === 0 ? hue(hueA, 90, 66) : hue(hueB, 90, 70);
      // Squares and dots in turn, each tipped a different way.
      if (index % 3 === 0) {
        return `<circle cx="${round(x)}" cy="${round(y)}" r="2.4" fill="${colour}"/>`;
      }
      const tilt = (index * 37) % 90;
      return `<rect x="-2" y="-2.8" width="4" height="5.6" rx="1" fill="${colour}" transform="translate(${round(
        x
      )} ${round(y)}) rotate(${tilt})"/>`;
    })
    .join("");

  const hat =
    `<g transform="translate(76 16) rotate(28)">` +
    `<path d="M0,-13 L7.5,9 L-7.5,9 Z" fill="${hue(hueA, 90, 62)}"/>` +
    `<path d="M-4.6,-1 L4.6,-1 L5.7,2.2 L-5.7,2.2 Z" fill="${hue(hueB, 90, 74)}"/>` +
    `<path d="M-6.6,5 L6.6,5 L7.5,9 L-7.5,9 Z" fill="${hue(hueB, 90, 74)}"/>` +
    `<circle cx="0" cy="-14.5" r="3" fill="${hue(hueB, 95, 80)}"/>` +
    `</g>`;

  return svg(
    `<rect x="${RING_INSET}" y="${RING_INSET}" width="${100 - RING_INSET * 2}" height="${
      100 - RING_INSET * 2
    }" rx="${SQUIRCLE_R(RING_INSET)}" stroke="${hue(
      hueA,
      90,
      64
    )}" stroke-width="3.2" stroke-dasharray="7 8" stroke-linecap="round"/>` +
      confetti +
      hat
  );
}

/** What the picker offers, in the order it offers it. */
export const DECORATION_PRESETS: DecorationPreset[] = [
  { key: "aurora", name: "Aurora ring", value: "builtin:aurora", src: auroraRing() },
  { key: "sparkles", name: "Sparkles", value: "builtin:sparkles", src: sparkles() },
  { key: "hearts", name: "Hearts", value: "builtin:hearts", src: hearts() },
  { key: "crown", name: "Crown", value: "builtin:crown", src: crown() },
];

const PRESET_BY_KEY = new Map(DECORATION_PRESETS.map((p) => [p.key, p]));

/**
 * The image a stored decoration value should render as, or `undefined` for no
 * decoration.
 *
 * An unrecognised value is nothing rather than a broken image: the preset
 * catalogue is presentation, so a key written by a newer build than this one
 * should leave the avatar plain instead of a missing-picture box around it.
 */
export function decorationSrc(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  if (value.startsWith("builtin:")) {
    return PRESET_BY_KEY.get(value.slice("builtin:".length))?.src;
  }

  if (value.startsWith("birthday:")) {
    const [a, b] = value.slice("birthday:".length).split("-");
    const hueA = Number(a);
    const hueB = Number(b);
    if (Number.isFinite(hueA) && Number.isFinite(hueB)) {
      return birthdayDecorationSrc(hueA, hueB);
    }
    return undefined;
  }

  // A custom upload. Only ever a Convex storage URL in practice, but anything
  // that isn't http(s) is refused rather than handed to `src` — a stored
  // `javascript:`/`data:` value should not become markup we render.
  return /^https?:\/\//.test(value) ? value : undefined;
}

/**
 * The decoration and birthday state of the *signed-in* user, worked out from
 * their own raw user document.
 *
 * Everyone else arrives pre-resolved: the queries that return other people run
 * this decision server-side (convex/lib/birthday.ts) so a viewer can't be told
 * a different answer than their neighbour. Your own card reads the document
 * directly, though — the same reason it applies the custom-status deadline
 * itself — so the same rule has to exist here. Change one, change the other.
 *
 * The birthday one wins while it lasts, and `birthdayUntil` is local midnight
 * as claimed by this client on the day (see BirthdayProvider), which is why
 * this can be a plain comparison rather than any date arithmetic.
 */
export function ownDecorationState(
  me:
    | {
        dob?: string;
        avatarDecoration?: string;
        birthdayDecoration?: string;
        birthdayUntil?: number;
      }
    | null
    | undefined
): { decoration: string | undefined; isBirthday: boolean } {
  if (!me) return { decoration: undefined, isBirthday: false };
  // Decided from the date of birth rather than from `birthdayUntil`, even
  // though the claim is what everyone *else* goes by. The stamp is a claim
  // about a date, and a date that has since been edited or cleared leaves it
  // pointing at nothing; asking the date directly can't drift from it. It also
  // means your own cake is there the moment the day starts rather than one
  // round trip later.
  const isBirthday = isBirthdayToday(me.dob);
  return {
    decoration: (isBirthday ? me.birthdayDecoration : undefined) ?? me.avatarDecoration,
    isBirthday,
  };
}

/**
 * Whether a `YYYY-MM-DD` date of birth falls on today's *local* date.
 *
 * Local, because a birthday belongs to the day the person having it is
 * living in. A 29 February birthday lands on 1 March in a common year, which
 * is `Date`'s own rollover rather than a decision made here — and is what
 * BirthdayProvider and convex/lib/birthday.ts both do too.
 */
function isBirthdayToday(dob: string | undefined, now: Date = new Date()): boolean {
  if (!dob) return false;
  const [, month, day] = dob.split("-");
  const monthIndex = Number(month) - 1;
  const dayOfMonth = Number(day);
  if (Number.isNaN(monthIndex) || Number.isNaN(dayOfMonth)) return false;
  const occurrence = new Date(now.getFullYear(), monthIndex, dayOfMonth);
  return (
    occurrence.getMonth() === now.getMonth() && occurrence.getDate() === now.getDate()
  );
}

/** Whether a stored value is the user's own upload rather than a preset. */
export function isCustomDecoration(value: string | null | undefined): boolean {
  return !!value && /^https?:\/\//.test(value);
}
