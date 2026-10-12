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

// --- Cat ears: plush, lit from the top left; a twitch every few seconds ----------------------------------------------------

const EAR = "M13.5,30 C12,19 13,9 18,3.6 C26.5,6.5 36.5,12 44,17.5 Z";
const EAR_INNER = "M20.4,26 C19.2,18.8 20,12.8 22.4,9.4 C27.6,11.2 33,14.4 37.6,17.8 C32,22.8 26,25.4 20.4,26 Z";

const catEars: Draw = (a) => {
  const r = rnd(5);
  // Fur: short strokes laid along the ear from base to tip, clipped to its outline so none stray.
  const dx = -0.456;
  const dy = -0.89;
  const px = 0.89;
  const py = -0.456;
  let fur = "";
  for (let i = 0; i < 34; i++) {
    const s = 1 + r() * 19;
    const w = 15 * (1 - s / 24);
    const u = (r() - 0.5) * 2 * w;
    const x = 28.5 + dx * s + px * u;
    const y = 24.5 + dy * s + py * u;
    const len = 2.6 + r() * 2.4;
    const bend = (r() - 0.5) * 1.6;
    const light = r() > 0.55;
    fur += `<path d="M${n(x)},${n(y)} q${n(bend)},${n(dy * len * 0.5)} ${n(dx * len + bend)},${n(dy * len)}" stroke="${light ? "#b99af0" : "#2c1a59"}" stroke-width=".55" stroke-linecap="round" opacity="${light ? 0.55 : 0.5}"/>`;
  }
  // Wisps of cream fluff along the lower edge of the inner ear, pointing back up it.
  let fluff = "";
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const x = 21.8 + t * 15.4;
    const y = 25.4 - t * 7.5 + Math.sin(t * Math.PI) * 1.4;
    const lift = 3 + (i % 2) * 1.6;
    fluff += `<path d="M${n(x)},${n(y)} q${n(-0.9)},${n(-lift * 0.55)} ${n(-1.6)},${n(-lift)}" stroke="#fff2f8" stroke-width="1.05" stroke-linecap="round" opacity=".95"/>`;
  }
  const ear = (begin: number) =>
    `<g filter="url(#ds)">${a ? animateT("rotate", "0 30 26;-6 30 26;3 30 26;0 30 26;0 30 26", { dur: 5, begin, keyTimes: "0;.05;.1;.15;1" }) : ""}` +
    `<path d="${EAR}" fill="url(#fur)"/>` +
    `<g clip-path="url(#earClip)">${fur}<path d="${EAR}" fill="url(#furShade)"/><path d="M13,30 C12,19 13,9 18,3.6" stroke="#d9c5ff" stroke-width="2.4" opacity=".28" filter="url(#bloomB)"/></g>` +
    `<path d="${EAR}" stroke="url(#rim)" stroke-width="1.25" stroke-linejoin="round"/>` +
    `<path d="${EAR_INNER}" fill="url(#pink)"/><path d="${EAR_INNER}" fill="url(#pinkShade)"/>` +
    `<path d="M22,24.6 C21,18.6 21.8,13.6 23.4,10.6" stroke="#ffd3e6" stroke-width=".9" stroke-linecap="round" opacity=".6"/>` +
    fluff +
    `</g>`;
  return {
    body: ear(-0.2) + mirrorX(ear(-2.6)),
    defs:
      shadowF("ds", 1.4, 1.2, 0.55) + BLOOM +
      `<clipPath id="earClip"><path d="${EAR}"/></clipPath>` +
      linU("fur", [[0, "#a47ce8"], [0.45, "#7048bd"], [1, "#35205f"]], 18, 3, 34, 30) +
      linU("furShade", [[0, "#1d0f3c", 0], [0.55, "#1d0f3c", 0.0], [1, "#1d0f3c", 0.55]], 22, 8, 32, 31) +
      linU("rim", [[0, "#e4d6ff"], [0.5, "#a98af0"], [1, "#5a3aa0"]], 14, 4, 42, 24) +
      linU("pink", [[0, "#ff9cc4"], [0.55, "#ffc2da"], [1, "#ffe1ee"]], 22, 10, 33, 25) +
      linU("pinkShade", [[0, "#a02f63", 0.7], [0.4, "#a02f63", 0.0], [1, "#a02f63", 0]], 22, 9, 28, 20),
  };
};

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

const make = (key: string, name: string, motion: string, draw: Draw): CollectionPreset => {
  const still = draw(false);
  const live = draw(true);
  // The published file has an intrinsic size. With only a viewBox some renderers report a width of 0, which leaves the app
  // nothing to draw a first-frame poster at (see `useStaticFrame`).
  const sized = wrap(live.body, live.defs).replace('viewBox="0 0 100 100"', 'width="256" height="256" viewBox="0 0 100 100"');
  return { key, name, value: `builtin:${key}`, src: dataUri(wrap(still.body, still.defs)), animatedSvg: sized, motion };
};

/** In the order the shop lists them. */
export const COLLECTION_PRESETS: CollectionPreset[] = [
  make("cat-ears", "Cat Ears", "Each ear gives a quick twitch every few seconds, out of step with the other.", catEars),
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
];
