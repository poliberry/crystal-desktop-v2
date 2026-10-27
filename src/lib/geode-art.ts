/**
 * Artwork for the Geode badge — one picture per gem, and the standard mark.
 *
 * Drawn from code as SVG, like the avatar-decoration presets (src/lib/avatar-decorations.ts): a few hundred bytes each, no
 * network (this is a desktop app that may never have one), and nothing to host or keep in step with a release.
 *
 * ## One cut per gem
 *
 * The eight tiers are not one shape in eight colours. At the size a badge is drawn — sixteen pixels in the pill on a profile —
 * colour alone is the first thing to blur, so each tier is cut differently and the silhouette tells them apart at a glance:
 *
 *   Quartz     a single hexagonal point
 *   Amethyst   a cluster of three points
 *   Citrine    a square cushion cut, seen from above
 *   Topaz      the classic side-on gem
 *   Sapphire   an oval brilliant
 *   Emerald    a step cut, octagonal
 *   Ruby       a heart
 *   Opal       a polished dome with colour moving through it
 *
 * The standard Geode picture is not drawn here: it is the Crystal logo itself (see `GeodeMark` in src/components/geode.tsx).
 */

import { GEODE_TIERS, geodeTierByKey } from "../../convex/lib/geode";

type Point = readonly [number, number];

/** Five tones, light to dark, that every facet is picked from. */
interface Palette {
  hi: string;
  light: string;
  mid: string;
  dark: string;
  deep: string;
}

const PALETTES: Record<string, Palette> = {
  quartz: { hi: "#ffffff", light: "#ebe7f7", mid: "#cdc5e8", dark: "#9f95cd", deep: "#4f4780" },
  amethyst: { hi: "#f3e8ff", light: "#c98bfb", mid: "#a24ef0", dark: "#7424c4", deep: "#34065f" },
  citrine: { hi: "#fffbd0", light: "#fde85a", mid: "#f9c80e", dark: "#c98a04", deep: "#6b3a0b" },
  topaz: { hi: "#ffeed9", light: "#fdb978", mid: "#f98f3c", dark: "#e0560c", deep: "#74290f" },
  sapphire: { hi: "#dbeafe", light: "#6aa8fa", mid: "#2b63ea", dark: "#1d3a96", deep: "#0f1f55" },
  emerald: { hi: "#d3fbe6", light: "#6fe8b1", mid: "#12b97f", dark: "#07775a", deep: "#02302a" },
  ruby: { hi: "#ffd0d8", light: "#fb7088", mid: "#e11f4a", dark: "#98123c", deep: "#4a0519" },
  opal: { hi: "#ffffff", light: "#cfeefe", mid: "#c9b7fb", dark: "#8c78c9", deep: "#3f2f73" },
};

const n = (value: number) => Math.round(value * 100) / 100;

const pts = (points: readonly Point[]) => points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");

/** A facet: filled, with the gem's darkest tone as the seam between facets. */
function facet(points: readonly Point[], fill: string, seam: string, width = 1.1): string {
  return `<polygon points="${pts(points)}" fill="${fill}" stroke="${seam}" stroke-width="${width}" stroke-linejoin="round"/>`;
}

/** A four-pointed twinkle, for the higher tiers. */
function twinkle(cx: number, cy: number, r: number, fill = "#ffffff"): string {
  const k = r * 0.22;
  return `<path d="M${n(cx)},${n(cy - r)} C${n(cx + k)},${n(cy - k)} ${n(cx + k)},${n(cy - k)} ${n(cx + r)},${n(cy)} C${n(cx + k)},${n(cy + k)} ${n(cx + k)},${n(cy + k)} ${n(cx)},${n(cy + r)} C${n(cx - k)},${n(cy + k)} ${n(cx - k)},${n(cy + k)} ${n(cx - r)},${n(cy)} C${n(cx - k)},${n(cy - k)} ${n(cx - k)},${n(cy - k)} ${n(cx)},${n(cy - r)} Z" fill="${fill}"/>`;
}

function svg(body: string, defs = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
}

// --- Quartz & Amethyst: points ------------------------------------------------

/**
 * One hexagonal crystal point, standing on (32, 58): three faces on the shaft, three on the tip. Light from the upper left,
 * so the left reads brightest and the right falls away.
 */
function prism(p: Palette, transform = ""): string {
  const body = [
    facet([[20, 26], [28, 26], [28, 58], [20, 58]], p.mid, p.deep),
    facet([[28, 26], [36, 26], [36, 58], [28, 58]], p.light, p.deep),
    facet([[36, 26], [44, 26], [44, 58], [36, 58]], p.dark, p.deep),
    facet([[20, 26], [28, 26], [32, 6]], p.light, p.deep),
    facet([[28, 26], [36, 26], [32, 6]], p.hi, p.deep),
    facet([[36, 26], [44, 26], [32, 6]], p.mid, p.deep),
  ].join("");
  return transform ? `<g transform="${transform}">${body}</g>` : body;
}

/** Scale and tilt a crystal about its foot, then slide it sideways. */
function leaning(dx: number, angle: number, scale: number): string {
  return `translate(${dx} 0) translate(32 58) rotate(${angle}) scale(${scale}) translate(-32 -58)`;
}

function quartz(): string {
  const p = PALETTES.quartz;
  return svg(prism(p) + twinkle(50, 14, 5.5, p.hi));
}

function amethyst(): string {
  const p = PALETTES.amethyst;
  return svg(prism(p, leaning(-11, -24, 0.78)) + prism(p, leaning(11, 26, 0.68)) + prism(p, leaning(0, 0, 0.94)));
}

// --- Citrine: cushion cut -----------------------------------------------------

function citrine(): string {
  const p = PALETTES.citrine;
  const clip = `<clipPath id="c"><rect x="6" y="6" width="52" height="52" rx="13"/></clipPath>`;
  const body = `<g clip-path="url(#c)">${[
    facet([[0, 0], [64, 0], [42, 22], [22, 22]], p.light, p.dark),
    facet([[64, 0], [64, 64], [42, 42], [42, 22]], p.mid, p.dark),
    facet([[64, 64], [0, 64], [22, 42], [42, 42]], p.dark, p.deep),
    facet([[0, 64], [0, 0], [22, 22], [22, 42]], p.light, p.dark),
    facet([[22, 22], [42, 22], [42, 42], [22, 42]], p.hi, p.dark),
  ].join("")}</g><rect x="6" y="6" width="52" height="52" rx="13" stroke="${p.deep}" stroke-width="1.6"/>`;
  return svg(body + twinkle(46, 17, 4.5, "#ffffff"), clip);
}

// --- Topaz: the side-on gem ---------------------------------------------------

function topaz(): string {
  const p = PALETTES.topaz;
  return svg(
    [
      facet([[8, 24], [20, 9], [26, 24]], p.light, p.deep),
      facet([[20, 9], [44, 9], [38, 24], [26, 24]], p.hi, p.deep),
      facet([[44, 9], [56, 24], [38, 24]], p.mid, p.deep),
      facet([[8, 24], [26, 24], [32, 58]], p.mid, p.deep),
      facet([[26, 24], [38, 24], [32, 58]], p.light, p.deep),
      facet([[38, 24], [56, 24], [32, 58]], p.dark, p.deep),
    ].join("") + twinkle(51, 11, 4.5),
  );
}

// --- Sapphire: oval brilliant -------------------------------------------------

/** A ring of `count` points on an ellipse, starting at the top. */
function ellipseRing(cx: number, cy: number, rx: number, ry: number, count: number): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as const;
  });
}

/** Pick a tone for a facet from how squarely it faces the light (upper left). */
function toneFor(p: Palette, angle: number): string {
  const lit = (Math.cos(angle - (-3 * Math.PI) / 4) + 1) / 2; // 0 (away) … 1 (toward)
  if (lit > 0.82) return p.hi;
  if (lit > 0.55) return p.light;
  if (lit > 0.28) return p.mid;
  return p.dark;
}

/** The band of facets between two matching rings. */
function ringFacets(outer: readonly Point[], inner: readonly Point[], p: Palette, seam: string, stagger = 0): string {
  const count = outer.length;
  return outer
    .map((_, i) => {
      const j = (i + 1) % count;
      const mid = ((i + 0.5) / count) * Math.PI * 2 - Math.PI / 2;
      // Alternate facets step a tone, so the band reads as cut stone rather than a smooth gradient.
      const tone = (i + stagger) % 2 === 0 ? toneFor(p, mid) : toneFor(p, mid + 0.55);
      return facet([outer[i], outer[j], inner[j], inner[i]], tone, seam, 0.9);
    })
    .join("");
}

function sapphire(): string {
  const p = PALETTES.sapphire;
  const cx = 32;
  const cy = 32;
  const outer = ellipseRing(cx, cy, 25, 21, 12);
  const middle = ellipseRing(cx, cy, 18, 14.5, 12);
  const inner = ellipseRing(cx, cy, 10, 8, 12);
  return svg(
    ringFacets(outer, middle, p, p.deep) +
      ringFacets(middle, inner, p, p.deep, 1) +
      facet(inner, p.hi, p.deep, 0.9) +
      twinkle(47, 16, 5) +
      twinkle(16, 45, 3, p.light),
  );
}

// --- Emerald: step cut --------------------------------------------------------

/** An octagon with clipped corners, drawn `inset` units in. */
function octagon(inset: number): Point[] {
  const x0 = 11 + inset;
  const x1 = 53 - inset;
  const y0 = 5 + inset * 1.15;
  const y1 = 59 - inset * 1.15;
  const c = Math.max(3, 11 - inset * 0.7);
  return [
    [x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c],
    [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c],
  ];
}

function emerald(): string {
  const p = PALETTES.emerald;
  const rings = [octagon(0), octagon(7), octagon(14)];
  // Edge order: top, top-right corner, right, bottom-right corner, bottom, bottom-left corner, left, top-left corner.
  const outerTones = [p.light, p.mid, p.dark, p.dark, p.dark, p.mid, p.light, p.hi];
  const innerTones = [p.hi, p.light, p.mid, p.dark, p.mid, p.light, p.hi, p.hi];
  const band = (outer: readonly Point[], inner: readonly Point[], tones: string[]) =>
    outer
      .map((_, i) => {
        const j = (i + 1) % outer.length;
        return facet([outer[i], outer[j], inner[j], inner[i]], tones[i], p.deep, 0.9);
      })
      .join("");
  return svg(band(rings[0], rings[1], outerTones) + band(rings[1], rings[2], innerTones) + facet(rings[2], p.hi, p.deep, 0.9) + twinkle(48, 14, 4.5));
}

// --- Ruby: heart --------------------------------------------------------------

const HEART = "M32 58 L8 32 C1 24 4 9 18 9 C25 9 30 13 32 18 C34 13 39 9 46 9 C60 9 63 24 56 32 Z";

function ruby(): string {
  const p = PALETTES.ruby;
  const clip = `<clipPath id="h"><path d="${HEART}"/></clipPath>`;
  const inside = [
    facet([[0, 0], [32, 0], [32, 18], [19, 20]], p.light, p.deep, 0.9),
    facet([[0, 0], [19, 20], [24, 34], [0, 41]], p.mid, p.deep, 0.9),
    facet([[0, 41], [24, 34], [32, 58], [32, 64], [0, 64]], p.mid, p.deep, 0.9),
    facet([[32, 0], [64, 0], [45, 20], [32, 18]], p.mid, p.deep, 0.9),
    facet([[64, 0], [64, 41], [40, 34], [45, 20]], p.dark, p.deep, 0.9),
    facet([[64, 41], [64, 64], [32, 64], [32, 58], [40, 34]], p.dark, p.deep, 0.9),
    facet([[19, 20], [32, 18], [45, 20], [40, 34], [24, 34]], p.hi, p.deep, 0.9),
    facet([[24, 34], [40, 34], [32, 58]], p.light, p.deep, 0.9),
  ].join("");
  return svg(`<g clip-path="url(#h)">${inside}</g><path d="${HEART}" stroke="${p.deep}" stroke-width="1.7" stroke-linejoin="round"/>` + twinkle(49, 17, 4.5), clip);
}

// --- Opal: polished dome ------------------------------------------------------

function opal(): string {
  const p = PALETTES.opal;
  const defs = [
    `<linearGradient id="o" x1="10" y1="10" x2="54" y2="56" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0" stop-color="#9ff0f5"/><stop offset=".28" stop-color="#c3b2fb"/>` +
      `<stop offset=".55" stop-color="#f8a8d2"/><stop offset=".78" stop-color="#fde68a"/>` +
      `<stop offset="1" stop-color="#7fe8b4"/></linearGradient>`,
    `<radialGradient id="g" cx="32" cy="32" r="32" gradientUnits="userSpaceOnUse">` +
      `<stop offset=".5" stop-color="#e5d9ff" stop-opacity=".55"/><stop offset="1" stop-color="#e5d9ff" stop-opacity="0"/></radialGradient>`,
    `<clipPath id="d"><ellipse cx="32" cy="34" rx="25" ry="21"/></clipPath>`,
  ].join("");
  const fire = [
    `<ellipse cx="22" cy="40" rx="9" ry="5" fill="#34d6ff" opacity=".55" transform="rotate(-24 22 40)"/>`,
    `<ellipse cx="41" cy="30" rx="10" ry="5.5" fill="#ff7ad1" opacity=".5" transform="rotate(30 41 30)"/>`,
    `<ellipse cx="33" cy="46" rx="8" ry="3.5" fill="#ffd45e" opacity=".55"/>`,
    `<ellipse cx="28" cy="27" rx="6" ry="3" fill="#7cffb8" opacity=".5" transform="rotate(-12 28 27)"/>`,
  ].join("");
  return svg(
    `<circle cx="32" cy="32" r="32" fill="url(#g)"/>` +
      `<ellipse cx="32" cy="34" rx="25" ry="21" fill="url(#o)"/>` +
      `<g clip-path="url(#d)">${fire}` +
      // The dome's own shading: dark at the lower right, a soft bloom top left.
      `<ellipse cx="42" cy="50" rx="30" ry="16" fill="${p.deep}" opacity=".28"/>` +
      `<ellipse cx="22" cy="22" rx="12" ry="6.5" fill="#ffffff" opacity=".75" transform="rotate(-28 22 22)"/></g>` +
      `<ellipse cx="32" cy="34" rx="25" ry="21" stroke="${p.deep}" stroke-width="1.7"/>` +
      twinkle(52, 12, 6) +
      twinkle(11, 14, 3.5),
    defs,
  );
}

// --- Public -------------------------------------------------------------------

const BUILDERS: Record<string, () => string> = { quartz, amethyst, citrine, topaz, sapphire, emerald, ruby, opal };

const asDataUri = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

const markupCache = new Map<string, string>();

/** The SVG markup for one gem, by tier key. Undefined for a key this build doesn't know — a badge from a newer build, which
 * draws as nothing. */
export function geodeGemSvg(key: string): string | undefined {
  const cached = markupCache.get(key);
  if (cached) return cached;
  const build = BUILDERS[key];
  if (!build) return undefined;
  const markup = build();
  markupCache.set(key, markup);
  return markup;
}

/** The gem as an `<img>` source. */
export function geodeGemSrc(key: string): string | undefined {
  const markup = geodeGemSvg(key);
  return markup ? asDataUri(markup) : undefined;
}

/** Every gem this module draws, by file stem — what the tests walk. */
export function allGeodeArt(): { name: string; svg: string }[] {
  return [...GEODE_TIERS.map((tier) => ({ name: `geode-${tier.key}`, svg: geodeGemSvg(tier.key) ?? "" }))];
}

/** The ladder, for places that show every gem. */
export function geodeLadder() {
  return GEODE_TIERS.map((tier) => ({ ...tier, src: geodeGemSrc(tier.key) as string }));
}

export { geodeTierByKey };
