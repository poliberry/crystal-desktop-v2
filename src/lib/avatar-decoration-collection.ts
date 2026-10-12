/**
 * The Archive collection's avatar decorations.
 *
 * Twelve decorations drawn in code as SVG, in two forms of each:
 *
 *  - `src`, a **still** data URI: what the app draws for the `builtin:<key>` form (a build that has this file), and what the
 *    shop and tests use. It carries no animation.
 *  - `animatedSvg`, the same artwork with SMIL animation (`<animate>`, `<animateTransform>`, `<animateMotion>`). That is what is
 *    **published to the CDN** (`convex/cosmeticCollection.ts`), and what the SKUs point at.
 *
 * The SKUs point at CDN files rather than at `builtin:` keys because a key is only drawn by builds that contain this file: an
 * older build resolves an unknown key to nothing, so an owner would equip a decoration and see no change. A CDN address is drawn
 * by every build. It also gets the app's treatment of animated pictures for free: `useStaticFrame` holds a remote image on its
 * first frame in lists and plays it when the avatar is hovered or on a card about one person.
 *
 * Because of that, the first frame of an animated version has to be the still: every animation starts from the resting
 * artwork's own attribute values, and nothing starts hidden.
 *
 * ## How they are lit
 *
 * Flat fills with an even outline are what make vector art read as clip-art, so none of these use that. Each piece is lit from
 * the top left: a form is split into a lit and a shaded facet (or has a gradient across it), edges carry a thin rim light on the
 * lit side only, glossy things get a specular highlight, glowing things get a blurred copy under them, and the whole piece
 * casts a soft shadow onto the avatar. Outlines, where there are any, are a darker shade of the fill and never black.
 *
 * Same canvas as the starter set: a 100 × 100 viewBox laid over a box 126% as wide as the avatar, so the avatar is the middle
 * 76 units (12 to 88) and is a rounded square (about a fifth of its width). All original artwork, from primitives.
 */

import type { RefractionKind } from "@/lib/decoration-refraction";

export interface CollectionPreset {
  key: string;
  name: string;
  /** The stored value of the in-app form. */
  value: string;
  /** A still, as a data URI. */
  src: string;
  /** The same artwork animated, as SVG markup: what is published. */
  animatedSvg: string;
  /** What the animation is, for the shop's description and the tests. */
  motion: string;
  /** Set when the artwork is meant to bend the picture behind it (see `decoration-refraction.ts`). */
  refract?: RefractionKind;
}

const AV_MIN = 12;
const AV_MAX = 88;
const AV_R = 15.2;

const n = (x: number) => Math.round(x * 100) / 100;

/** One builder draws both forms: `a` is whether to include animation. */
type Draw = (a: boolean) => { body: string; defs?: string };

const wrap = (body: string, defs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100" fill="none">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
const dataUri = (markup: string) => `data:image/svg+xml,${encodeURIComponent(markup)}`;

/** A small deterministic generator, so a piece is the same every time it is drawn. */
function rnd(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// --- Animation helpers ----------------------------------------------------------------------------------------------------

interface Timing {
  dur: number;
  /** Seconds to start by: negative starts part-way through, so copies don't move in step. */
  begin?: number;
  keyTimes?: string;
}
const timing = ({ dur, begin, keyTimes }: Timing) => `dur="${dur}s"${begin ? ` begin="${begin}s"` : ""}${keyTimes ? ` keyTimes="${keyTimes}"` : ""} repeatCount="indefinite"`;
/** A property changing through `values` and back, smoothly. */
const animate = (attr: string, values: string, t: Timing) => `<animate attributeName="${attr}" values="${values}" ${timing(t)}${t.keyTimes ? "" : ` calcMode="spline" keySplines="${values.split(";").slice(1).map(() => ".45 0 .55 1").join(";")}" keyTimes="${values.split(";").map((_, i, all) => n(i / (all.length - 1))).join(";")}"`}/>`;
const animateT = (type: "translate" | "scale" | "rotate", values: string, t: Timing) => `<animateTransform attributeName="transform" type="${type}" values="${values}" ${timing(t)}/>`;

// --- Shared pieces --------------------------------------------------------------------------------------------------------

/** Points spaced round a rounded square (an angle alone drifts in at the corners). `out` is the angle pointing away from the middle, 0 = up. */
function squircle(count: number, radius: number, startDeg = -90) {
  return Array.from({ length: count }, (_, i) => {
    const a = ((startDeg + (360 / count) * i) * Math.PI) / 180;
    const project = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
    const x = 50 + project(Math.cos(a)) * radius;
    const y = 50 + project(Math.sin(a)) * radius;
    const out = (Math.atan2(y - 50, x - 50) * 180) / Math.PI + 90;
    return { x: n(x), y: n(y), out: n(out), i };
  });
}

const stops = (list: [number, string, number?][]) => list.map(([o, c, op]) => `<stop offset="${o}" stop-color="${c}"${op !== undefined ? ` stop-opacity="${op}"` : ""}/>`).join("");
/** A linear gradient in the shape's own box (`objectBoundingBox`). */
const lin = (id: string, list: [number, string, number?][], dir: [number, number, number, number] = [0, 0, 0, 1]) => `<linearGradient id="${id}" x1="${dir[0]}" y1="${dir[1]}" x2="${dir[2]}" y2="${dir[3]}">${stops(list)}</linearGradient>`;
/** A linear gradient in the drawing's coordinates, for forms that are rotated or mirrored and must still be lit from one side. */
const linU = (id: string, list: [number, string, number?][], x1: number, y1: number, x2: number, y2: number) => `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops(list)}</linearGradient>`;
const rad = (id: string, list: [number, string, number?][], cx = 0.5, cy = 0.5, r = 0.5, fx?: number, fy?: number) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${fx !== undefined ? ` fx="${fx}" fy="${fy}"` : ""}>${stops(list)}</radialGradient>`;

const blurF = (id: string, sd: number) => `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
/** A soft shadow beneath a piece, lifting it off the avatar. */
const shadowF = (id = "ds", dy = 1.2, sd = 1.1, op = 0.5) => `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${sd}" flood-color="#0a0518" flood-opacity="${op}"/></filter>`;
/** A coloured halo that follows the artwork's shape. */
const haloF = (id: string, color: string, sd = 1.4) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur in="SourceAlpha" stdDeviation="${sd}" result="b"/><feFlood flood-color="${color}" result="c"/><feComposite in="c" in2="b" operator="in" result="h"/><feMerge><feMergeNode in="h"/><feMergeNode in="h"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

const squircleRect = (inset: number, extra = "") => `<rect x="${inset}" y="${inset}" width="${100 - inset * 2}" height="${100 - inset * 2}" rx="${n((100 - inset * 2) * 0.2)}" ${extra}/>`;
const mirrorX = (body: string) => `<g transform="translate(100 0) scale(-1 1)">${body}</g>`;

/** A mask that hides the avatar's square, so something can pass "behind" the picture. */
const behindAvatar = (id: string) => `<mask id="${id}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="140"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/><rect x="${AV_MIN}" y="${AV_MIN}" width="${AV_MAX - AV_MIN}" height="${AV_MAX - AV_MIN}" rx="${AV_R}" fill="#000"/></mask>`;

const SPARK = "M0,-6 C.7,-1.8 1.8,-.7 6,0 C1.8,.7 .7,1.8 0,6 C-.7,1.8 -1.8,.7 -6,0 C-1.8,-.7 -.7,-1.8 0,-6 Z";
/** A four-pointed glint at a point that swells and fades, out of step with its neighbours, with a soft bloom under it. */
const glint = (a: boolean, x: number, y: number, s: number, t: Timing, fill = "#ffffff", bloom = "#ffffff") =>
  `<g transform="translate(${x} ${y})"><circle r="${n(s * 3.2)}" fill="${bloom}" opacity=".28" filter="url(#bloomB)">${a ? animate("opacity", ".28;.5;.12;.28", t) : ""}</circle>` +
  `<path d="${SPARK}" fill="${fill}" transform="scale(${s})">${a ? animateT("scale", `${s};${n(s * 1.35)};${n(s * 0.45)};${s}`, t) + animate("opacity", "1;.95;.25;1", t) : ""}</path></g>`;
const BLOOM = blurF("bloomB", 1.3);

// --- Cat ears: flat anime style: a leaf-shaped cream ear with a scalloped pink inside, a pearl at the base, whiskers --------------

/** The ear is a leaf: it grows from a pearl at the base, sweeps up the outside in one smooth curve and ends in a sharp point. */
const EAR_OUT = "M9,34 C8.4,26 8.6,17 10.4,11.6 C16,9.4 26,8.4 36,9.6 C30,15.4 18.4,25.8 9,34 Z";
const EAR_IN = "M11.2,31.4 C10.8,25 11,18 12.4,13.6 C17.4,12 25,11 31.8,11.6 C26.4,16.2 18.2,23.8 11.2,31.4 Z";
/** The deeper pink, with a scalloped edge along the inner side: the layered, bumpy look anime ears have. */
const EAR_DEEP = "M12.4,29.8 C11.9,25.6 12,21 12.9,17.2 Q15.2,17.4 15.7,19.2 Q18,19.2 18.3,21.2 Q20.4,21.6 20.2,23.6 Q22.1,24.2 21.5,26.1 Q18,29 12.4,29.8 Z";

/** A whisker: a tapered stroke, thick where it leaves the face and fine at the tip. */
function whisker(tipX: number, tipY: number, baseX: number, baseY: number, width: number): string {
  const dx = baseX - tipX;
  const dy = baseY - tipY;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  const bow = len * 0.06;
  return `<path d="M${tipX},${tipY} Q${n((tipX + baseX) / 2 + nx * 0.2)},${n((tipY + baseY) / 2 + ny * 0.2 - bow)} ${n(baseX + nx)},${n(baseY + ny)} L${n(baseX - nx)},${n(baseY - ny)} Q${n((tipX + baseX) / 2 - nx * 0.2)},${n((tipY + baseY) / 2 - ny * 0.2 - bow)} ${tipX},${tipY} Z" fill="#15121c"/>`;
}

const catEars: Draw = (a) => {
  const ear = (begin: number) =>
    `<g>${a ? animateT("rotate", "0 9 34;-6 9 34;3 9 34;0 9 34;0 9 34", { dur: 5, begin, keyTimes: "0;.05;.1;.15;1" }) : ""}` +
    `<path d="${EAR_OUT}" fill="#fff6f1"/>` +
    `<path d="${EAR_IN}" fill="#f9bcd8"/>` +
    `<path d="${EAR_DEEP}" fill="#e57fb6"/>` +
    `<path d="${EAR_OUT}" stroke="#8a5a66" stroke-width=".7" stroke-linejoin="round"/>` +
    `<path d="M10.4,29 C9.8,23 10,17 11.6,12.6" stroke="#fff" stroke-width=".5" stroke-linecap="round" opacity=".7"/>` +
    // The pearl where the ear meets the head.
    `<g transform="translate(9 34)"><circle r="1.75" fill="#fff" stroke="#b79aa6" stroke-width=".4"/><circle cx="-.5" cy="-.55" r=".5" fill="#fde7f1"/>${a ? glintOnly(begin) : ""}</g></g>`;
  const whiskers = (begin: number) =>
    `<g>${a ? animateT("rotate", "0 16 55;-2.6 16 55;1.4 16 55;0 16 55;0 16 55", { dur: 4.2, begin, keyTimes: "0;.07;.14;.2;1" }) : ""}` +
    whisker(2.6, 51.2, 15.4, 51.6, 1.7) + whisker(2, 55.8, 15.4, 56.4, 1.8) + whisker(3.6, 64, 14.6, 58.6, 1.7) + `</g>`;
  return {
    body: ear(-0.2) + mirrorX(ear(-2.6)) + whiskers(-0.8) + mirrorX(whiskers(-2.1)),
    defs: BLOOM,
  };
};
/** A tiny star-twinkle on a pearl, as a bare string so it can sit inside a transformed group. */
function glintOnly(begin: number): string {
  return `<path d="${SPARK}" fill="#fff" transform="scale(.4)" opacity="0">${animate("opacity", "0;0;1;0;0", { dur: 3.4, begin, keyTimes: "0;.5;.56;.64;1" })}</path>`;
}

// --- Halo: a lit gold torus, a slow hover and a pulse of light ----------------------------------------------------------------

const halo: Draw = (a) => ({
  body:
    `<g>${a ? animateT("translate", "0 0;0 1.4;0 0", { dur: 3.2 }) : ""}` +
    // The glow it throws: a wide soft one and a tighter one, which pulse.
    `<ellipse cx="50" cy="8.6" rx="25" ry="8.4" fill="url(#hglow)" opacity=".9">${a ? animate("opacity", ".7;1;.7", { dur: 3.2 }) : ""}</ellipse>` +
    `<ellipse cx="50" cy="8.5" rx="22.4" ry="5.8" stroke="#ffb524" stroke-width="6.5" opacity=".42" filter="url(#hblur)"/>` +
    // The far side of the ring, seen through the near side, then the near side: a torus has a back and a front.
    `<path d="M28,7.4 A22,5.6 0 0 1 72,7.4" stroke="#a8620c" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>` +
    `<g filter="url(#ds)"><ellipse cx="50" cy="8.6" rx="22" ry="5.6" stroke="url(#hring)" stroke-width="3.6"/></g>` +
    `<path d="M29.6,6.6 A21.4,4.8 0 0 1 70.4,6.6" stroke="url(#hlight)" stroke-width=".95" stroke-linecap="round"/>` +
    `<path d="M32,11.2 A19,4.2 0 0 0 68,11.2" stroke="#8c4d06" stroke-width=".7" stroke-linecap="round" opacity=".55"/></g>` +
    glint(a, 23, 12.4, 0.72, { dur: 2.4 }, "#fffbe6", "#ffd45a") + glint(a, 79, 5.2, 0.55, { dur: 2.9, begin: -1 }, "#fffbe6", "#ffd45a") + glint(a, 86, 19, 0.4, { dur: 2.1, begin: -1.6 }, "#fffbe6", "#ffd45a"),
  defs:
    shadowF("ds", 1.2, 0.9, 0.5) + BLOOM + blurF("hblur", 2.6) +
    rad("hglow", [[0, "#ffe27a", 0.55], [0.55, "#ffb524", 0.2], [1, "#ffb524", 0]]) +
    lin("hring", [[0, "#9a5a0a"], [0.18, "#e9a62a"], [0.38, "#fff0a0"], [0.5, "#ffffff"], [0.62, "#ffd24a"], [0.82, "#d98f1c"], [1, "#8c4d06"]], [0, 0, 1, 0]) +
    lin("hlight", [[0, "#ffffff", 0], [0.3, "#ffffff", 0.95], [0.7, "#ffffff", 0.95], [1, "#ffffff", 0]], [0, 0, 1, 0]),
});

// --- Laurel wreath: two-tone leaves with veins, glossy berries ------------------------------------------------------------

const laurel: Draw = (a) => {
  const project = (v: number) => Math.sign(v) * Math.sqrt(Math.abs(v));
  const at = (t: number, r: number) => {
    const ang = ((113 + t * 132) * Math.PI) / 180;
    return { x: 50 + project(Math.cos(ang)) * r, y: 50 + project(Math.sin(ang)) * r, deg: (ang * 180) / Math.PI };
  };
  const r = rnd(9);
  const count = 13;
  let leaves = "";
  let stem = "";
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const size = 1.2 - t * 0.42;
    const base = at(t, 43);
    stem += `${i ? "L" : "M"}${n(base.x)},${n(base.y)} `;
    for (const side of [-1, 1]) {
      const p = at(t, 43 + side * 0.8);
      const rot = p.deg + 90 + side * (36 + (r() - 0.5) * 8);
      const id = (i + (side > 0 ? 1 : 0)) % 2 ? "leaf2" : "leaf";
      // A leaf that sways a little about where it joins the stem, in a wave that runs up the branch.
      leaves += `<g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${n(rot)}) scale(${n(size * (0.92 + r() * 0.16))})"><use xlink:href="#${id}">${a ? animateT("rotate", "0;5;0;-3;0", { dur: 4, begin: -(i * 0.22 + (side > 0 ? 0.5 : 0)) }) : ""}</use></g>`;
    }
  }
  const berries = [0.15, 0.27, 0.39, 0.51].map((t, k) => {
    const p = at(t, 40.6);
    return `<g transform="translate(${n(p.x)} ${n(p.y)})"><circle r="${n(2.3 - k * 0.14)}" fill="url(#berry)"/><ellipse cx="-.7" cy="-.8" rx=".7" ry=".45" fill="#fff" opacity=".85" transform="rotate(-30)"/></g>` + glint(a, n(p.x - 0.7), n(p.y - 0.8), 0.3, { dur: 2.6, begin: -k * 0.8 });
  }).join("");
  // A leaf is split down its midrib into a lit half and a shaded one, with veins on both, which is most of what makes it read as a leaf.
  const leafShape = (light: string, dark: string, edge: string) =>
    `<path d="M0,0 C3.8,-2.6 3.4,-8.6 0,-11.4 Z" fill="${light}"/><path d="M0,0 C-3.8,-2.6 -3.4,-8.6 0,-11.4 Z" fill="${dark}"/>` +
    `<path d="M0,-.6 L0,-10.2" stroke="${edge}" stroke-width=".45" stroke-linecap="round" opacity=".8"/>` +
    `<path d="M0,-3 L2.2,-4.7 M0,-5.2 L2.5,-6.9 M0,-7.4 L1.8,-8.8 M0,-3 L-2.1,-4.5 M0,-5.2 L-2.4,-6.7 M0,-7.4 L-1.7,-8.7" stroke="${edge}" stroke-width=".28" stroke-linecap="round" opacity=".5"/>` +
    `<path d="M0,0 C3.8,-2.6 3.4,-8.6 0,-11.4 C-3.4,-8.6 -3.8,-2.6 0,0 Z" stroke="${edge}" stroke-width=".35" stroke-linejoin="round" opacity=".7"/>`;
  const leaf = `<g id="leaf">${leafShape("#8fd668", "#3f8f45", "#1f5a2c")}</g><g id="leaf2">${leafShape("#b5e277", "#5aa44a", "#2b6a2c")}</g>`;
  const branch = `<g id="branch" filter="url(#ds)"><path d="${stem.trim()}" stroke="#2c6334" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="${stem.trim()}" stroke="#5aa05a" stroke-width=".5" stroke-linecap="round" stroke-linejoin="round" transform="translate(-.3 -.3)" opacity=".7"/>${leaves}${berries}</g>`;
  return {
    body: `<use xlink:href="#branch"/><use xlink:href="#branch" transform="translate(100 0) scale(-1 1)"/>`,
    defs: shadowF("ds", 1.1, 1, 0.5) + BLOOM + rad("berry", [[0, "#ff8d98"], [0.45, "#d8222f"], [1, "#6e0c18"]], 0.38, 0.32, 0.75) + leaf + branch,
  };
};

// --- Lightning corners: arcs of electricity round a glowing orb ---------------------------------------------------------------

const lightningCorners: Draw = (a) => {
  const arc = (pts: string, w: number) =>
    `<polyline points="${pts}" stroke="#2ab6ff" stroke-width="${n(w * 3.2)}" stroke-linejoin="round" stroke-linecap="round" opacity=".55" filter="url(#arcBlur)"/>` +
    `<polyline points="${pts}" stroke="#8fdcff" stroke-width="${n(w * 1.5)}" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<polyline points="${pts}" stroke="#ffffff" stroke-width="${n(w * 0.62)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  const corner = (begin: number) => {
    const flick = (values: string) => (a ? animate("opacity", values, { dur: 2.4, begin, keyTimes: "0;.5;.53;.57;.6;.64;1" }) : "");
    return (
      `<g>${flick("1;1;.25;1;.35;1;1")}` +
      // Two long arcs running along the edges from the orb, each with a short fork off it.
      arc("9,9 13.5,5.6 15.8,9.4 21,5.8 23.6,9.2 29,6.2 31.5,8.4 36,5.6", 1) +
      arc("9,9 5.6,13.5 9.4,15.8 5.8,21 9.2,23.6 6.2,29 8.4,31.5 5.6,36", 1) +
      arc("15.8,9.4 17.6,13.2 20.6,12.6", 0.6) + arc("9.4,15.8 13.2,17.6 12.6,20.6", 0.6) +
      `<circle cx="9" cy="9" r="7.5" fill="url(#orb)"/><circle cx="9" cy="9" r="2.1" fill="#ffffff"/>` +
      `<circle cx="27" cy="3.6" r=".8" fill="#fff"/><circle cx="3.6" cy="27" r=".8" fill="#fff"/><circle cx="19" cy="14.5" r=".6" fill="#cdeeff"/><circle cx="14.5" cy="19" r=".6" fill="#cdeeff"/>` +
      `</g>`
    );
  };
  return {
    body: `<g transform="translate(-1 -1)">${corner(0)}</g><g transform="translate(101 -1) scale(-1 1)">${corner(-0.6)}</g><g transform="translate(-1 101) scale(1 -1)">${corner(-1.2)}</g><g transform="translate(101 101) scale(-1 -1)">${corner(-1.8)}</g>`,
    defs: blurF("arcBlur", 1.5) + rad("orb", [[0, "#ffffff", 1], [0.25, "#bfeaff", 0.95], [0.6, "#2ab6ff", 0.4], [1, "#2ab6ff", 0]]),
  };
};

// --- Flame ring: layered flames over a glow of heat, with embers rising -------------------------------------------------------

const flameRing: Draw = (a) => {
  const r = rnd(21);
  const flames = squircle(22, 42.8, -90).map(({ x, y, out, i }) => {
    const s = (i % 2 ? 0.8 : 1.08) * (0.9 + r() * 0.24);
    const lean = (r() - 0.5) * 14;
    // Each flame stretches and narrows, then settles, a different moment from the one beside it.
    const lick = a ? animateT("scale", "1 1;.9 1.2;1.07 .93;1 1", { dur: 0.9 + (i % 3) * 0.17, begin: -(i * 0.23) }) : "";
    return `<g transform="translate(${x} ${y}) rotate(${n(out + lean)}) scale(${n(s)})"><use xlink:href="#flame">${lick}</use></g>`;
  }).join("");
  const embers = [[18, 11, 0], [83, 14, 1.1], [92, 49, 0.5], [86, 90, 1.7], [12, 84, 0.8], [50, 4, 1.4], [6, 40, 2.1], [95, 28, 0.3]].map(([x, y, b]) => {
    const fl = a ? animateT("translate", "0 0;-1 -7", { dur: 2.6, begin: -b }) + animate("opacity", "1;.9;0", { dur: 2.6, begin: -b, keyTimes: "0;.6;1" }) : "";
    return `<g><circle cx="${x}" cy="${y}" r=".95" fill="#ffd36a"/><circle cx="${x}" cy="${y}" r="2.2" fill="#ff8a1c" opacity=".4" filter="url(#bloomB)"/>${fl}</g>`;
  }).join("");
  const flame =
    `<g id="flame"><path d="M0,-12.5 C1.6,-8.4 5.4,-5.8 5.4,-.6 C5.4,4 3,7 0,7 C-3,7 -5.4,4 -5.4,-.6 C-5.4,-3.8 -3.4,-5.2 -2.2,-8.2 C-1.4,-6.6 -.4,-7.8 0,-12.5 Z" fill="url(#fOut)"/>` +
    `<path d="M0,-8.6 C1.2,-5.6 3.8,-3.8 3.8,-.2 C3.8,3 2,5.2 0,5.2 C-2,5.2 -3.8,3 -3.8,-.2 C-3.8,-2.6 -2.4,-3.6 -1.5,-5.6 C-1,-4.4 -.3,-5.4 0,-8.6 Z" fill="url(#fMid)"/>` +
    `<path d="M0,-4.6 C.7,-2.8 2,-1.8 2,.4 C2,2.2 1.1,3.4 0,3.4 C-1.1,3.4 -2,2.2 -2,.4 C-2,-1 -1.3,-1.7 0,-4.6 Z" fill="url(#fIn)"/></g>`;
  return {
    body:
      // The heat: a blurred orange ring hugging the avatar, then a thin hot line where the flames root.
      squircleRect(10.5, `stroke="#ff5a00" stroke-width="7" opacity=".5" filter="url(#heat)"`) +
      squircleRect(10.5, `stroke="url(#coals)" stroke-width="2.2"`) +
      `<g filter="url(#ds)">${flames}</g>${embers}`,
    defs:
      shadowF("ds", 0.8, 0.9, 0.35) + BLOOM + blurF("heat", 2.6) + flameDefs(),
  };

  function flameDefs() {
    return (
      lin("fOut", [[0, "#b3120f"], [0.45, "#f2531a"], [1, "#ffb02e"]], [0, 1, 0, 0]) +
      lin("fMid", [[0, "#f26a14"], [0.5, "#ffa21f"], [1, "#ffe066"]], [0, 1, 0, 0]) +
      lin("fIn", [[0, "#ffd24a"], [1, "#ffffff"]], [0, 1, 0, 0]) +
      lin("coals", [[0, "#ff9a3a"], [0.5, "#c4210f"], [1, "#ff7a1c"]], [0, 0, 1, 1]) +
      flame
    );
  }
};

// --- Frost: a glassy ring, faceted ice shards and snowflakes ---------------------------------------------------------------

const frost: Draw = (a) => {
  const r = rnd(33);
  const shards = squircle(14, 43.8, -90).map(({ x, y, out, i }) => {
    const long = i % 2 ? 0.78 : 1.18;
    return `<g transform="translate(${x} ${y}) rotate(${n(out + (r() - 0.5) * 10)}) scale(${n(0.9 * (0.85 + r() * 0.3))} ${n(long * (0.85 + r() * 0.3))})"><use xlink:href="#shard">${a ? animate("opacity", "1;.72;1", { dur: 2.2, begin: -(i * 0.3) }) : ""}</use></g>`;
  }).join("");
  let rime = "";
  for (const p of squircle(34, 42.6, -90)) {
    rime += `<circle cx="${n(p.x + (r() - 0.5) * 3)}" cy="${n(p.y + (r() - 0.5) * 3)}" r="${n(0.35 + r() * 0.5)}" fill="#fff" opacity="${n(0.5 + r() * 0.45)}"/>`;
  }
  const flakeAt = (x: number, y: number, s: number, begin: number) => `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#ds)"><use xlink:href="#flake">${a ? animateT("rotate", "0;60", { dur: 9, begin }) : ""}</use></g>`;
  const flake = `<g id="flake" stroke="#ffffff" stroke-linecap="round" fill="none">${[0, 60, 120, 180, 240, 300].map((rot) => `<g transform="rotate(${rot})"><path d="M0,0 L0,-7" stroke-width="1"/><path d="M0,-3 L-2.1,-5.1 M0,-3 L2.1,-5.1 M0,-5.2 L-1.3,-6.5 M0,-5.2 L1.3,-6.5" stroke-width=".65"/><circle cy="-7.4" r=".7" fill="#e6f8ff" stroke="none"/></g>`).join("")}<circle r="1.1" fill="#e6f8ff" stroke="none"/></g>`;
  // A shard is two facets, lit on the left and shaded on the right, with a white edge down the lit one.
  const shard =
    `<g id="shard"><path d="M0,-9.4 L-3.2,0 L0,2.6 Z" fill="url(#iceL)"/><path d="M0,-9.4 L3.2,0 L0,2.6 Z" fill="url(#iceR)"/>` +
    `<path d="M0,-9.4 L-3.2,0 L0,2.6 L3.2,0 Z" stroke="#dff6ff" stroke-width=".5" stroke-linejoin="round" opacity=".85"/>` +
    `<path d="M-.3,-7.4 L-1.9,-.6" stroke="#fff" stroke-width=".8" stroke-linecap="round" opacity=".9"/></g>`;
  return {
    body:
      squircleRect(10.5, `stroke="#46b9f0" stroke-width="6" opacity=".38" filter="url(#mist)"`) +
      squircleRect(10.5, `stroke="url(#glass)" stroke-width="3.2"`) +
      squircleRect(9.2, `stroke="#ffffff" stroke-width=".55" opacity=".85"`) +
      squircleRect(12.2, `stroke="#7fc8ef" stroke-width=".6" opacity=".7"`) +
      rime + `<g filter="url(#ds)">${shards}</g>` +
      flakeAt(8, 15, 0.62, 0) + flakeAt(93, 80, 0.74, -2) + flakeAt(91, 11, 0.46, -4) + flakeAt(7, 87, 0.5, -6) +
      glint(a, 50, 8, 0.6, { dur: 2.4 }, "#fff", "#8fdcff") + glint(a, 91, 50, 0.5, { dur: 2.8, begin: -1 }, "#fff", "#8fdcff") + glint(a, 9, 52, 0.5, { dur: 3, begin: -1.8 }, "#fff", "#8fdcff"),
    defs:
      shadowF("ds", 0.9, 0.8, 0.4) + BLOOM + blurF("mist", 2.2) + flake + shard +
      lin("iceL", [[0, "#ffffff"], [0.5, "#bfeaff"], [1, "#6cc4f0"]]) + lin("iceR", [[0, "#7fd0f5"], [0.6, "#3a8fd0"], [1, "#2a63ae"]]) +
      lin("glass", [[0, "#ffffff"], [0.3, "#bfeaff"], [0.55, "#7fd0f5"], [0.8, "#d8f4ff"], [1, "#ffffff"]], [0, 0, 1, 1]),
  };
};

// --- Cherry blossom: a bark branch, shaded blooms with stamens, petals blowing off ------------------------------------------

const blossom: Draw = (a) => {
  const bloom = (x: number, y: number, s: number, rot: number) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})" filter="url(#ds)"><use xlink:href="#bloom"/></g>`;
  // A petal that falls, sways and fades, then starts again from where it began. Its first frame is the resting one.
  const drift = (x: number, y: number, rot: number, s: number, begin: number, dx: number) =>
    `<g><g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><use xlink:href="#petal"/></g>` +
    (a ? animateT("translate", `0 0;${dx} 14`, { dur: 5, begin }) + animate("opacity", "1;1;0", { dur: 5, begin, keyTimes: "0;.6;1" }) : "") + `</g>`;
  const petal = "M0,0 C-3.4,-1.6 -4.4,-5.8 -2.3,-7.8 C-1.3,-7.1 -.6,-7.5 0,-6.5 C.6,-7.5 1.3,-7.1 2.3,-7.8 C4.4,-5.8 3.4,-1.6 0,0 Z";
  const bloomDef =
    `<g id="bloom">${[0, 72, 144, 216, 288].map((rot) => `<g transform="rotate(${rot})"><path d="${petal}" fill="url(#pet)"/><path d="M0,-1 L0,-5.6" stroke="#f08fb4" stroke-width=".3" opacity=".7"/><path d="${petal}" stroke="#ef8cb2" stroke-width=".3" opacity=".6"/></g>`).join("")}` +
    `<circle r="1.5" fill="#d8467f" opacity=".55"/>` +
    `${[0, 51, 103, 154, 206, 257, 309].map((rot) => `<g transform="rotate(${rot})"><path d="M0,0 L0,-3.4" stroke="#f6b6d0" stroke-width=".28"/><circle cy="-3.6" r=".4" fill="#ffd24a"/></g>`).join("")}<circle r=".7" fill="#ffe28a"/></g>` +
    `<g id="petal"><path d="M-2.4,0 C-2.4,-1.6 2.4,-1.6 2.4,0 C2.4,1.6 -2.4,1.6 -2.4,0 Z" fill="url(#petL)" stroke="#ef8cb2" stroke-width=".3"/></g>`;
  const bark = (d: string, w: number) => `<path d="${d}" stroke="url(#barkG)" stroke-width="${w}" stroke-linecap="round"/><path d="${d}" stroke="#a9805c" stroke-width="${n(w * 0.2)}" stroke-linecap="round" opacity=".7" transform="translate(-.3 -.4)"/>`;
  return {
    body:
      `<g filter="url(#ds)">` +
      bark("M101,34 C93,30 89,19 78,12 C72,8 66,5 59,3.5", 2.5) + bark("M90,22 C87,14 90,9 95,5.5", 1.6) + bark("M72,9.5 C71,5.5 73,3 76,1.2", 1.3) + bark("M2,76 C7,80 8,87 15,92 C18,94 22,96 26,97", 2.1) +
      `</g>` +
      // A few leaves and a bud, so it isn't all pink.
      `<g filter="url(#ds)"><path d="M80,13.5 C84,10 88,11.5 89,14.5 C85,16.5 82,15.8 80,13.5 Z" fill="#6fae5a"/><path d="M80,13.5 C84,12.4 86.5,13 89,14.5" stroke="#3f7a38" stroke-width=".35"/><path d="M14,92 C12,96 8.5,96.5 6.5,95 C8.5,92.8 11.5,92 14,92 Z" fill="#6fae5a"/><circle cx="64" cy="3" r="1.5" fill="#f7a3c4"/></g>` +
      bloom(93, 29, 1.0, 10) + bloom(83, 18.5, 0.93, 30) + bloom(73, 10.5, 1.03, 0) + bloom(61, 6.5, 0.78, 20) + bloom(92.5, 8.5, 0.74, 40) + bloom(11, 82.5, 0.85, 15) + bloom(21, 93.5, 0.78, 35) +
      drift(93, 52, 25, 1, 0, -5) + drift(97, 66, -35, 0.85, -1.6, -6) + drift(87, 79, 60, 0.9, -3.2, -4) + drift(6, 58, -20, 0.9, -0.8, 5) + drift(4, 44, 40, 0.75, -2.4, 4) + drift(34, 95, 15, 0.8, -4, 3),
    defs:
      shadowF("ds", 1, 0.9, 0.45) + bloomDef +
      lin("pet", [[0, "#ee7aa6"], [0.55, "#ffc2da"], [1, "#fff4f8"]], [0, 1, 0, 0]) +
      lin("petL", [[0, "#ffd0e2"], [1, "#fff4f8"]], [0, 0, 1, 1]) +
      lin("barkG", [[0, "#8a5c42"], [0.5, "#5e3a28"], [1, "#3e2418"]]),
  };
};

// --- Crystal cluster: faceted gems that glow from inside ---------------------------------------------------------------------

const crystalCluster: Draw = (a) => {
  const tones: Record<string, [string, string, string]> = { violet: ["#4c27a8", "#8b5cf6", "#c9b2ff"], cyan: ["#0a6f96", "#22d3ee", "#c4f6ff"], magenta: ["#7d1a96", "#d946ef", "#f6bdff"], lilac: ["#5d3bb0", "#a78bfa", "#e4dbff"] };
  // A hexagonal crystal seen side-on: three lit faces up the body (dark, mid, light from left to right), a faceted tip, a glow
  // behind it and a bright edge on the lit side.
  const crystal = (x: number, base: number, w: number, h: number, tilt: number, tone: keyof typeof tones) => {
    const [dk, md, lt] = tones[tone];
    const hw = w / 2;
    const top = base - h;
    const sh = base - h * 0.74;
    const id = `${tone}`;
    return (
      `<g transform="rotate(${tilt} ${x} ${base})">` +
      `<ellipse cx="${x}" cy="${n(base - h * 0.5)}" rx="${n(w * 1.1)}" ry="${n(h * 0.62)}" fill="${md}" opacity=".35" filter="url(#glowB)"/>` +
      `<path d="M${x - hw},${sh} L${x - hw * 0.32},${n(sh - 1)} L${x - hw * 0.32},${base} L${x - hw},${base} Z" fill="url(#${id}A)"/>` +
      `<path d="M${n(x - hw * 0.32)},${n(sh - 1)} L${n(x + hw * 0.4)},${n(sh - 1)} L${n(x + hw * 0.4)},${base} L${n(x - hw * 0.32)},${base} Z" fill="url(#${id}B)"/>` +
      `<path d="M${n(x + hw * 0.4)},${n(sh - 1)} L${x + hw},${sh} L${x + hw},${base} L${n(x + hw * 0.4)},${base} Z" fill="url(#${id}C)"/>` +
      `<path d="M${x - hw},${sh} L${x},${top} L${n(x - hw * 0.32)},${n(sh - 1)} Z" fill="${lt}"/>` +
      `<path d="M${n(x - hw * 0.32)},${n(sh - 1)} L${x},${top} L${n(x + hw * 0.4)},${n(sh - 1)} Z" fill="${md}"/>` +
      `<path d="M${n(x + hw * 0.4)},${n(sh - 1)} L${x},${top} L${x + hw},${sh} Z" fill="${dk}"/>` +
      `<path d="M${x - hw},${base} L${x - hw},${sh} L${x},${top} L${x + hw},${sh} L${x + hw},${base}" stroke="#ffffff" stroke-width=".55" stroke-linejoin="round" opacity=".5"/>` +
      `<path d="M${x - hw + 0.8},${base - 1} L${x - hw + 0.8},${sh + 1} L${n(x - 0.4)},${top + 1.6}" stroke="#ffffff" stroke-width=".7" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>` +
      `<path d="M${n(x - hw * 0.32)},${n(sh - 1)} L${n(x - hw * 0.32)},${base}" stroke="#ffffff" stroke-width=".3" opacity=".35"/>` +
      `</g>`
    );
  };
  const cluster =
    crystal(9, 96, 8, 25, -14, "violet") + crystal(19, 98.5, 10.5, 36, 2, "cyan") + crystal(29.5, 97, 8, 20, 15, "magenta") + crystal(4.5, 79, 5.2, 11.5, -20, "lilac") +
    glint(a, 19, 64, 0.95, { dur: 2.6 }, "#fff", "#8fe9ff") + glint(a, 9, 72, 0.6, { dur: 3.1, begin: -1.2 }, "#fff", "#c9b2ff") + glint(a, 30, 78, 0.55, { dur: 2.2, begin: -0.7 }, "#fff", "#f6bdff");
  const shards = crystal(94, 15.5, 5.2, 12.5, 18, "cyan") + crystal(88, 10.5, 4.2, 9.5, 4, "violet") + glint(a, 94, 5, 0.5, { dur: 2.4, begin: -0.5 }, "#fff", "#8fe9ff");
  const defs = Object.entries(tones).map(([id, [dk, md, lt]]) => lin(`${id}A`, [[0, md], [1, dk]]) + lin(`${id}B`, [[0, lt], [0.5, md], [1, md]]) + lin(`${id}C`, [[0, md], [1, dk]])).join("");
  return {
    body: `<g filter="url(#ds)">${cluster}${mirrorX(cluster)}${shards}</g>`,
    defs: shadowF("ds", 1.1, 1, 0.5) + BLOOM + blurF("glowB", 2.4) + defs,
  };
};

// --- Pixel frame: bevelled tiles over a neon glow, the colours stepping round -----------------------------------------------

const pixelFrame: Draw = (a) => {
  const palette = ["#ff4f87", "#ffc533", "#18d6a0", "#38bdf8", "#a78bfa"];
  let px = "";
  let k = 0;
  const sq = (x: number, y: number) => {
    px += `<use xlink:href="#t${k++ % palette.length}" x="${x}" y="${y}"/>`;
  };
  for (let x = 8; x < 92; x += 4) { sq(x, 8); sq(x, 88); }
  for (let y = 12; y < 88; y += 4) { sq(8, y); sq(88, y); }
  // A tile has a lit top and left edge and a shaded bottom and right edge, and a dark gap between neighbours, so each reads as a
  // raised block and not a flat square.
  const tile = palette.map((c, i) => `<g id="t${i}"><rect width="4" height="4" fill="${c}"/><path d="M0,4 L0,0 L4,0 L3.2,.8 L.8,.8 L.8,3.2 Z" fill="#fff" opacity=".55"/><path d="M4,0 L4,4 L0,4 L.8,3.2 L3.2,3.2 L3.2,.8 Z" fill="#000" opacity=".28"/><rect x="1.2" y="1.2" width="1.6" height="1.6" fill="#fff" opacity=".12"/><rect width="4" height="4" fill="none" stroke="#10081f" stroke-width=".35" opacity=".7"/></g>`).join("");
  const stud = (x: number, y: number) =>
    `<g transform="translate(${x} ${y})"><rect width="8" height="8" fill="url(#stud)"/><path d="M0,8 L0,0 L8,0 L7,1 L1,1 L1,7 Z" fill="#fff" opacity=".9"/><path d="M8,0 L8,8 L0,8 L1,7 L7,7 L7,1 Z" fill="#000" opacity=".3"/><rect x="2.2" y="2.2" width="3.6" height="3.6" fill="#ff4f87"/><rect x="2.2" y="2.2" width="1.6" height="1.6" fill="#fff" opacity=".7"/><rect width="8" height="8" fill="none" stroke="#10081f" stroke-width=".4" opacity=".7"/></g>`;
  const cycle = a ? `<filter id="cycle" color-interpolation-filters="sRGB"><feColorMatrix type="hueRotate" values="0"><animate attributeName="values" values="0;72;144;216;288;360" dur="4s" calcMode="discrete" repeatCount="indefinite"/></feColorMatrix></filter>` : "";
  return {
    body:
      `<g shape-rendering="crispEdges"><g${a ? ' filter="url(#cycle)"' : ""}><g filter="url(#neon)" opacity=".85">${px}</g><g filter="url(#ds)">${px}</g></g>` +
      `<g filter="url(#ds)">${stud(2, 2)}${stud(90, 2)}${stud(2, 90)}${stud(90, 90)}</g></g>`,
    defs: shadowF("ds", 0.8, 0.7, 0.55) + blurF("neon", 1.9) + cycle + tile + lin("stud", [[0, "#ffffff"], [1, "#cfd4e6"]]),
  };
};

// --- Ringed planet: banded rings with a gap, a halo of dust, two shaded moons ---------------------------------------------------

const saturn: Draw = (a) => {
  // Concentric bands of different width and tint, which is what makes a ring read as a ring, with a gap left between two of them.
  const bands: [number, number, string, number][] = [[47.8, 1.5, "#ffe6f6", 0.9], [45.4, 2.6, "#f6b9ec", 0.95], [42.6, 2.2, "#c9a2ff", 0.95], [40.2, 1, "#ffffff", 0.7], [38.4, 1.7, "#e4a8f2", 0.9]];
  const arc = (rx: number, front: boolean) => {
    const ry = rx * 0.278;
    return front ? `M${n(50 - rx)},50 A${rx},${n(ry)} 0 0 0 ${n(50 + rx)},50` : `M${n(50 - rx)},50 A${rx},${n(ry)} 0 0 1 ${n(50 + rx)},50`;
  };
  const rings = (front: boolean) => bands.map(([rx, w, c, o]) => `<path d="${arc(rx, front)}" stroke="${c}" stroke-width="${w}" opacity="${o}" ${front ? "" : 'filter="url(#dim)"'}/>`).join("");
  const moon = (r: number, begin: number, rest: [number, number]) =>
    `<g><circle r="${r}" fill="url(#moon)" cx="${rest[0]}" cy="${rest[1]}"/>${a ? `<animateMotion path="${arc(47.8, true)}" keyPoints="0;1;0" keyTimes="0;.5;1" calcMode="linear" dur="9s" begin="${begin}s" repeatCount="indefinite"/>` : ""}</g>`;
  return {
    body:
      `<g transform="rotate(-22 50 50)"><path d="${arc(44, true)}" stroke="#d98cf0" stroke-width="9" opacity=".4" filter="url(#haze)"/></g>` +
      `<g mask="url(#behind)"><g transform="rotate(-22 50 50)">${rings(false)}</g></g>` +
      `<g transform="rotate(-22 50 50)" filter="url(#ds)">${rings(true)}<path d="${arc(47, true)}" stroke="#fff" stroke-width=".5" opacity=".8" transform="translate(0 -1.2)"/>` +
      (a ? moon(4, -2.2, [0, 0]) + moon(3, -6.8, [0, 0]) : moon(4, 0, [91, 38]) + moon(3, 0, [9, 62])) +
      `</g>` +
      [[8, 8, 0.6, 0], [92, 92, 0.5, -1], [95, 14, 0.4, -2]].map(([x, y, s, b]) => glint(a, x, y, s, { dur: 2.6, begin: b }, "#fff", "#e4a8f2")).join(""),
    defs: shadowF("ds", 0.9, 0.8, 0.4) + BLOOM + blurF("haze", 2.2) + blurF("dim", 0.25) + behindAvatar("behind") + rad("moon", [[0, "#ffffff"], [0.5, "#d6dcff"], [1, "#7480c4"]], 0.35, 0.3, 0.85),
  };
};

// --- Jeweled frame: bevelled gold set with four faceted stones ----------------------------------------------------------------

const gemFrame: Draw = (a) => {
  // A faceted stone: a bezel of gold, a table in the middle, and triangular facets round it alternating light and dark.
  const gem = (x: number, y: number, rot: number, begin: number, [l, m, d]: [string, string, string]) =>
    `<g transform="translate(${x} ${y}) rotate(${rot})"><g filter="url(#gemGlow)">` +
    `<path d="M0,-6.6 L5.7,-3.3 L5.7,3.3 L0,6.6 L-5.7,3.3 L-5.7,-3.3 Z" fill="${m}"/></g>` +
    `<path d="M0,-6.6 L5.7,-3.3 L0,-.2 Z" fill="${l}"/><path d="M5.7,-3.3 L5.7,3.3 L0,-.2 Z" fill="${m}"/><path d="M5.7,3.3 L0,6.6 L0,-.2 Z" fill="${d}"/><path d="M0,6.6 L-5.7,3.3 L0,-.2 Z" fill="${m}"/><path d="M-5.7,3.3 L-5.7,-3.3 L0,-.2 Z" fill="${l}"/><path d="M-5.7,-3.3 L0,-6.6 L0,-.2 Z" fill="#fff" opacity=".55"/>` +
    `<path d="M0,-3.3 L2.8,-1.65 L2.8,1.65 L0,3.3 L-2.8,1.65 L-2.8,-1.65 Z" fill="${l}" opacity=".7"/>` +
    `<path d="M0,-6.6 L5.7,-3.3 L5.7,3.3 L0,6.6 L-5.7,3.3 L-5.7,-3.3 Z" stroke="url(#gold)" stroke-width="1.3" stroke-linejoin="round"/>` +
    `<path d="M-3.6,-2.4 L-1.2,-4.4" stroke="#fff" stroke-width=".9" stroke-linecap="round">${a ? animate("opacity", "1;.15;1", { dur: 3.6, begin }) : ""}</path></g>`;
  const rivet = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="2" fill="url(#rivet)" stroke="#7a4a08" stroke-width=".35"/><circle cx="${x - 0.6}" cy="${y - 0.7}" r=".55" fill="#fff" opacity=".9"/>`;
  // A little scroll of gold at each corner, where the frame turns.
  const scroll = `<g id="scroll"><path d="M0,0 C3,-.6 4.6,1 3.8,2.8 C3.2,4.1 1.4,4 1.4,2.7 C1.4,2 2.1,1.7 2.5,2.1" stroke="url(#gold)" stroke-width=".8" stroke-linecap="round"/><circle cx="0" cy="0" r=".7" fill="#ffe9a0"/></g>`;
  return {
    body:
      `<g filter="url(#ds)">` +
      squircleRect(10.5, `stroke="#6e3f06" stroke-width="5.2"`) +
      squircleRect(10.5, `stroke="url(#gold)" stroke-width="4"`) +
      squircleRect(9, `stroke="#fff3b8" stroke-width=".6" opacity=".9"`) +
      squircleRect(12.1, `stroke="#7a4a08" stroke-width=".7" opacity=".85"`) +
      squircleRect(11.1, `stroke="#fff3b8" stroke-width=".35" opacity=".55"`) +
      `</g>` +
      rivet(15, 15) + rivet(85, 15) + rivet(15, 85) + rivet(85, 85) +
      `<g transform="translate(18.5 11)"><use xlink:href="#scroll"/></g><g transform="translate(81.5 11) scale(-1 1)"><use xlink:href="#scroll"/></g><g transform="translate(18.5 89) scale(1 -1)"><use xlink:href="#scroll"/></g><g transform="translate(81.5 89) scale(-1 -1)"><use xlink:href="#scroll"/></g>` +
      gem(50, 9.5, 0, 0, ["#ffb3bc", "#e11d48", "#8f1030"]) + gem(90.5, 50, 0, -0.9, ["#a5d8ff", "#2563eb", "#17307f"]) + gem(50, 90.5, 0, -1.8, ["#a6f5cf", "#10b981", "#065f46"]) + gem(9.5, 50, 0, -2.7, ["#ffffff", "#d3ecff", "#8fb6df"]) +
      glint(a, 50, 8.4, 0.6, { dur: 3.6 }, "#fff", "#ff8a96") + glint(a, 90.5, 49, 0.6, { dur: 3.6, begin: -0.9 }, "#fff", "#7fb4ff") + glint(a, 50, 89.4, 0.6, { dur: 3.6, begin: -1.8 }, "#fff", "#7fe8bd") + glint(a, 9.5, 49, 0.6, { dur: 3.6, begin: -2.7 }, "#fff", "#cfe9ff"),
    defs:
      shadowF("ds", 1.1, 1, 0.55) + BLOOM + blurF("gemGlow", 1.4) + scroll +
      lin("gold", [[0, "#fff7c2"], [0.2, "#f3c13a"], [0.45, "#a86a10"], [0.62, "#f7d56b"], [0.82, "#c88a1e"], [1, "#ffe9a0"]], [0, 0, 1, 1]) +
      rad("rivet", [[0, "#fff8d0"], [0.5, "#e8b13a"], [1, "#8a5a10"]], 0.35, 0.3, 0.8),
  };
};

// --- Little horns: ridged, lit from the top left, with embers at the tips ---------------------------------------------------

const horns: Draw = (a) => {
  const outline = "M26,19 C17,17.5 11.5,9.5 15.5,1.8 C18.5,8.5 25.5,10.5 35.5,13.4 Z";
  const horn = (begin: number) =>
    `<g filter="url(#ds)">${a ? animateT("rotate", "0 26 19;-5 26 19;2 26 19;0 26 19;0 26 19", { dur: 4.5, begin, keyTimes: "0;.06;.12;.18;1" }) : ""}` +
    `<path d="${outline}" fill="url(#hornBody)"/>` +
    `<g clip-path="url(#hornClip)">` +
    // Growth rings across the horn, each a shade darker on the underside.
    `<path d="M24.6,19 C27,16.6 30.6,15.2 34.6,14.2" stroke="#4a0712" stroke-width="1" opacity=".55"/><path d="M19.4,17.6 C22,14.4 25.4,12.2 30,11.4" stroke="#4a0712" stroke-width=".95" opacity=".5"/><path d="M14.4,14.4 C16.6,11.8 19.6,10.2 23,9.6" stroke="#4a0712" stroke-width=".85" opacity=".45"/><path d="M12.8,9.8 C14.4,8.2 16.4,7.2 18.6,6.8" stroke="#4a0712" stroke-width=".7" opacity=".4"/>` +
    `<path d="M24.6,17.8 C27,15.4 30.6,14 34.6,13" stroke="#ff9a8a" stroke-width=".5" opacity=".5"/><path d="M19.4,16.4 C22,13.2 25.4,11 30,10.2" stroke="#ff9a8a" stroke-width=".5" opacity=".5"/>` +
    // The highlight along the outer curve, where the light catches it.
    `<path d="M24,17.8 C17.4,16.8 13,10.6 15.2,4" stroke="#ffc2b6" stroke-width="1.5" stroke-linecap="round" opacity=".55" filter="url(#bloomB)"/><path d="M23.2,17.6 C17.8,16.4 14,10.8 15.6,5.2" stroke="#fff0ec" stroke-width=".55" stroke-linecap="round" opacity=".9"/>` +
    `</g>` +
    `<path d="${outline}" stroke="#5a0f1c" stroke-width=".8" stroke-linejoin="round" opacity=".85"/>` +
    // A dark collar where it meets the head.
    `<path d="M26,19 C29,17.2 32.6,15 35.5,13.4" stroke="#2c0508" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>` +
    `<circle cx="15.7" cy="2.6" r="2.6" fill="#ff8a1c" opacity="0" filter="url(#bloomB)">${a ? animate("opacity", "0;.85;0", { dur: 2.2, begin }) : ""}</circle></g>`;
  return {
    body: horn(-0.4) + mirrorX(horn(-2.4)),
    defs: shadowF("ds", 1.2, 1.1, 0.55) + BLOOM + `<clipPath id="hornClip"><path d="${outline}"/></clipPath>` + linU("hornBody", [[0, "#4a0712"], [0.35, "#a3162a"], [0.75, "#ee4a3c"], [1, "#ffb08a"]], 34, 16, 15, 3),
  };
};

// --- Ice cube: a slab of glassy ice that melts, over a lens that bends the picture behind it ------------------------------------

/** A rounded rectangle as a path, so two of them can be one ring with `fill-rule="evenodd"`. */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`;

const iceCube: Draw = (a) => {
  // A drip: a drop that swells on the bottom edge, lets go, falls into the puddle and rings it. All on one clock so they agree.
  const DUR = 3.4;
  const drip = (x: number, begin: number, size: number) => {
    const swell = a ? animateT("scale", "1 .5;1 1.3;1 1.3;1 .5", { dur: DUR, begin, keyTimes: "0;.56;.6;1" }) : "";
    const fall = a
      ? animateT("translate", "0 0;0 0;0 7.5;0 7.5", { dur: DUR, begin, keyTimes: "0;.6;.94;1" }) + animate("opacity", "0;0;1;1;0;0", { dur: DUR, begin, keyTimes: "0;.595;.6;.9;.95;1" })
      : "";
    const ripple = a
      ? animate("rx", "0.4;0.4;5.2", { dur: DUR, begin, keyTimes: "0;.93;1" }) + animate("opacity", "0;0;.8;0", { dur: DUR, begin, keyTimes: "0;.93;.95;1" })
      : "";
    return (
      `<g transform="translate(${x} 91.2) scale(${size})"><g>${swell}<path d="M-1.5,-1 C-1.5,2.2 -2.4,3.3 -2.4,4.9 A2.4,2.4 0 0 0 2.4,4.9 C2.4,3.3 1.5,2.2 1.5,-1 Z" fill="url(#melt)"/><path d="M-1.1,3 C-1.4,3.7 -1.2,4.6 -.7,5" stroke="#fff" stroke-width=".55" stroke-linecap="round" opacity=".9"/></g></g>` +
      `<g transform="translate(${x} 93)"><g opacity="0">${fall}<path d="M0,-1.7 C.9,-.4 1.5,.4 1.5,1.1 A1.5,1.5 0 0 1 -1.5,1.1 C-1.5,.4 -.9,-.4 0,-1.7 Z" fill="url(#melt)"/></g></g>` +
      `<ellipse cx="${x}" cy="98.2" rx="${a ? 0.4 : 0}" ry=".55" stroke="#bfe8ff" stroke-width=".35" opacity="0">${ripple}</ellipse>`
    );
  };
  const bubble = (x: number, y: number, r: number, b: number) =>
    `<g><circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".12"/><circle cx="${x}" cy="${y}" r="${r}" stroke="#eaf8ff" stroke-width=".35" opacity=".85"/><circle cx="${n(x - r * 0.35)}" cy="${n(y - r * 0.4)}" r="${n(r * 0.28)}" fill="#fff"/>${a ? animateT("translate", "0 0;.4 -1.6;0 0", { dur: 6, begin: b }) : ""}</g>`;
  const wave = (up: boolean) => `M13,${up ? 79 : 81} C26,${up ? 76 : 83} 38,${up ? 83 : 76} 50,${up ? 79 : 81} S74,${up ? 76 : 83} 87,${up ? 79 : 81} V90 H13 Z`;
  const streak = (x: number, y: number, h: number, begin: number) =>
    `<path d="M${x},${y} C${n(x + 0.8)},${n(y + h * 0.35)} ${n(x - 0.6)},${n(y + h * 0.7)} ${x},${y + h}" pathLength="100" stroke="#fff" stroke-width=".9" stroke-linecap="round" stroke-dasharray="24 76" opacity=".3">${a ? animate("stroke-dashoffset", "0;-100", { dur: 5, begin, keyTimes: "0;1" }).replace(/calcMode[^/]*/, "") : ""}</path>` +
    `<path d="M${x},${y} C${n(x + 0.8)},${n(y + h * 0.35)} ${n(x - 0.6)},${n(y + h * 0.7)} ${x},${y + h}" stroke="#bfe8ff" stroke-width=".3" stroke-linecap="round" opacity=".18"/>`;
  return {
    body:
      // The puddle it is making, under everything.
      `<ellipse cx="50" cy="98.4" rx="33" ry="2.1" fill="url(#puddle)"/><path d="M24,97.6 C38,96.7 62,96.7 76,97.6" stroke="#fff" stroke-width=".5" stroke-linecap="round" opacity=".6"/>` +
      // The slab: a faint tint over the picture so it reads as something between you and it, then its bevel, which is where
      // the light is: bright on the top left, deep blue on the bottom right.
      `<path d="${rr(8, 8, 84, 84, 16)}" fill="url(#iceTint)"/>` +
      `<g clip-path="url(#cube)">` +
      `<path d="${wave(true)}" fill="url(#film)">${a ? `<animate attributeName="d" values="${wave(true)};${wave(false)};${wave(true)}" dur="4.2s" repeatCount="indefinite"/>` : ""}</path>` +
      `<path d="M14,18 L38,8 L52,8 L14,30 Z" fill="url(#gloss)"/><path d="M12,40 L24,34 L12,56 Z" fill="url(#gloss)" opacity=".7"/>` +
      `<g>${a ? animateT("translate", "-50 0;150 0", { dur: 5.4 }) : ""}<rect x="-30" y="-10" width="16" height="130" fill="url(#sweep)" transform="rotate(18 50 50)"/></g>` +
      streak(19, 30, 40, 0) + streak(81, 24, 44, -2.4) +
      bubble(23, 30, 1.5, 0) + bubble(75, 41, 1.1, -2) + bubble(31, 63, 0.9, -3.5) + bubble(70, 66, 1.7, -1.2) + bubble(55, 21, 0.7, -4.4) + bubble(20, 52, 0.6, -2.6) +
      `<path d="M14.6,23 L19.5,28 L18.4,34.5 M19.5,28 L25.2,29.4 M85,70 L79.8,66.2 L80.6,60 M79.8,66.2 L74.4,68" stroke="#fff" stroke-width=".4" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>` +
      `</g>` +
      `<path d="${rr(8, 8, 84, 84, 16)} ${rr(13.6, 13.6, 72.8, 72.8, 11)}" fill="url(#bevel)" fill-rule="evenodd"/>` +
      `<path d="${rr(13.6, 13.6, 72.8, 72.8, 11)}" stroke="#2f69b8" stroke-width="1.1" opacity=".42" filter="url(#bloomB)"/>` +
      `<path d="${rr(13.6, 13.6, 72.8, 72.8, 11)}" stroke="#e9f8ff" stroke-width=".55" opacity=".75"/>` +
      `<path d="${rr(8.3, 8.3, 83.4, 83.4, 15.7)}" stroke="#ffffff" stroke-width=".7" opacity=".8"/>` +
      `<path d="M12.7,12.7 L16.9,16.9 M87.3,12.7 L83.1,16.9 M12.7,87.3 L16.9,83.1 M87.3,87.3 L83.1,83.1" stroke="#fff" stroke-width=".5" opacity=".55"/>` +
      `<path d="M22,9.2 H52" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".9" filter="url(#bloomB)"/><path d="M9.2,24 V50" stroke="#fff" stroke-width="1.1" stroke-linecap="round" opacity=".75" filter="url(#bloomB)"/>` +
      [[20.5, 10.4, 0.5], [60, 10, 0.4], [10.4, 38, 0.45], [88.6, 62, 0.4], [44, 90, 0.4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".9"/>`).join("") +
      drip(25, 0, 1) + drip(43, -1.1, 1.25) + drip(61, -2.3, 0.9) + drip(77, -0.6, 1.1) +
      glint(a, 17, 17, 0.8, { dur: 3.1 }, "#fff", "#bfe8ff"),
    defs:
      BLOOM + `<clipPath id="cube"><path d="${rr(8, 8, 84, 84, 16)}"/></clipPath>` +
      linU("iceTint", [[0, "#ffffff", 0.24], [0.4, "#cdeaff", 0.07], [1, "#4f9ae6", 0.3]], 8, 8, 92, 92) +
      linU("bevel", [[0, "#ffffff", 0.97], [0.32, "#d4f0ff", 0.92], [0.62, "#82c4f0", 0.88], [1, "#3b78cc", 0.92]], 8, 8, 92, 92) +
      linU("gloss", [[0, "#ffffff", 0.5], [1, "#ffffff", 0]], 14, 10, 40, 36) +
      lin("sweep", [[0, "#ffffff", 0], [0.5, "#ffffff", 0.5], [1, "#ffffff", 0]], [0, 0, 1, 0]) +
      lin("film", [[0, "#7cc8ff", 0.0], [0.35, "#7cc8ff", 0.22], [1, "#3b86d8", 0.55]]) +
      lin("melt", [[0, "#e9f8ff", 0.95], [1, "#7cc8ff", 0.9]]) +
      lin("puddle", [[0, "#7cc8ff", 0], [0.2, "#9bd8ff", 0.65], [0.5, "#d8f2ff", 0.8], [0.8, "#9bd8ff", 0.65], [1, "#7cc8ff", 0]], [0, 0, 1, 0]),
  };
};

// --- Sakura wreath: a ring of cherry blossom on a twig, with petals coming down over the picture --------------------------------

const sakura: Draw = (a) => {
  const r = rnd(77);
  // A petal has a notch at its tip, which is the one thing that says cherry blossom and not just a pink flower.
  const PETAL = "M0,0 C-3.7,-1.6 -4.9,-6.4 -2.6,-8.7 C-1.5,-7.9 -.7,-8.4 0,-7.2 C.7,-8.4 1.5,-7.9 2.6,-8.7 C4.9,-6.4 3.7,-1.6 0,0 Z";
  const bloomDef =
    `<g id="bloom">${[0, 72, 144, 216, 288].map((rot, i) => `<g transform="rotate(${rot + (i % 2) * 3})"><path d="${PETAL}" fill="url(#petal)"/><path d="M0,-.8 L0,-5.2 M0,-2 L-1.3,-4.4 M0,-2 L1.3,-4.4" stroke="#e86a9a" stroke-width=".22" stroke-linecap="round" opacity=".55"/><path d="${PETAL}" stroke="#f08db2" stroke-width=".28" opacity=".55"/></g>`).join("")}` +
    `<circle r="2.2" fill="url(#heart)"/>` +
    [0, 36, 72, 108, 144, 180, 216, 252, 288, 324].map((rot, i) => `<g transform="rotate(${rot})"><path d="M0,0 L0,${-(2.9 + (i % 3) * 0.3)}" stroke="#f7a8c6" stroke-width=".22"/><circle cy="${-(3.1 + (i % 3) * 0.3)}" r=".42" fill="${i % 2 ? "#ffd24a" : "#ffb938"}"/></g>`).join("") +
    `<ellipse cx="-2.6" cy="-3" rx="3.6" ry="2.2" fill="#fff" opacity=".22" transform="rotate(-35)"/></g>` +
    `<g id="bud"><path d="M0,0 C-2.2,-1 -2.6,-4.4 0,-6 C2.6,-4.4 2.2,-1 0,0 Z" fill="url(#budG)" stroke="#e57aa3" stroke-width=".3"/><path d="M-1.2,-1 C-1.6,-2.6 -.8,-4 0,-5" stroke="#fff" stroke-width=".4" opacity=".6"/><path d="M-1.4,.2 L0,-1 L1.4,.2 Z" fill="#7aa05a"/></g>` +
    `<g id="leafS"><path d="M0,0 C2.4,-1.4 2.6,-4.8 0,-6.6 C-2.6,-4.8 -2.4,-1.4 0,0 Z" fill="url(#leafG)"/><path d="M0,-.4 L0,-5.6" stroke="#3d7a3a" stroke-width=".3" opacity=".8"/></g>`;
  const blooms = (list: { x: number; y: number; out: number }[], s0: number, jitter: number, back: boolean) =>
    list.map(({ x, y, out }, i) => {
      const s = s0 * (0.82 + r() * jitter);
      return `<g transform="translate(${x} ${y}) rotate(${n(out + r() * 70)}) scale(${n(s)})"${back ? ' opacity=".92"' : ""}><use xlink:href="#bloom"/></g>`;
    }).join("");
  const ring = squircle(20, 44.6, -90);
  const inner = squircle(14, 42.2, -83);
  const leaves = squircle(30, 43.6, -88).map(({ x, y, out, i }) => `<g transform="translate(${x} ${y}) rotate(${n(out + (i % 2 ? 62 : -62))}) scale(${n(0.55 + r() * 0.35)})"><use xlink:href="#leafS"/></g>`).join("");
  const buds = squircle(12, 46.4, -75).map(({ x, y, out }) => `<g transform="translate(${x} ${y}) rotate(${n(out + (r() - 0.5) * 50)}) scale(${n(0.5 + r() * 0.3)})"><use xlink:href="#bud"/></g>`).join("");
  const fall = (x: number, y: number, rot: number, s: number, begin: number, dx: number) => {
    const path = `0 0;${dx} 9;${n(-dx * 0.7)} 19;${n(dx * 0.9)} 29;${n(-dx * 0.3)} 40`;
    const mv = a ? animateT("translate", path, { dur: 8, begin }).replace(/ repeatCount/, ' calcMode="linear" repeatCount') : "";
    const spin = a ? animateT("rotate", "0;200;380", { dur: 8, begin }) : "";
    const fade = a ? animate("opacity", "0;1;1;0", { dur: 8, begin, keyTimes: "0;.1;.82;1" }) : "";
    return `<g>${mv}<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><g>${spin}<g>${fade}<path d="M-2.6,0 C-2.6,-2.5 2.6,-2.5 2.6,0 C2.6,2.5 -2.6,2.5 -2.6,0 Z M-.2,-1.9 L0,-.6" fill="url(#fallG)" stroke="#ef8cb2" stroke-width=".3"/></g></g></g></g>`;
  };
  return {
    body:
      `<ellipse cx="50" cy="50" rx="47" ry="47" fill="url(#aura)"/>` +
      `<g>${a ? animateT("rotate", "0 50 50;1.4 50 50;-1.1 50 50;0 50 50", { dur: 9 }) : ""}` +
      `<g filter="url(#ds)">` +
      squircleRect(9.4, `stroke="url(#bark)" stroke-width="1.5"`) + squircleRect(9.9, `stroke="#a9805c" stroke-width=".5" stroke-dasharray="3 2.4" opacity=".8"`) +
      `<path d="M13,12 C9,9 6,10 4,7 M88,10 C92,6 95,8 97,5 M92,89 C96,93 94,96 98,97 M10,90 C6,94 8,97 4,98" stroke="#6b4332" stroke-width=".9" stroke-linecap="round"/>` +
      leaves + `</g>` +
      `<g filter="url(#ds)">${blooms(inner, 0.36, 0.3, true)}${buds}${blooms(ring, 0.6, 0.45, false)}</g></g>` +
      [[96, 18, 4.6], [4, 80, 4], [94, 84, 3.4], [8, 12, 3]].map(([x, y, rr2]) => `<circle cx="${x}" cy="${y}" r="${rr2}" fill="#ffb3d1" opacity=".3" filter="url(#bloomB)"/>`).join("") +
      fall(20, 16, 20, 0.95, 0, 3.4) + fall(48, 6, -30, 0.8, -1.1, -4) + fall(77, 14, 60, 1, -2.3, 3.6) + fall(90, 40, -10, 0.85, -3.4, -3) + fall(8, 44, 40, 0.9, -4.5, 3.2) +
      fall(32, 8, 10, 0.7, -5.6, -3.6) + fall(66, 4, -50, 0.75, -6.7, 4) + fall(86, 20, 25, 0.8, -0.6, -3.4) + fall(12, 24, -25, 0.8, -2.9, 3),
    defs:
      shadowF("ds", 0.9, 0.9, 0.42) + BLOOM + bloomDef +
      lin("petal", [[0, "#e8457f"], [0.28, "#f98cb5"], [0.7, "#ffd0e2"], [1, "#fff6f9"]], [0, 1, 0, 0]) +
      rad("heart", [[0, "#c2185b"], [0.6, "#e8457f"], [1, "#f98cb5"]]) +
      lin("budG", [[0, "#e8457f"], [0.6, "#ffa3c4"], [1, "#ffe0ec"]]) +
      lin("leafG", [[0, "#4f8f45"], [1, "#98cf6a"]]) +
      lin("bark", [[0, "#8a5c42"], [0.5, "#5e3a28"], [1, "#3e2418"]]) +
      lin("fallG", [[0, "#ffd0e2"], [1, "#fff6f9"]], [0, 0, 1, 1]) +
      rad("aura", [[0, "#ffb3d1", 0], [0.82, "#ffb3d1", 0], [0.94, "#ffb3d1", 0.28], [1, "#ffb3d1", 0]]),
  };
};

// --- Moon: a cratered crescent over the corner, with a sky of stars that twinkle and one that shoots ----------------------------

const moon: Draw = (a) => {
  const twinkle = (x: number, y: number, s: number, b: number, dur: number, fill = "#fffbe8") => glint(a, x, y, s, { dur, begin: b }, fill, "#cfe0ff");
  const dot = (x: number, y: number, rad: number, b: number, dur: number) => `<circle cx="${x}" cy="${y}" r="${rad}" fill="#fff">${a ? animate("opacity", "1;.2;1", { dur, begin: b }) : ""}</circle>`;
  const crater = (x: number, y: number, rad: number) =>
    `<circle cx="${x}" cy="${y}" r="${rad}" fill="url(#crater)"/><path d="M${n(x - rad * 0.8)},${n(y + rad * 0.5)} A${rad},${rad} 0 0 1 ${n(x + rad * 0.5)},${n(y - rad * 0.8)}" stroke="#2c2f55" stroke-width=".45" opacity=".55"/><path d="M${n(x + rad * 0.8)},${n(y - rad * 0.4)} A${rad},${rad} 0 0 1 ${n(x - rad * 0.4)},${n(y + rad * 0.8)}" stroke="#fff" stroke-width=".4" opacity=".6"/>`;
  const field: [number, number, number][] = [[10, 8, 0], [24, 3, 1.3], [38, 7, 0.6], [4, 24, 1.9], [92, 62, 0.9], [96, 78, 2.2], [84, 94, 0.3], [66, 97, 1.6], [18, 95, 1.1], [5, 70, 2.4], [30, 92, 0.7], [94, 40, 1.4]];
  return {
    body:
      // The sky it is in: a faint cool wash behind the crescent so the moon sits in a place, then stars at three sizes.
      `<circle cx="82" cy="17" r="26" fill="url(#sky)"/>` +
      field.map(([x, y, b], i) => dot(x, y, n(0.45 + (i % 3) * 0.2), -b, 2.2 + (i % 4) * 0.5)).join("") +
      twinkle(14, 14, 0.8, 0, 2.6) + twinkle(44, 4.5, 0.55, -1.2, 3) + twinkle(6, 40, 0.6, -2.1, 2.4) + twinkle(93, 52, 0.7, -0.7, 2.9) + twinkle(88, 88, 0.6, -1.7, 3.2) + twinkle(14, 88, 0.75, -2.5, 2.7) +
      // The shooting star: it crosses the top left once a loop and is not there the rest of the time.
      `<g opacity="0"><g>${a ? animateT("translate", "0 0;0 0;34 21;34 21", { dur: 7, begin: -3, keyTimes: "0;.08;.2;1" }) + animate("opacity", "0;0;1;0;0", { dur: 7, begin: -3, keyTimes: "0;.08;.12;.2;1" }) : ""}` +
      `<path d="M2,2 L-18,-10" stroke="url(#trail)" stroke-width="1.4" stroke-linecap="round"/><circle cx="2" cy="2" r="1.1" fill="#fff"/></g></g>` +
      `<g filter="url(#ds)"><g filter="url(#glowM)" opacity=".55"><g mask="url(#cres)"><circle cx="82" cy="17" r="15.5" fill="#fff4c4"/></g>${a ? animate("opacity", ".4;.7;.4", { dur: 4 }) : ""}</g>` +
      // The crescent: a disc with another disc taken out of it, which is what leaves the lit rim.
      `<g mask="url(#cres)"><circle cx="82" cy="17" r="15.5" fill="url(#moonG)"/>` +
      `<ellipse cx="88" cy="10" rx="5" ry="3.4" fill="#9a9bbd" opacity=".34" filter="url(#bloomB)"/><ellipse cx="76" cy="26" rx="3.4" ry="2.6" fill="#9a9bbd" opacity=".3" filter="url(#bloomB)"/><ellipse cx="91" cy="22" rx="2.6" ry="3.8" fill="#9a9bbd" opacity=".28" filter="url(#bloomB)"/>` +
      crater(88, 9, 2.3) + crater(92, 19, 1.7) + crater(82, 5.5, 1.4) + crater(75.4, 25.6, 1.8) + crater(85, 27, 1.1) +
      `<circle cx="82" cy="17" r="15.5" stroke="#fffdf0" stroke-width="1.1" opacity=".85"/>` +
      `</g></g>` +
      // Stars on the moon's own face: they glint where the light is brightest.
      twinkle(87, 14, 0.46, -0.4, 2.2, "#fff") + twinkle(80, 8, 0.4, -1.4, 2.7, "#fff") + twinkle(93, 24, 0.36, -2.2, 2.4, "#fff") +
      "",
    defs:
      shadowF("ds", 0.8, 0.9, 0.35) + BLOOM + blurF("glowM", 4) +
      `<mask id="cres" maskUnits="userSpaceOnUse" x="55" y="-8" width="50" height="50"><rect x="55" y="-8" width="50" height="50" fill="#fff"/><circle cx="75" cy="22.6" r="13.2" fill="#000"/></mask>` +
      rad("moonG", [[0, "#fffdf0"], [0.55, "#f2e6bd"], [1, "#c9bd96"]], 0.65, 0.3, 0.85) +
      rad("crater", [[0, "#9c9ab8", 0.2], [0.7, "#8a88a8", 0.5], [1, "#7a789a", 0.7]]) +
      rad("sky", [[0, "#7f9bff", 0.16], [0.6, "#4b5fd0", 0.06], [1, "#2a2f8a", 0]]) +
      lin("trail", [[0, "#ffffff", 1], [1, "#ffffff", 0]], [0, 0, 1, 1]),
  };
};

const make = (key: string, name: string, motion: string, draw: Draw, refract?: RefractionKind): CollectionPreset => {
  const still = draw(false);
  const live = draw(true);
  // The published file has an intrinsic size. With only a viewBox some renderers report a width of 0, which leaves the app
  // nothing to draw a first-frame poster at (see `useStaticFrame`).
  const sized = wrap(live.body, live.defs).replace('viewBox="0 0 100 100"', 'width="256" height="256" viewBox="0 0 100 100"');
  return { key, name, value: `builtin:${key}`, src: dataUri(wrap(still.body, still.defs)), animatedSvg: sized, motion, ...(refract ? { refract } : {}) };
};

/** In the order the shop lists them. */
export const COLLECTION_PRESETS: CollectionPreset[] = [
  make("cat-ears", "Cat Ears", "Each ear flicks about its pearl every few seconds, out of step with the other, the whiskers twitch and the pearls glint.", catEars),
  make("halo", "Halo", "The halo hovers and pulses with light while three stars glint.", halo),
  make("laurel", "Laurel Wreath", "A ripple of movement runs up the leaves and the berries glint.", laurel),
  make("lightning-corners", "Lightning Corners", "Each corner flickers on its own, like a failing bulb.", lightningCorners),
  make("flame-ring", "Flame Ring", "Every flame licks and settles at its own pace and embers drift up.", flameRing),
  make("frost", "Frost", "The ice shards glitter, snowflakes turn and the ring sparkles.", frost),
  make("blossom", "Cherry Blossom", "Petals drift down off the branch and fade.", blossom),
  make("crystal-cluster", "Crystal Cluster", "Light glints off the crystal tips.", crystalCluster),
  make("pixel-frame", "Pixel Frame", "The neon border's colours step round the palette.", pixelFrame),
  make("saturn", "Ringed Planet", "Two moons travel back and forth along the ring.", saturn),
  make("gem-frame", "Jeweled Frame", "The four stones catch the light one after another.", gemFrame),
  make("horns", "Little Horns", "The horns wiggle and the tips flare like embers.", horns),
  make("ice-cube", "Ice Cube", "The ice bends the picture behind it, and melts: drips swell, fall and ring a puddle while light slides over the surface.", iceCube, "ice"),
  make("sakura", "Sakura Wreath", "A wreath of cherry blossom sways gently while petals fall across the picture.", sakura),
  make("moon", "Crescent Moon", "Stars twinkle across the sky and on the moon's face, and a shooting star crosses once a loop.", moon),
];
