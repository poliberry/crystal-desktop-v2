import { MOTION_LIMITS, MOTION_STAGES, defaultParticles, defaultTransform, newClip, type BlendMode, type Clip, type ClipFx, type Ease, type Key, type MotionKind, type MotionSpec, type Particles, type Prop, type Source, type Transform } from "./motion";
import { cycle } from "./effectLibrary";

/**
 * The Archive collection: original nameplates and profile effects for the shop.
 *
 * Crystal's cosmetics are data, not pictures. A design here is a stack of the same generators and keyframes anyone can use in
 * Studio's timeline (gradients, shapes, particles, shimmer, rays, noise, compound clips), played live on a canvas, so each one is
 * a few kilobytes and crisp at any size. The set is written in the spirit of the collectibles people remember from the big chat
 * apps — a lofi window at dusk, a storm, a summoning circle, a treasure hoard, a 70s sunburst, a confetti pop — but nothing is
 * traced or copied from anyone's artwork; every shape below is drawn from primitives.
 *
 * ## Looping
 *
 * Every design is `intro` seconds that play once (when a profile is opened) and then `idle` seconds that repeat. What repeats is
 * periodic in the idle (see `cycle`), particle lives divide it (`fit`), rays and compound clips turn whole numbers of turns, and a
 * noise layer swells to almost nothing at the seam. What plays once is invisible by its last key.
 *
 * ## Nameplates are faint
 *
 * The app draws a nameplate at about 20% opacity and fades it towards the name (`fade-mask-l`), so a nameplate is painted bold
 * and saturated, with its subject in the right-hand half where the fade leaves it. Profile effects sit over a whole card, so they
 * keep the middle clear and work the edges.
 *
 * Pure: no Convex, no DOM. Used by the publish action, the tests and the preview harness.
 */

export interface CollectionDesign {
  slug: string;
  name: string;
  kind: MotionKind;
  description: string;
  /** Suggested price in US cents. The SKU is created as a draft, so a person with pricing rights confirms it. */
  priceCents: number;
  /** Swatches for the store and the tests. */
  colors: string[];
  duration: number;
  intro: number;
  build: (c: Ctx) => Clip[];
}

export interface Ctx {
  kind: MotionKind;
  stage: { w: number; h: number };
  duration: number;
  intro: number;
  idle: number;
  seed: number;
}

// --- Kit ---------------------------------------------------------------------------------------------------------------

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const keys = (list: Key<number>[]): Prop => {
  const sorted = [...list].sort((a, b) => a.t - b.t);
  const out = sorted.filter((k, i) => i === sorted.length - 1 || sorted[i + 1].t !== k.t);
  return out.length === 1 ? out[0].v : { k: out };
};
const alpha = (hex: string, a: number) => `${hex}${Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0")}`;
const clear = (hex: string) => `${hex}00`;
const strip = (c: Ctx) => c.kind === "nameplate";
const dim = (c: Ctx) => Math.min(c.stage.w, c.stage.h);
const big = (c: Ctx) => Math.max(c.stage.w, c.stage.h);
const area = (c: Ctx) => Math.sqrt((c.stage.w * c.stage.h) / (MOTION_STAGES.effect.w * MOTION_STAGES.effect.h));
const cnt = (c: Ctx, n: number) => Math.max(2, Math.min(MOTION_LIMITS.particles, Math.round(n * area(c))));
/** A life near `life` that divides the idle exactly, so a particle field loops with no jump. */
const fit = (c: Ctx, life: number) => r3(c.idle / Math.max(1, Math.round(c.idle / life)));
const raySpin = (c: Ctx, count: number, steps = 1) => r3(((360 / count) * steps) / c.idle);
const glow = (color: string, blur = 14, strength = 1.4): ClipFx => ({ type: "glow", color, blur, strength });
const blur = (amount: number): ClipFx => ({ type: "blur", amount });

/** A tiny deterministic generator, so a design is the same every time it is built (and so the same address when published). */
function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
}

const tf = (o: Partial<Transform> & { scale?: Prop } = {}): Transform => {
  const { scale, ...rest } = o;
  const t = { ...defaultTransform(), ...(scale !== undefined ? { scaleX: scale, scaleY: scale } : {}), ...rest };
  for (const k of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const) if (typeof t[k] === "number") (t as unknown as Record<string, number>)[k] = r3(t[k] as number);
  return t;
};

function tidy(src: Source): Source {
  const out: Record<string, unknown> = { ...src };
  for (const k of ["w", "h", "r", "ox", "oy", "size", "speed", "gravity", "strokeWidth", "radius"]) if (typeof out[k] === "number") out[k] = r3(out[k] as number);
  return out as unknown as Source;
}

interface ClipOpts {
  blend?: BlendMode;
  fx?: ClipFx[];
  transform?: Transform;
  /** Plays once, in the intro, and must be invisible by its last key. */
  intro?: boolean;
  /** Fade in under the intro (the default for what loops) or be there at once. */
  ramp?: boolean;
  start?: number;
  duration?: number;
}

/** One clip. What loops runs the whole design; what is `intro` runs the intro once. */
function make(c: Ctx, name: string, source: Source, o: ClipOpts = {}): Clip {
  let transform = o.transform ?? tf();
  const introOnly = o.intro === true;
  // A drifting noise field can't repeat, so it swells to almost nothing once per idle and the seam is lost in the dip.
  if (!introOnly && source.type === "noise" && typeof transform.opacity === "number") transform = { ...transform, opacity: cycle(c, c.idle, [[0, r3(transform.opacity * 0.1)], [0.5, transform.opacity]]) };
  const rise = c.intro > 0 && !introOnly && o.ramp !== false;
  return newClip(tidy(source), {
    name,
    start: o.start ?? 0,
    duration: o.duration ?? (introOnly ? c.intro : c.duration),
    loop: !introOnly,
    blend: o.blend,
    fx: o.fx,
    transform,
    transitionIn: rise ? { type: "fade", d: r3(c.intro * 0.9), dir: "left", e: "out" } : undefined,
  });
}

const part = (c: Ctx, over: Partial<Particles>): Source => ({ type: "particles", ...defaultParticles(), seed: c.seed, ...over });

/** `turns` whole turns per idle, and at rest-angle 0 where the loop begins. */
const spin = (c: Ctx, turns: number): Prop => ({
  k: [
    { t: 0, v: r3((-turns * 360 * c.intro) / c.idle), e: "linear" },
    { t: r3(c.duration), v: r3(turns * 360), e: "linear" },
  ],
});

/** A colour that goes round `colors` once per idle and back to the first. */
function colorLoop(c: Ctx, colors: string[]): { k: Key<string>[] } {
  const list = colors.length > 1 ? colors : [colors[0], colors[0]];
  const ks: Key<string>[] = list.map((v, i) => ({ t: r3(c.intro + (c.idle * i) / list.length), v, e: "inOut" as Ease }));
  ks.push({ t: r3(c.duration), v: list[0], e: "inOut" });
  if (c.intro > 0) ks.unshift({ t: 0, v: list[0], e: "linear" });
  return { k: ks.filter((k, i) => i === 0 || k.t - ks[i - 1].t > 1e-6) };
}

// Layers every scene is made of.

/**
 * A wash of colour that breathes, `w` by `h` across.
 *
 * A radial gradient's radius is half the box's diagonal, so on a box that isn't square it is still lit at the middle of the short
 * sides, and the glow stops dead in a straight line. So the gradient is drawn on a *square* that fades to nothing by its edge
 * (zero at 0.7 of the radius, which is the edge of a square) and the shape is made by scaling that square, which keeps it soft on
 * every side.
 */
function bed(c: Ctx, color: string, o: { a?: number; x?: number; y?: number; w?: number; h?: number; name?: string; period?: number } = {}): Clip {
  const a = o.a ?? 0.35;
  const w = o.w ?? c.stage.w * 1.2;
  const h = o.h ?? c.stage.h * 1.2;
  const side = Math.max(w, h);
  return make(c, o.name ?? "Glow", { type: "gradient", w: side, h: side, kind: "radial", angle: 0, stops: [{ o: 0, c: alpha(color, 0.9) }, { o: 0.32, c: alpha(color, 0.42) }, { o: 0.7, c: clear(color) }, { o: 1, c: clear(color) }] }, { blend: "add", transform: tf({ x: o.x ?? 0, y: o.y ?? 0, scaleX: w / side, scaleY: h / side, opacity: cycle(c, o.period ?? 4, [[0, r3(a * 0.55)], [0.5, a]]) }) });
}

/** A soft, flat cloud: a square radial fade squashed to `w` by `h`, with no edge to see. */
function puff(w: number, h: number, color: string): Source {
  const side = Math.max(w, h);
  void h;
  return { type: "gradient", w: side, h: side, kind: "radial", angle: 0, stops: [{ o: 0, c: alpha(color, 0.9) }, { o: 0.35, c: alpha(color, 0.5) }, { o: 0.7, c: clear(color) }, { o: 1, c: clear(color) }] };
}

/** Drifting cloud or smoke. */
function haze(c: Ctx, color: string, o: { a?: number; scale?: number; speed?: number; contrast?: number; seed?: number; blend?: BlendMode; name?: string; y?: number } = {}): Clip {
  return make(c, o.name ?? "Haze", { type: "noise", w: c.stage.w * 1.2, h: c.stage.h * 1.2, scale: o.scale ?? 260, speed: o.speed ?? 0.15, color, contrast: o.contrast ?? 0.4, seed: c.seed + (o.seed ?? 0) }, { blend: o.blend ?? "screen", transform: tf({ y: o.y ?? 0, opacity: o.a ?? 0.4 }) });
}

/** A band of light crossing, then resting. */
function sweep(c: Ctx, color: string, o: { width?: number; period?: number; angle?: number; a?: number; seed?: number } = {}): Clip {
  return make(c, "Sweep", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: o.angle ?? 20, width: o.width ?? 0.16, period: fit(c, o.period ?? 3.2), color, seed: c.seed + (o.seed ?? 0) }, { blend: "add", transform: tf({ opacity: o.a ?? 0.5 }) });
}

/** Stars blinking on and off. */
function twinkles(c: Ctx, n = 16, size = 10, o: { w?: number; h?: number; x?: number; y?: number; colors?: string[]; seed?: number; name?: string } = {}): Clip {
  return make(c, o.name ?? "Twinkles", part(c, { shape: "spark", w: o.w ?? c.stage.w, h: o.h ?? c.stage.h, count: cnt(c, n), life: fit(c, 2.2), speed: 0, size, sizeEnd: 0, spin: 40, colors: o.colors ?? ["#ffffff"], fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + (o.seed ?? 71) }), { blend: "add", transform: tf({ x: o.x ?? 0, y: o.y ?? 0 }) });
}

/** Light gathering at the edges. */
function edgeGlow(c: Ctx, color: string, a = 0.4): Clip {
  return make(c, "Edge light", { type: "gradient", w: c.stage.w * 1.04, h: c.stage.h * 1.04, kind: "radial", angle: 0, stops: [{ o: 0, c: clear(color) }, { o: 0.5, c: clear(color) }, { o: 1, c: alpha(color, a) }] }, { blend: "add", transform: tf({ opacity: cycle(c, 3.6, [[0, 0.55], [0.5, 1]]) }) });
}

function rays(c: Ctx, name: string, count: number, color: string | { k: Key<string>[] }, o: { steps?: number; dir?: 1 | -1; r?: number; x?: number; y?: number; a?: number; softness?: number } = {}): Clip {
  return make(c, name, { type: "rays", r: o.r ?? big(c) * 0.85, count, color, spin: r3((o.dir ?? 1) * raySpin(c, count, o.steps ?? 1)), softness: o.softness ?? 0.6 }, { blend: "add", transform: tf({ x: o.x ?? 0, y: o.y ?? 0, opacity: o.a ?? 0.35 }) });
}

/** A figure drifting across the whole stage and gone before it wraps. */
function crossing(c: Ctx, name: string, source: Source, o: { from: number; to: number; y: number; a: number; phase?: number; blend?: BlendMode; fx?: ClipFx[]; period?: number; sy?: number }): Clip {
  const period = o.period ?? c.idle;
  return make(c, name, source, { blend: o.blend, fx: o.fx, transform: tf({ y: o.y, scaleY: o.sy ?? 1, x: cycle(c, period, [[0, o.from, "linear"], [0.999, o.to, "linear"]], o.phase ?? 0), opacity: cycle(c, period, [[0, 0, "linear"], [0.2, o.a, "linear"], [0.8, o.a, "linear"], [0.999, 0, "linear"]], o.phase ?? 0) }) });
}

/** A jagged bolt from one point to another, as a chain of short lines that all flash together. */
function bolt(c: Ctx, name: string, from: [number, number], to: [number, number], flash: Prop, o: { n?: number; jag?: number; width?: number; color?: string; halo?: string; seed?: number } = {}): Clip[] {
  const n = o.n ?? 7;
  const rnd = rng((o.seed ?? 1) + c.seed);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const norm = Math.hypot(dx, dy) || 1;
  const px = -dy / norm;
  const py = dx / norm;
  const jag = o.jag ?? 16;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const u = i / n;
    const j = i === 0 || i === n ? 0 : (rnd() - 0.5) * 2 * jag;
    return { x: from[0] + dx * u + px * j, y: from[1] + dy * u + py * j };
  });
  const width = o.width ?? 3;
  const color = o.color ?? "#f0f9ff";
  const halo = o.halo ?? "#7dd3fc";
  return pts.slice(0, -1).map((p, i) => {
    const q = pts[i + 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y) + width * 0.6;
    return make(c, `${name} ${i + 1}`, { type: "shape", shape: "line", w: len, h: width, fill: color, stroke: color, strokeWidth: width, radius: 0, points: 5, inner: 0.5 }, {
      blend: "add",
      fx: [glow(halo, 10, 1.8)],
      transform: tf({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, rotation: (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI, opacity: flash }),
    });
  });
}

/** A strike pattern for a bolt: dark, a hard flash, a stutter, dark again, once per idle (`at` is where in it, 0 to 1). */
const strike = (c: Ctx, at = 0.3): Prop => cycle(c, c.idle, [[0, 0, "out"], [at, 0, "out"], [at + 0.005, 1, "out"], [at + 0.05, 0.12, "out"], [at + 0.09, 0.85, "out"], [at + 0.22, 0, "out"]]);

// The intro: what plays once, gone before the loop begins.

function introFlash(c: Ctx, color: string, peak = 0.5, at = 0): Clip {
  const I = c.intro;
  const a = Math.min(0.5, Math.max(0, at));
  return make(c, at > 0 ? "Intro flash 2" : "Intro flash", { type: "solid", w: c.stage.w, h: c.stage.h, color }, { intro: true, blend: "add", transform: tf({ opacity: keys([{ t: 0, v: 0, e: "out" }, { t: r3(I * a), v: 0, e: "out" }, { t: r3(I * (a + 0.06)), v: peak, e: "out" }, { t: r3(I * (a + 0.5)), v: 0, e: "linear" }, { t: r3(I), v: 0, e: "linear" }]) }) });
}

/** A band of light crossing a strip from one side to the other. */
function introSweep(c: Ctx, color: string): Clip {
  const I = c.intro;
  return make(c, "Intro sweep", { type: "gradient", w: c.stage.w * 0.28, h: c.stage.h * 1.6, kind: "linear", angle: 0, stops: [{ o: 0, c: clear(color) }, { o: 0.5, c: alpha(color, 0.55) }, { o: 1, c: clear(color) }] }, {
    intro: true,
    blend: "add",
    transform: tf({ x: { k: [{ t: 0, v: r3(-c.stage.w * 0.62), e: "linear" }, { t: r3(I), v: r3(c.stage.w * 0.62), e: "linear" }] }, opacity: { k: [{ t: 0, v: 0, e: "linear" }, { t: r3(I * 0.1), v: 1, e: "linear" }, { t: r3(I * 0.85), v: 1, e: "linear" }, { t: r3(I), v: 0, e: "linear" }] } }),
  });
}

/** Rings of light spreading from a point, one after another. */
function introRings(c: Ctx, color: string, o: { n?: number; x?: number; y?: number; size?: number; to?: number } = {}): Clip[] {
  const I = c.intro;
  const size = o.size ?? dim(c) * 0.3;
  const to = o.to ?? 3.4;
  const grow = (from: number): Prop => keys([{ t: 0, v: 0.1, e: "linear" }, { t: r3(from), v: 0.1, e: "out" }, { t: r3(from + I * 0.7), v: to, e: "linear" }, { t: r3(I), v: to, e: "linear" }]);
  return Array.from({ length: o.n ?? 2 }, (_, i) => {
    const from = I * 0.14 * i;
    return make(c, `Intro ring ${i + 1}`, { type: "shape", shape: "ring", w: size, h: size, fill: "#ffffff00", stroke: color, strokeWidth: 8, radius: 0, points: 5, inner: 0.5 }, {
      intro: true,
      blend: "add",
      fx: [glow(color, 14, 1.6)],
      transform: tf({ x: o.x ?? 0, y: o.y ?? 0, scaleX: grow(from), scaleY: grow(from), opacity: keys([{ t: 0, v: 0, e: "linear" }, { t: r3(from), v: 0, e: "out" }, { t: r3(from + 0.03), v: 1, e: "out" }, { t: r3(from + I * 0.7), v: 0, e: "linear" }, { t: r3(I), v: 0, e: "linear" }]) }),
    });
  });
}

/** Everything thrown out at once, falling or fading before the intro ends. */
function introBurst(c: Ctx, o: Partial<Particles> & { x?: number; y?: number; count?: number; name?: string } = {}): Clip {
  const { x, y, count, name, ...p } = o;
  return make(c, name ?? "Intro burst", part(c, { shape: "star", mode: "burst", w: 4, h: 4, count: cnt(c, count ?? 60), life: c.intro, speed: 320, speedJitter: 0.5, angle: -90, spread: 360, gravity: 160, size: 10, sizeJitter: 0.5, sizeEnd: 0.4, spin: 200, colors: ["#ffffff"], fadeIn: 0, fadeOut: 0.45, seed: c.seed + 41, ...p }), { intro: true, blend: "add", transform: tf({ x: x ?? 0, y: y ?? 0 }) });
}

/** The usual opening for a strip (a flash and a sweep) or a card (a flash and rings). */
const opening = (c: Ctx, color: string, accent: string, flash = 0.5): Clip[] => [introFlash(c, color, flash), strip(c) ? introSweep(c, accent) : introRings(c, accent, { n: 2 })[0]];

/** A circle of small shapes round a point, turning as one. Drawn as a compound so it is a single clip that rotates about `at`. */
function ringOf(c: Ctx, name: string, at: [number, number], n: number, radius: number, shape: (i: number, angle: number) => Source, o: { turns: number; a?: number; fx?: ClipFx[]; blend?: BlendMode; offset?: number }): Clip {
  const inner: Clip[] = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (o.offset ?? 0);
    return newClip(tidy(shape(i, (a * 180) / Math.PI)), { name: `${name} ${i + 1}`, duration: c.duration, transform: tf({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, rotation: (a * 180) / Math.PI + 90 }) });
  });
  return make(c, name, { type: "compound", duration: c.duration, clips: inner }, { blend: o.blend ?? "add", fx: o.fx, transform: tf({ x: at[0], y: at[1], rotation: spin(c, o.turns), opacity: o.a ?? 1 }) });
}

const star = (w: number, color: string, points = 4, inner = 0.35): Source => ({ type: "shape", shape: "star", w, h: w, fill: color, stroke: color, strokeWidth: 0, radius: 0, points, inner });
const disc = (w: number, color: string, h = w): Source => ({ type: "shape", shape: "ellipse", w, h, fill: color, stroke: color, strokeWidth: 0, radius: 0, points: 5, inner: 0.5 });
const box = (w: number, h: number, color: string, radius = 0): Source => ({ type: "shape", shape: "rect", w, h, fill: color, stroke: color, strokeWidth: 0, radius, points: 5, inner: 0.5 });
const ring = (w: number, color: string, stroke: number): Source => ({ type: "shape", shape: "ring", w, h: w, fill: color, stroke: color, strokeWidth: stroke, radius: 0, points: 5, inner: 0.5 });
const tri = (w: number, h: number, color: string): Source => ({ type: "shape", shape: "triangle", w, h, fill: color, stroke: color, strokeWidth: 0, radius: 0, points: 3, inner: 0.5 });
const grad = (c: Ctx, angle: number, stops: [number, string][], o: { w?: number; h?: number } = {}): Source => ({ type: "gradient", w: o.w ?? c.stage.w, h: o.h ?? c.stage.h, kind: "linear", angle, stops: stops.map(([o2, col]) => ({ o: o2, c: col })) });

/** A crystal: a tall triangle with a lighter facet on one side, that grows from its base during the intro. */
function crystal(c: Ctx, name: string, x: number, base: number, w: number, h: number, body: string, facet: string, phase: number, tilt = 0): Clip[] {
  const grow = (delay: number): Prop => keys([{ t: 0, v: 0.02, e: "out" }, { t: r3(c.intro * delay), v: 0.02, e: "out" }, { t: r3(Math.min(c.intro * 0.95, c.intro * delay + c.intro * 0.55)), v: 1, e: "back" }, { t: r3(c.duration), v: 1, e: "linear" }]);
  const delay = Math.min(0.35, Math.abs(x) / 3000 + phase * 0.2);
  const at = (src: Source, tag: string, extra: Partial<Transform>, fx?: ClipFx[]) => make(c, `${name} ${tag}`, src, { fx, transform: tf({ x, y: base, rotation: tilt, anchorY: 1, scaleX: 1, scaleY: grow(delay), ...extra }) });
  return [
    at(tri(w, h, body), "body", { opacity: cycle(c, 3.4, [[0, 0.82], [0.5, 1]], phase) }, [glow(facet, 12, 1.1)]),
    at(tri(w * 0.5, h * 0.92, facet), "facet", { x: x + w * 0.12, opacity: cycle(c, 3.4, [[0, 0.35], [0.5, 0.8]], phase + 0.3) }),
  ];
}

// --- Nameplates (960 × 176) -----------------------------------------------------------------------------------------------

const W = MOTION_STAGES.nameplate.w;
const H = MOTION_STAGES.nameplate.h;

const lofiRooftop: CollectionDesign = {
  slug: "lofi-rooftop-nameplate",
  name: "Lofi Rooftop",
  kind: "nameplate",
  description: "Dusk over a quiet city: a violet-to-pink sky, a moon, slow clouds and little windows switching on and off along the skyline.",
  priceCents: 299,
  colors: ["#5b4bdb", "#ff9ac1", "#ffe3a0", "#3a2a86"],
  duration: 6,
  intro: 1.4,
  build: (c) => {
    const rnd = rng(7 + c.seed);
    const near = [58, 96, 72, 108, 66, 90, 78, 100];
    const clips: Clip[] = [
      make(c, "Sky", grad(c, 90, [[0, "#5b4bdb"], [0.55, "#b06ee8"], [1, "#ff9ac1"]]), { ramp: false }),
      haze(c, "#ffd1e8", { a: 0.32, scale: 240, speed: 0.12, contrast: 0.4, seed: 5, name: "Dusk haze" }),
      make(c, "Stars", part(c, { shape: "star", w: W * 0.9, h: H * 0.5, count: cnt(c, 26), life: fit(c, 2.6), speed: 0, size: 8, sizeEnd: 0, colors: ["#ffffff", "#ffe9a8"], fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 19 }), { blend: "add", transform: tf({ x: 0, y: -H * 0.2 }) }),
      bed(c, "#fff1d6", { a: 0.5, x: 330, y: -26, w: 150, h: 150, name: "Moon glow", period: 5 }),
      make(c, "Moon", disc(30, "#fff3d6"), { fx: [glow("#ffe9b8", 16, 1.5)], transform: tf({ x: 330, y: -26 }) }),
      crossing(c, "Cloud", puff(260, 40, "#ffc8e6"), { from: -W * 0.62, to: W * 0.62, y: -46, a: 0.85, blend: "screen", sy: 0.2 }),
      crossing(c, "Cloud 2", puff(190, 30, "#ffd9ee"), { from: -W * 0.62, to: W * 0.62, y: -8, a: 0.7, phase: 0.5, blend: "screen", sy: 0.2 }),
    ];
    // A far skyline, lighter and softer, then the near one.
    [-410, -190, 40, 250, 430].forEach((x, i) => clips.push(make(c, `Far building ${i + 1}`, box(120, 70 + (i % 3) * 18, "#7d5cd0", 4), { transform: tf({ x, y: H / 2 - 35 - (i % 3) * 9, opacity: 0.7 }) })));
    near.forEach((h, i) => clips.push(make(c, `Building ${i + 1}`, box(84 + (i % 3) * 8, h, "#33257c", 3), { transform: tf({ x: -420 + i * 125 + (rnd() - 0.5) * 24, y: H / 2 - h / 2 + 6 }) })));
    // Windows on the nearer buildings: some steady, some switching on and off.
    [1, 3, 4, 5, 6, 7, 2, 0].forEach((b, i) => {
      const h = near[b];
      const x = -420 + b * 125 + (i % 2 ? 16 : -16);
      clips.push(make(c, `Window ${i + 1}`, box(11, 15, "#ffe3a0", 1.5), { blend: "add", fx: [glow("#ffcf70", 7, 1.2)], transform: tf({ x, y: H / 2 - h + 24 + (i % 3) * 20, opacity: i % 3 === 0 ? 0.95 : cycle(c, 2.4 + (i % 3), [[0, 0.95], [0.5, 0.1]], i / 8) }) }));
    });
    clips.push(make(c, "Ledge", box(W, 12, "#241a5e"), { transform: tf({ y: H / 2 - 4 }) }));
    clips.push(sweep(c, "#ffd9f0", { a: 0.3, period: 4, width: 0.12 }));
    clips.push(introFlash(c, "#ffd0e8", 0.35), introSweep(c, "#ffe0f2"), introBurst(c, { name: "Shooting stars", shape: "star", x: 380, y: -80, w: 60, h: 20, count: 14, speed: 420, angle: 150, spread: 20, gravity: 0, size: 8, colors: ["#ffffff", "#ffe9a8"] }));
    return clips;
  },
};

const stormChaser: CollectionDesign = {
  slug: "storm-chaser-nameplate",
  name: "Storm Chaser",
  kind: "nameplate",
  description: "A night storm rolling in: dark cloud, slanting rain and two strikes of lightning every loop that light the whole strip.",
  priceCents: 299,
  colors: ["#0b1228", "#3b4a78", "#bfdbfe", "#f0f9ff"],
  duration: 6,
  intro: 1.4,
  build: (c) => [
    make(c, "Night", grad(c, 90, [[0, "#0b1228"], [0.6, "#1e2b4f"], [1, "#3b4a78"]]), { ramp: false }),
    haze(c, "#8ea2d6", { a: 0.7, scale: 260, speed: 0.12, contrast: 0.75, seed: 3, blend: "normal", name: "Storm cloud" }),
    crossing(c, "Anvil cloud", puff(520, 90, "#a9b8e8"), { from: -W * 0.5, to: W * 0.5, y: -H * 0.28, a: 0.75, blend: "screen", sy: 0.28 }),
    crossing(c, "Anvil cloud 2", puff(420, 80, "#7f93d0"), { from: -W * 0.5, to: W * 0.5, y: H * 0.05, a: 0.6, phase: 0.5, blend: "screen", sy: 0.26 }),
    make(c, "Rain far", part(c, { shape: "dot", w: W * 1.2, h: 10, count: cnt(c, 150), life: fit(c, 1.3), speed: 360, angle: 100, spread: 3, size: 3, sizeEnd: 0.8, colors: ["#93c5fd"], fadeIn: 0.05, fadeOut: 0.3, seed: c.seed + 5 }), { transform: tf({ y: -H / 2, opacity: 0.6 }), fx: [blur(1)] }),
    make(c, "Rain", part(c, { shape: "dot", w: W * 1.2, h: 10, count: cnt(c, 150), life: fit(c, 0.9), speed: 540, speedJitter: 0.2, angle: 100, spread: 3, size: 4, sizeEnd: 0.8, colors: ["#e0f2fe", "#bfdbfe"], fadeIn: 0.05, fadeOut: 0.3 }), { transform: tf({ y: -H / 2, opacity: 0.95 }) }),
    ...bolt(c, "Bolt", [250, -H / 2], [215, H / 2], strike(c, 0.22), { seed: 3, jag: 18 }),
    ...bolt(c, "Bolt 2", [420, -H / 2], [455, H / 2], strike(c, 0.58), { seed: 8, jag: 16, width: 2.5 }),
    make(c, "Flash", { type: "solid", w: W, h: H, color: "#bfdbfe" }, { blend: "add", transform: tf({ opacity: cycle(c, c.idle, [[0, 0, "out"], [0.22, 0, "out"], [0.225, 0.4, "out"], [0.3, 0, "out"], [0.58, 0, "out"], [0.585, 0.32, "out"], [0.66, 0, "out"]]) }) }),
    make(c, "Ripples", part(c, { shape: "ring", w: W * 0.9, h: 8, count: cnt(c, 16), life: fit(c, 1.4), speed: 0, size: 12, sizeEnd: 2.2, colors: ["#93c5fd"], fadeIn: 0.1, fadeOut: 0.7, seed: c.seed + 13 }), { blend: "add", transform: tf({ x: 60, y: H * 0.4, scaleY: 0.35, opacity: 0.7 }) }),
    edgeGlow(c, "#60a5fa", 0.28),
    introFlash(c, "#dbeafe", 0.9),
    introFlash(c, "#dbeafe", 0.7, 0.4),
    introBurst(c, { name: "Downpour", shape: "dot", w: W * 1.2, h: 10, y: -H / 2, count: 110, speed: 700, speedJitter: 0.2, angle: 100, spread: 5, gravity: 700, size: 3, sizeEnd: 0.8, spin: 0, colors: ["#bfdbfe"] }),
  ],
};

const runeCircle: CollectionDesign = {
  slug: "rune-circle-nameplate",
  name: "Rune Circle",
  kind: "nameplate",
  description: "An arcane circle in violet and cyan: two rings of runes turning against each other under a rising glow, with motes drifting up.",
  priceCents: 299,
  colors: ["#2e1065", "#a78bfa", "#f0abfc", "#67e8f9"],
  duration: 6,
  intro: 1.6,
  build: (c) => {
    const at: [number, number] = [320, 0];
    return [
      make(c, "Void", grad(c, 0, [[0, "#12062b"], [0.5, "#2e1065"], [1, "#4c1d95"]]), { ramp: false }),
      bed(c, "#c026d3", { a: 0.55, x: 320, w: 520, h: 300, name: "Aura", period: 3.6 }),
      rays(c, "Beams", 14, "#c4b5fd", { x: 320, r: 330, a: 0.22, softness: 0.85 }),
      make(c, "Outer ring", ring(172, "#c4b5fd", 3), { blend: "add", fx: [glow("#a78bfa", 10, 1.4)], transform: tf({ x: 320, opacity: cycle(c, 3, [[0, 0.7], [0.5, 1]]) }) }),
      make(c, "Mid ring", ring(124, "#f0abfc", 2), { blend: "add", fx: [glow("#e879f9", 8, 1.3)], transform: tf({ x: 320, opacity: cycle(c, 3, [[0, 0.95], [0.5, 0.6]]) }) }),
      ringOf(c, "Runes", at, 8, 66, () => star(15, "#e9d5ff"), { turns: 1, fx: [glow("#c084fc", 8, 1.5)] }),
      ringOf(c, "Inner runes", at, 12, 47, (i) => (i % 2 ? box(5, 5, "#67e8f9") : disc(5, "#a5f3fc")), { turns: -2, fx: [glow("#22d3ee", 6, 1.3)] }),
      make(c, "Heart", star(26, "#ffffff", 4, 0.28), { blend: "add", fx: [glow("#e879f9", 14, 2)], transform: tf({ x: 320, rotation: spin(c, 1), scale: cycle(c, 2.4, [[0, 0.85], [0.5, 1.15]]) }) }),
      make(c, "Motes", part(c, { shape: "spark", w: 360, h: 10, count: cnt(c, 34), life: fit(c, 3), speed: 46, angle: -90, spread: 40, size: 8, sizeEnd: 0, spin: 160, colors: ["#e9d5ff", "#a5f3fc", "#f0abfc"], drift: 14, fadeIn: 0.2, fadeOut: 0.5, seed: c.seed + 9 }), { blend: "add", transform: tf({ x: 320, y: H * 0.5 }) }),
      sweep(c, "#e9d5ff", { a: 0.28, period: 4.5, width: 0.1, angle: 24 }),
      introFlash(c, "#d8b4fe", 0.6),
      ...introRings(c, "#e879f9", { n: 3, x: 320, size: 150, to: 3 }),
      introBurst(c, { x: 320, count: 70, shape: "spark", speed: 300, gravity: 0, size: 10, colors: ["#f5d0fe", "#a5f3fc"] }),
    ];
  },
};

const treasureVault: CollectionDesign = {
  slug: "treasure-vault-nameplate",
  name: "Treasure Vault",
  kind: "nameplate",
  description: "A glittering hoard: a heap of gold under turning rays, coins tumbling past and glints catching the light.",
  priceCents: 299,
  colors: ["#2b1305", "#b45309", "#fbbf24", "#fff7d6"],
  duration: 6,
  intro: 1.5,
  build: (c) => {
    const heap: Clip[] = [];
    const gold = ["#fbbf24", "#f59e0b", "#fcd34d", "#d97706"];
    for (let i = 0; i < 12; i++) {
      const x = -100 + i * 52;
      const lift = Math.max(0, 1 - Math.abs(x - 250) / 300) * 36;
      heap.push(make(c, `Coins ${i + 1}`, disc(78, gold[i % 4], 34), { transform: tf({ x, y: H / 2 - 8 - lift + (i % 3) * 3 }) }));
    }
    return [
      make(c, "Vault", grad(c, 0, [[0, "#2b1305"], [0.55, "#6b3410"], [1, "#b45309"]]), { ramp: false }),
      rays(c, "Sunburst", 16, "#fde68a", { x: 260, y: 20, r: 360, a: 0.3, softness: 0.7 }),
      bed(c, "#fbbf24", { a: 0.6, x: 260, y: 30, w: 520, h: 260, name: "Gold light", period: 3.2 }),
      ...heap,
      sweep(c, "#fff7d6", { a: 0.65, period: 3, width: 0.1, angle: 18 }),
      make(c, "Coins falling", part(c, { shape: "dot", w: 520, h: 10, count: cnt(c, 16), life: fit(c, 3), speed: 130, angle: 90, spread: 8, size: 13, sizeJitter: 0.3, sizeEnd: 1, colors: gold, drift: 6, fadeIn: 0.1, fadeOut: 0.2, seed: c.seed + 4 }), { fx: [glow("#fbbf24", 6, 1)], transform: tf({ x: 250, y: -H / 2 }) }),
      make(c, "Glints", part(c, { shape: "spark", w: 560, h: H * 0.8, count: cnt(c, 22), life: fit(c, 1.8), speed: 0, size: 12, sizeEnd: 0, spin: 90, colors: ["#ffffff", "#fff3b0"], fadeIn: 0.3, fadeOut: 0.5, seed: c.seed + 12 }), { blend: "add", transform: tf({ x: 250, y: 6 }) }),
      edgeGlow(c, "#f59e0b", 0.35),
      introFlash(c, "#fde68a", 0.7),
      introSweep(c, "#fff3b0"),
      introBurst(c, { name: "Coin burst", shape: "dot", x: 250, y: H * 0.35, count: 40, speed: 380, speedJitter: 0.5, angle: -90, spread: 90, gravity: 520, size: 12, colors: gold, spin: 0 }),
    ];
  },
};

const goldenGroove: CollectionDesign = {
  slug: "golden-groove-nameplate",
  name: "Golden Groove",
  kind: "nameplate",
  description: "Seventies sunset: a turning sunburst behind thick orange, pink and violet rings that breathe in time.",
  priceCents: 299,
  colors: ["#7c1d6f", "#f97316", "#facc15", "#ec4899"],
  duration: 6,
  intro: 1.4,
  build: (c) => {
    const bands = ["#7c3aed", "#ec4899", "#f97316", "#facc15", "#fff1b8"];
    return [
      make(c, "Dusk", grad(c, 0, [[0, "#3b0a45"], [0.5, "#9d174d"], [1, "#c2410c"]]), { ramp: false }),
      rays(c, "Sunburst", 22, colorLoop(c, ["#fb923c", "#facc15", "#f472b6"]), { x: 300, r: 380, a: 0.42, softness: 0.25, steps: 2 }),
      ...bands.map((col, i) => make(c, `Band ${i + 1}`, ring(300 - i * 52, col, 22), { transform: tf({ x: 300, y: 70, scale: cycle(c, 3, [[0, 0.97], [0.5, 1.04]], i * 0.08), opacity: 0.95 }) })),
      make(c, "Sun", disc(70, "#fffbe6"), { blend: "add", fx: [glow("#fde047", 16, 1.6)], transform: tf({ x: 300, y: 70, scale: cycle(c, 3, [[0, 0.95], [0.5, 1.08]]) }) }),
      twinkles(c, 12, 11, { colors: ["#ffffff", "#fde68a"], seed: 17 }),
      sweep(c, "#fff1b8", { a: 0.35, period: 4, width: 0.14, angle: -24 }),
      edgeGlow(c, "#f472b6", 0.3),
      introFlash(c, "#fde68a", 0.5),
      introSweep(c, "#ffffff"),
      introBurst(c, { x: 300, y: 40, count: 50, shape: "star", speed: 300, gravity: 80, colors: ["#fde68a", "#f472b6", "#ffffff"] }),
    ].map((clip) => clip);
  },
};

const mischiefNight: CollectionDesign = {
  slug: "mischief-night-nameplate",
  name: "Mischief Night",
  kind: "nameplate",
  description: "Green and violet smoke in the dark, with two pairs of yellow eyes that blink, one after the other, when they think you're not looking.",
  priceCents: 299,
  colors: ["#070b18", "#4ade80", "#a855f7", "#facc15"],
  duration: 6,
  intro: 1.4,
  build: (c) => {
    const eyes = (name: string, x: number, y: number, phase: number): Clip[] => {
      const blink = cycle(c, 3.6, [[0, 1], [0.46, 1], [0.5, 0.06], [0.55, 1]], phase);
      const eye = (side: number) => [
        make(c, `${name} eye ${side}`, disc(30, "#facc15", 19), { blend: "add", fx: [glow("#fde047", 10, 1.8)], transform: tf({ x: x + side * 28, y, scaleY: blink }) }),
        make(c, `${name} pupil ${side}`, disc(7, "#14081f", 18), { transform: tf({ x: x + side * 28 + 2, y, scaleY: blink }) }),
      ];
      return [...eye(-1), ...eye(1)];
    };
    return [
      make(c, "Dark", grad(c, 0, [[0, "#070b18"], [0.6, "#150a2b"], [1, "#24103f"]]), { ramp: false }),
      haze(c, "#a855f7", { a: 0.5, scale: 200, speed: 0.18, contrast: 0.55, blend: "add", seed: 4, name: "Violet smoke" }),
      haze(c, "#4ade80", { a: 0.42, scale: 160, speed: -0.14, contrast: 0.6, blend: "add", seed: 11, name: "Green smoke" }),
      make(c, "Wisps", part(c, { shape: "dot", w: W * 0.8, h: 10, count: cnt(c, 8), life: fit(c, 6), speed: 20, angle: -90, spread: 50, size: 30, sizeJitter: 0.4, sizeEnd: 1.2, colors: ["#4ade80", "#a855f7"], drift: 24, fadeIn: 0.35, fadeOut: 0.45, seed: c.seed + 47 }), { blend: "add", fx: [blur(5)], transform: tf({ x: 120, y: H * 0.4 }) }),
      ...eyes("Left", 220, -10, 0),
      ...eyes("Right", 400, 22, 0.5),
      sweep(c, "#bbf7d0", { a: 0.22, period: 4.5, width: 0.1, angle: 30 }),
      edgeGlow(c, "#22c55e", 0.3),
      introFlash(c, "#86efac", 0.5),
      introSweep(c, "#c084fc"),
    ];
  },
};

const pizzazz: CollectionDesign = {
  slug: "pizzazz-nameplate",
  name: "Pizzazz",
  kind: "nameplate",
  description: "A party in a strip: a colour wash that slides through pink, violet and teal, confetti raining down and a pop of streamers when it opens.",
  priceCents: 299,
  colors: ["#ff4d8d", "#8b5cf6", "#2dd4bf", "#ffd23f"],
  duration: 6,
  intro: 1.4,
  build: (c) => {
    const party = ["#ff4d8d", "#ffd23f", "#2dd4bf", "#60a5fa", "#a78bfa"];
    return [
      make(c, "Wash", { type: "gradient", w: W, h: H, kind: "linear", angle: 0, stops: [{ o: 0, c: colorLoop(c, ["#ff4d8d", "#8b5cf6", "#2dd4bf"]) }, { o: 0.55, c: colorLoop(c, ["#8b5cf6", "#2dd4bf", "#ff4d8d"]) }, { o: 1, c: colorLoop(c, ["#2dd4bf", "#ff4d8d", "#8b5cf6"]) }] }, { ramp: false }),
      make(c, "Confetti", part(c, { shape: "square", w: W * 0.9, h: 10, count: cnt(c, 70), life: fit(c, 3), speed: 110, angle: 90, spread: 14, size: 8, sizeJitter: 0.5, sizeEnd: 1, spin: 380, colors: party, drift: 18, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 3 }), { transform: tf({ y: -H / 2 }) }),
      make(c, "Dots", part(c, { shape: "dot", w: W, h: H, count: cnt(c, 34), life: fit(c, 2), speed: 0, size: 7, sizeEnd: 0, colors: ["#ffffff"], fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 8 }), { blend: "add", transform: tf({ opacity: 0.8 }) }),
      twinkles(c, 14, 13, { colors: ["#ffffff", "#fff3b0"], seed: 23 }),
      sweep(c, "#ffffff", { a: 0.55, period: 3, width: 0.12, angle: 24 }),
      sweep(c, "#fff3b0", { a: 0.35, period: 6, width: 0.2, angle: -30, seed: 4 }),
      edgeGlow(c, "#ffffff", 0.25),
      introFlash(c, "#ffffff", 0.45),
      introSweep(c, "#ffffff"),
      introBurst(c, { name: "Pop left", shape: "square", x: -430, y: H / 2, w: 6, h: 6, count: 60, speed: 600, angle: -35, spread: 55, gravity: 520, size: 10, spin: 480, colors: party }),
      introBurst(c, { name: "Pop right", shape: "square", x: 430, y: H / 2, w: 6, h: 6, count: 60, speed: 600, angle: -145, spread: 55, gravity: 520, size: 10, spin: 480, colors: party, seed: c.seed + 57 }),
    ];
  },
};

const crystalCavern: CollectionDesign = {
  slug: "crystal-cavern-nameplate",
  name: "Crystal Cavern",
  kind: "nameplate",
  description: "Crystals pushing up out of the dark in violet, cyan and magenta, each one glowing in its own time, with light sliding across the facets.",
  priceCents: 299,
  colors: ["#0f0a2a", "#7c3aed", "#06b6d4", "#c026d3"],
  duration: 6,
  intro: 1.6,
  build: (c) => {
    const body = ["#7c3aed", "#06b6d4", "#c026d3", "#6366f1"];
    const facet = ["#c4b5fd", "#a5f3fc", "#f0abfc", "#c7d2fe"];
    const set: [number, number, number, number][] = [[-60, 36, 120, 0], [20, 52, 150, 4], [110, 44, 132, -3], [190, 60, 160, 3], [280, 40, 118, -5], [360, 56, 148, 2], [440, 38, 114, -2]];
    return [
      make(c, "Cave", grad(c, 90, [[0, "#0f0a2a"], [0.6, "#1e1b4b"], [1, "#312e81"]]), { ramp: false }),
      bed(c, "#06b6d4", { a: 0.4, x: 260, y: 30, w: 560, h: 260, name: "Cyan light", period: 4 }),
      bed(c, "#c026d3", { a: 0.3, x: 40, y: 30, w: 400, h: 240, name: "Magenta light", period: 5 }),
      ...set.flatMap(([x, w, h, tilt], i) => crystal(c, `Crystal ${i + 1}`, x, H / 2 + 6, w, h, body[i % 4], facet[i % 4], i / 7, tilt)),
      make(c, "Dust", part(c, { shape: "spark", w: 560, h: H, count: cnt(c, 20), life: fit(c, 4), speed: 8, spread: 360, size: 8, sizeEnd: 0, spin: 60, colors: ["#e9d5ff", "#a5f3fc"], drift: 18, fadeIn: 0.35, fadeOut: 0.4, seed: c.seed + 6 }), { blend: "add", transform: tf({ x: 200 }) }),
      sweep(c, "#e0f2fe", { a: 0.4, period: 3.4, width: 0.1, angle: 24 }),
      introFlash(c, "#c4b5fd", 0.45),
      introSweep(c, "#a5f3fc"),
      introBurst(c, { x: 200, y: H * 0.4, count: 50, shape: "spark", speed: 280, angle: -90, spread: 120, gravity: 200, size: 10, colors: ["#e9d5ff", "#a5f3fc", "#f0abfc"] }),
    ];
  },
};

const lsdTrip: CollectionDesign = {
  slug: "lsd-trip-nameplate",
  name: "LSD Trip",
  kind: "nameplate",
  description: "Total sensory overload: a gradient that never stops turning, three kaleidoscopes spinning against each other, hypnotic rings, colour clouds that melt into one another, rays in three directions, glitch bars and a blizzard of confetti going every way at once, all pushed through a hue shift that won't sit still. Nothing on it is standing still, and you are not meant to be able to follow it.",
  priceCents: 299,
  colors: ["#ff00c8", "#00f0ff", "#ffee00", "#7a00ff"],
  duration: 6,
  intro: 1.4,
  build: (c) => {
    const rainbow = ["#ff00c8", "#ffee00", "#00f0ff", "#7a00ff", "#00ff6a"];
    const shift = (k: number) => [...rainbow.slice(k), ...rainbow.slice(0, k)];
    const crazy = ["#ff00c8", "#ffee00", "#00f0ff", "#7a00ff", "#00ff6a", "#ff5a00"];
    // A circle of shapes that turns whole turns each loop, against its neighbours: the kaleidoscope.
    const mandala = (name: string, x: number, count: number, radius: number, turns: number, shape: (i: number) => Source, glowColor: string) =>
      ringOf(c, name, [x, 0], count, radius, (i) => shape(i), { turns, blend: "normal", fx: [glow(glowColor, 7, 1.3)] });
    const hyp = (i: number, x: number, color: string): Clip =>
      make(c, `Ring ${i + 1}`, ring(120, color, 7), {
        blend: "add",
        fx: [glow(color, 10, 1.6)],
        transform: tf({ x, scaleX: cycle(c, 1.5, [[0, 0.2, "out"], [0.99, 3.4]], i / 4), scaleY: cycle(c, 1.5, [[0, 0.2, "out"], [0.99, 3.4]], i / 4), opacity: cycle(c, 1.5, [[0, 0], [0.1, 0.8, "out"], [0.9, 0]], i / 4) }),
      });
    const bar = (i: number): Clip =>
      make(c, `Glitch bar ${i + 1}`, { type: "solid", w: W, h: 7 + i * 9, color: crazy[(i * 2) % crazy.length] }, {
        blend: "add",
        transform: tf({
          y: (i - 0.5) * H * 0.4,
          x: cycle(c, 2.2 + i * 0.4, [[0, 0], [0.1, 60 - i * 40], [0.14, -44], [0.2, 0]], i / 3),
          opacity: cycle(c, 2.2 + i * 0.4, [[0, 0, "out"], [0.1, 0.6, "out"], [0.14, 0, "out"], [0.5, 0, "out"], [0.55, 0.5, "out"], [0.58, 0, "out"]], i / 3),
        }),
      });
    const spray = (name: string, shape: Particles["shape"], x: number, w: number, h: number, angle: number, spread: number, count: number, size: number, speed: number, seed: number): Clip =>
      make(c, name, part(c, { shape, w, h, count: cnt(c, count), life: fit(c, 1.9), speed, speedJitter: 0.6, angle, spread, size, sizeJitter: 0.6, sizeEnd: 1, spin: 520, colors: crazy, drift: 24, fadeIn: 0.05, fadeOut: 0.2, seed: c.seed + seed }), { transform: tf({ x }) });
    return [
      make(c, "Wash", {
        type: "gradient", w: W * 1.6, h: W * 1.6, kind: "linear", angle: spin(c, 1),
        stops: [{ o: 0, c: colorLoop(c, shift(0)) }, { o: 0.33, c: colorLoop(c, shift(2)) }, { o: 0.66, c: colorLoop(c, shift(4)) }, { o: 1, c: colorLoop(c, shift(1)) }],
      }, { ramp: false }),
      haze(c, "#ff00c8", { a: 0.4, scale: 90, speed: 0.7, contrast: 0.95, blend: "overlay", seed: 3, name: "Melting magenta" }),
      haze(c, "#00f0ff", { a: 0.4, scale: 130, speed: -0.55, contrast: 0.95, blend: "hardLight", seed: 12, name: "Melting cyan" }),
      rays(c, "Rays A", 16, colorLoop(c, shift(1)), { x: -300, r: 340, a: 0.3, softness: 0.3, steps: 2 }),
      rays(c, "Rays B", 24, colorLoop(c, shift(3)), { x: 300, r: 340, a: 0.28, softness: 0.3, dir: -1, steps: 3 }),
      rays(c, "Rays C", 11, colorLoop(c, shift(2)), { x: 0, r: 520, a: 0.16, softness: 0.55, steps: 1 }),
      mandala("Kaleidoscope A", -330, 7, 62, 1, (i) => (i % 2 ? star(22, "#ffee00", 5, 0.4) : disc(16, "#ff00c8")), "#ff00c8"),
      mandala("Kaleidoscope B", 40, 7, 74, -2, (i) => (i % 2 ? box(14, 14, "#00f0ff", 3) : star(24, "#ffffff", 4, 0.3)), "#00f0ff"),
      mandala("Kaleidoscope C", 380, 5, 52, 3, (i) => (i % 2 ? disc(20, "#00ff6a") : star(20, "#ffee00", 6, 0.5)), "#7a00ff"),
      hyp(0, 380, "#ffee00"), hyp(1, 380, "#ff00c8"), hyp(2, -330, "#00f0ff"), hyp(3, -330, "#00ff6a"),
      spray("Confetti falling", "square", 0, W, 10, 90, 20, 70, 10, 150, 3),
      spray("Stars rising", "star", 0, W, 10, -90, 25, 40, 14, 170, 8),
      spray("Hearts crossfire", "heart", -W / 2, 10, H, 0, 30, 36, 16, 360, 15),
      spray("Rings crossfire", "ring", W / 2, 10, H, 180, 30, 30, 18, 330, 22),
      sweep(c, "#ffffff", { a: 0.4, period: 2.3, width: 0.1, angle: 24, seed: 2 }),
      sweep(c, "#ffee00", { a: 0.3, period: 4.6, width: 0.2, angle: -34, seed: 9 }),
      bar(0), bar(1),
      twinkles(c, 30, 16, { colors: ["#ffffff", "#ffee00", "#00f0ff"], seed: 55 }),
      introFlash(c, "#ffffff", 0.85),
      introSweep(c, "#ff00c8"),
      ...introRings(c, "#00f0ff", { n: 3, x: 300, size: 140, to: 4.4 }),
      introBurst(c, { name: "Stars every way", shape: "star", count: 110, speed: 720, spread: 360, gravity: 0, size: 14, colors: crazy }),
      introBurst(c, { name: "Hearts every way", shape: "heart", x: -260, count: 60, speed: 540, spread: 360, gravity: 380, size: 16, colors: crazy, seed: c.seed + 77 }),
      // Last, so it is over everything: an adjustment layer that turns every colour below it all the way round the wheel and
      // oversaturates the lot, once a loop. This is what makes it impossible to settle on a colour.
      make(c, "Acid", { type: "adjust" }, { fx: [{ type: "adjust", hue: spin(c, 1), saturation: 1.35, brightness: 0.96, contrast: 1.12 }] }),
    ];
  },
};

// --- Profile effects (600 × 700) ------------------------------------------------------------------------------------------

const EW = MOTION_STAGES.effect.w;
const EH = MOTION_STAGES.effect.h;

const lightningFrame: CollectionDesign = {
  slug: "lightning-frame-effect",
  name: "Lightning Frame",
  kind: "effect",
  description: "Electricity crawling round the edge of the card: a pulsing blue frame, sparks along every side and a bolt from each corner, striking one after another.",
  priceCents: 399,
  colors: ["#7dd3fc", "#e0f2fe", "#fde047", "#1e3a8a"],
  duration: 6,
  intro: 1.6,
  build: (c) => {
    const hw = EW / 2;
    const hh = EH / 2;
    const corners: [string, [number, number], [number, number], number][] = [
      ["Bolt NW", [-hw + 6, -hh + 6], [-hw + 200, -hh + 190], 0.12],
      ["Bolt NE", [hw - 6, -hh + 6], [hw - 200, -hh + 190], 0.37],
      ["Bolt SE", [hw - 6, hh - 6], [hw - 200, hh - 190], 0.62],
      ["Bolt SW", [-hw + 6, hh - 6], [-hw + 200, hh - 190], 0.87],
    ];
    const edge = (name: string, w: number, h: number, x: number, y: number, seed: number) => make(c, name, part(c, { shape: "spark", w, h, count: cnt(c, 16), life: fit(c, 0.6), speed: 90, spread: 360, size: 9, sizeEnd: 0, spin: 300, colors: ["#e0f2fe", "#7dd3fc", "#fde047"], fadeIn: 0.1, fadeOut: 0.5, seed: c.seed + seed }), { blend: "add", fx: [glow("#38bdf8", 8, 1.3)], transform: tf({ x, y }) });
    return [
      edgeGlow(c, "#38bdf8", 0.55),
      make(c, "Frame", { type: "shape", shape: "rect", w: EW - 14, h: EH - 14, fill: "#ffffff00", stroke: "#7dd3fc", strokeWidth: 3, radius: 34, points: 5, inner: 0.5 }, { blend: "add", fx: [glow("#38bdf8", 16, 2.2)], transform: tf({ opacity: cycle(c, 1.5, [[0, 0.55], [0.3, 1], [0.45, 0.4], [0.7, 0.9]]) }) }),
      make(c, "Inner frame", { type: "shape", shape: "rect", w: EW - 30, h: EH - 30, fill: "#ffffff00", stroke: "#e0f2fe", strokeWidth: 1.5, radius: 28, points: 5, inner: 0.5 }, { blend: "add", fx: [glow("#7dd3fc", 8, 1.2)], transform: tf({ opacity: cycle(c, 2.4, [[0, 0.2], [0.2, 0.8], [0.5, 0.15], [0.75, 0.6]], 0.3) }) }),
      edge("Sparks top", EW - 40, 8, 0, -hh + 8, 1),
      edge("Sparks bottom", EW - 40, 8, 0, hh - 8, 2),
      edge("Sparks left", 8, EH - 40, -hw + 8, 0, 3),
      edge("Sparks right", 8, EH - 40, hw - 8, 0, 4),
      ...corners.flatMap(([name, from, to, at], i) => bolt(c, name, from, to, strike(c, at), { seed: 3 + i * 5, jag: 24, width: 4.4, n: 7 })),
      make(c, "Flash", { type: "solid", w: EW, h: EH, color: "#bfdbfe" }, { blend: "add", transform: tf({ opacity: cycle(c, c.idle, [[0, 0, "out"], [0.12, 0, "out"], [0.125, 0.22, "out"], [0.2, 0, "out"], [0.37, 0, "out"], [0.375, 0.22, "out"], [0.45, 0, "out"], [0.62, 0, "out"], [0.625, 0.22, "out"], [0.7, 0, "out"], [0.87, 0, "out"], [0.875, 0.22, "out"], [0.95, 0, "out"]]) }) }),
      introFlash(c, "#e0f2fe", 0.9),
      introFlash(c, "#bfdbfe", 0.7, 0.4),
      ...introRings(c, "#7dd3fc", { n: 2 }),
    ];
  },
};

const summoningCircle: CollectionDesign = {
  slug: "summoning-circle-effect",
  name: "Summoning Circle",
  kind: "effect",
  description: "A circle of runes glowing at the foot of the card, turning against a second ring, with a pillar of light and embers rising through it.",
  priceCents: 399,
  colors: ["#2e1065", "#c084fc", "#f0abfc", "#67e8f9"],
  duration: 6,
  intro: 2,
  build: (c) => {
    const at: [number, number] = [0, 200];
    const squash = (clip: Clip): Clip => ({ ...clip, transform: { ...clip.transform, scaleY: 0.42 } });
    return [
      make(c, "Pillar", puff(300, 640, "#d8b4fe"), { blend: "add", transform: tf({ y: 0, scaleX: 300 / 640, opacity: cycle(c, 3, [[0, 0.55], [0.5, 1]]) }) }),
      bed(c, "#a855f7", { a: 0.6, y: 210, w: 640, h: 300, name: "Floor glow", period: 3 }),
      squash(make(c, "Outer ring", ring(430, "#c4b5fd", 4), { blend: "add", fx: [glow("#a78bfa", 12, 1.5)], transform: tf({ y: 200, opacity: cycle(c, 3, [[0, 0.7], [0.5, 1]]) }) })),
      squash(make(c, "Mid ring", ring(330, "#f0abfc", 3), { blend: "add", fx: [glow("#e879f9", 10, 1.3)], transform: tf({ y: 200, opacity: cycle(c, 3, [[0, 1], [0.5, 0.6]]) }) })),
      squash(ringOf(c, "Runes", at, 10, 188, () => star(26, "#e9d5ff"), { turns: 1, fx: [glow("#c084fc", 10, 1.6)] })),
      squash(ringOf(c, "Inner runes", at, 14, 134, (i) => (i % 2 ? box(8, 8, "#67e8f9") : disc(8, "#a5f3fc")), { turns: -2, fx: [glow("#22d3ee", 8, 1.3)] })),
      make(c, "Embers", part(c, { shape: "spark", w: 300, h: 40, count: cnt(c, 46), life: fit(c, 3), speed: 130, angle: -90, spread: 30, size: 12, sizeJitter: 0.4, sizeEnd: 0, spin: 160, colors: ["#f5d0fe", "#a5f3fc", "#e9d5ff"], drift: 20, fadeIn: 0.2, fadeOut: 0.5, seed: c.seed + 9 }), { blend: "add", fx: [glow("#c084fc", 8, 1.2)], transform: tf({ y: 210 }) }),
      make(c, "Far embers", part(c, { shape: "dot", w: 520, h: 30, count: cnt(c, 40), life: fit(c, 4.5), speed: 70, angle: -90, spread: 60, size: 4, sizeEnd: 0, colors: ["#d8b4fe"], drift: 24, fadeIn: 0.2, fadeOut: 0.5, seed: c.seed + 21 }), { blend: "add", transform: tf({ y: 220, opacity: 0.7 }) }),
      edgeGlow(c, "#a855f7", 0.3),
      sweep(c, "#f5d0fe", { a: 0.22, period: 5, width: 0.12, angle: 70 }),
      introFlash(c, "#e9d5ff", 0.7),
      ...introRings(c, "#e879f9", { n: 3, y: 200, size: 160, to: 4 }),
      introBurst(c, { y: 200, count: 90, shape: "spark", speed: 520, angle: -90, spread: 140, gravity: 120, size: 12, colors: ["#f5d0fe", "#a5f3fc", "#ffffff"] }),
    ];
  },
};

const treasureRain: CollectionDesign = {
  slug: "treasure-rain-effect",
  name: "Treasure Rain",
  kind: "effect",
  description: "Gold coins and jewels tumbling down the card under a fan of golden light, glinting as they fall, with a shower of coins when it opens.",
  priceCents: 399,
  colors: ["#fbbf24", "#fff7d6", "#f43f5e", "#38bdf8"],
  duration: 6,
  intro: 1.8,
  build: (c) => {
    const gold = ["#fbbf24", "#f59e0b", "#fcd34d"];
    const jewels = ["#f43f5e", "#38bdf8", "#34d399", "#c084fc"];
    return [
      rays(c, "Sunburst", 14, "#fcd34d", { y: -EH * 0.45, r: 760, a: 0.17, softness: 0.85 }),
      bed(c, "#f59e0b", { a: 0.35, y: EH * 0.42, w: 700, h: 320, name: "Gold at the foot" }),
      make(c, "Coins far", part(c, { shape: "dot", w: EW, h: 10, count: cnt(c, 30), life: fit(c, 5.5), speed: 70, angle: 90, spread: 14, size: 9, sizeJitter: 0.3, sizeEnd: 1, colors: gold, drift: 16, fadeIn: 0.1, fadeOut: 0.2, seed: c.seed + 2 }), { fx: [blur(1.2)], transform: tf({ y: -EH / 2, opacity: 0.55 }) }),
      make(c, "Coins", part(c, { shape: "dot", w: EW, h: 10, count: cnt(c, 24), life: fit(c, 3), speed: 150, angle: 90, spread: 12, size: 17, sizeJitter: 0.3, sizeEnd: 1, colors: gold, drift: 12, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 3 }), { fx: [glow("#fbbf24", 8, 1)], transform: tf({ y: -EH / 2 }) }),
      make(c, "Rims", part(c, { shape: "ring", w: EW, h: 10, count: cnt(c, 24), life: fit(c, 3), speed: 150, angle: 90, spread: 12, size: 17, sizeJitter: 0.3, sizeEnd: 1, colors: ["#b45309"], drift: 12, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 3 }), { transform: tf({ y: -EH / 2, opacity: 0.8 }) }),
      make(c, "Jewels", part(c, { shape: "square", w: EW, h: 10, count: cnt(c, 12), life: fit(c, 3.5), speed: 130, angle: 90, spread: 14, size: 12, sizeJitter: 0.3, sizeEnd: 1, spin: 220, colors: jewels, drift: 14, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 6 }), { blend: "add", fx: [glow("#ffffff", 6, 1)], transform: tf({ y: -EH / 2 }) }),
      make(c, "Glints", part(c, { shape: "spark", w: EW, h: EH, count: cnt(c, 28), life: fit(c, 1.8), speed: 0, size: 15, sizeEnd: 0, spin: 90, colors: ["#ffffff", "#fff3b0"], fadeIn: 0.3, fadeOut: 0.5, seed: c.seed + 12 }), { blend: "add" }),
      edgeGlow(c, "#fbbf24", 0.4),
      sweep(c, "#fff7d6", { a: 0.3, period: 5, width: 0.14, angle: 28 }),
      introFlash(c, "#fde68a", 0.6),
      ...introRings(c, "#fcd34d", { n: 2, y: -EH * 0.4 }),
      introBurst(c, { name: "Coin shower", shape: "dot", y: -EH / 2, w: EW, h: 10, count: 130, speed: 520, speedJitter: 0.4, angle: 90, spread: 40, gravity: 700, size: 15, colors: gold, spin: 0 }),
    ];
  },
};

const starlitNight: CollectionDesign = {
  slug: "starlit-night-effect",
  name: "Starlit Night",
  kind: "effect",
  description: "A deep blue night over the card: a moon with a halo, stars blinking at two depths, a shooting star every loop and a low drift of cloud.",
  priceCents: 399,
  colors: ["#0b1030", "#1e3a8a", "#fff6d8", "#a5b4fc"],
  duration: 6,
  intro: 1.6,
  build: (c) => [
    make(c, "Night", { type: "gradient", w: EW, h: EH, kind: "linear", angle: 90, stops: [{ o: 0, c: alpha("#0b1030", 0.85) }, { o: 0.4, c: alpha("#1e3a8a", 0.28) }, { o: 1, c: clear("#1e3a8a") }] }),
    bed(c, "#fff1c4", { a: 0.4, x: 190, y: -250, w: 300, h: 300, name: "Moon halo", period: 5 }),
    make(c, "Moon", disc(74, "#fff6d8"), { fx: [glow("#fde68a", 18, 1.5)], transform: tf({ x: 190, y: -250 }) }),
    make(c, "Crater", disc(16, "#f1e2b8"), { transform: tf({ x: 176, y: -262, opacity: 0.9 }) }),
    make(c, "Crater 2", disc(10, "#f1e2b8"), { transform: tf({ x: 204, y: -236, opacity: 0.9 }) }),
    make(c, "Crater 3", disc(8, "#f1e2b8"), { transform: tf({ x: 198, y: -270, opacity: 0.8 }) }),
    make(c, "Stars far", part(c, { shape: "dot", w: EW, h: EH * 0.6, count: cnt(c, 40), life: fit(c, 3), speed: 0, size: 3, sizeEnd: 0, colors: ["#e0e7ff"], fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 8 }), { blend: "add", transform: tf({ y: -EH * 0.2 }) }),
    twinkles(c, 22, 14, { h: EH * 0.7, y: -EH * 0.15, colors: ["#ffffff", "#c7d2fe", "#fde68a"], seed: 31 }),
    make(c, "Shooting star", part(c, { shape: "star", w: 260, h: 10, count: 2, life: fit(c, c.idle / 2), speed: 700, angle: 32, spread: 3, size: 13, sizeEnd: 0.1, colors: ["#ffffff"], fadeIn: 0.05, fadeOut: 0.5, seed: c.seed + 33 }), { blend: "add", fx: [glow("#a5b4fc", 10, 1.6)], transform: tf({ x: -170, y: -EH * 0.4 }) }),
    crossing(c, "Cloud", puff(700, 130, "#6366f1"), { from: -EW * 0.8, to: EW * 0.8, y: EH * 0.36, a: 0.5, blend: "screen", sy: 0.2 }),
    crossing(c, "Cloud 2", puff(560, 110, "#818cf8"), { from: -EW * 0.8, to: EW * 0.8, y: EH * 0.2, a: 0.4, phase: 0.5, blend: "screen", sy: 0.2 }),
    edgeGlow(c, "#6366f1", 0.3),
    introFlash(c, "#c7d2fe", 0.4),
    ...introRings(c, "#a5b4fc", { n: 2, x: 190, y: -250, size: 90, to: 5 }),
    introBurst(c, { x: 190, y: -250, count: 40, shape: "spark", speed: 260, gravity: 0, size: 11, colors: ["#fff6d8", "#c7d2fe"] }),
  ],
};

const confettiPop: CollectionDesign = {
  slug: "confetti-pop-effect",
  name: "Confetti Pop",
  kind: "effect",
  description: "Two party poppers go off as the card opens, then a slow shower of confetti and glints keeps falling, with the edge light sliding through pink, gold and teal.",
  priceCents: 399,
  colors: ["#ff4d8d", "#ffd23f", "#2dd4bf", "#60a5fa"],
  duration: 6,
  intro: 1.8,
  build: (c) => {
    const party = ["#ff4d8d", "#ffd23f", "#2dd4bf", "#60a5fa", "#a78bfa"];
    return [
      make(c, "Edge colour", { type: "gradient", w: EW * 1.04, h: EH * 1.04, kind: "radial", angle: 0, stops: [{ o: 0, c: "#ffffff00" }, { o: 0.62, c: "#ffffff00" }, { o: 1, c: colorLoop(c, ["#ff4d8d99", "#ffd23f99", "#2dd4bf99"]) }] }, { blend: "add", transform: tf({ opacity: 0.85 }) }),
      make(c, "Streamers", part(c, { shape: "square", w: EW, h: 10, count: cnt(c, 26), life: fit(c, 6), speed: 60, angle: 90, spread: 12, size: 14, sizeJitter: 0.5, sizeEnd: 1, spin: 120, colors: party, drift: 40, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 2 }), { fx: [blur(1)], transform: tf({ y: -EH / 2, opacity: 0.6 }) }),
      make(c, "Confetti", part(c, { shape: "square", w: EW, h: 10, count: cnt(c, 46), life: fit(c, 3.6), speed: 120, angle: 90, spread: 14, size: 9, sizeJitter: 0.5, sizeEnd: 1, spin: 400, colors: party, drift: 22, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 5 }), { transform: tf({ y: -EH / 2 }) }),
      make(c, "Hearts", part(c, { shape: "heart", w: EW * 0.8, h: 10, count: cnt(c, 8), life: fit(c, 6), speed: 50, angle: -90, spread: 20, size: 20, sizeEnd: 0.5, colors: ["#ff4d8d", "#ff8fb3"], drift: 24, fadeIn: 0.2, fadeOut: 0.4, seed: c.seed + 9 }), { transform: tf({ y: EH * 0.5 }) }),
      twinkles(c, 18, 13, { colors: ["#ffffff", "#fff3b0"], seed: 41 }),
      sweep(c, "#ffffff", { a: 0.3, period: 5, width: 0.14, angle: -22 }),
      introFlash(c, "#fff3b0", 0.3),
      introBurst(c, { name: "Popper left", shape: "square", x: -EW / 2 + 10, y: EH / 2 - 10, w: 6, h: 6, count: 90, speed: 780, speedJitter: 0.5, angle: -55, spread: 50, gravity: 640, size: 12, spin: 520, colors: party }),
      introBurst(c, { name: "Popper right", shape: "square", x: EW / 2 - 10, y: EH / 2 - 10, w: 6, h: 6, count: 90, speed: 780, speedJitter: 0.5, angle: -125, spread: 50, gravity: 640, size: 12, spin: 520, colors: party, seed: c.seed + 59 }),
      introBurst(c, { name: "Stars", shape: "star", y: EH * 0.1, count: 40, speed: 420, angle: -90, spread: 200, gravity: 260, size: 14, colors: ["#ffd23f", "#ffffff"] }),
    ];
  },
};

const mischiefSmoke: CollectionDesign = {
  slug: "mischief-smoke-effect",
  name: "Mischief Smoke",
  kind: "effect",
  description: "Violet and green smoke curling up from below with a dark vignette, and two pairs of yellow eyes watching from the corners, blinking in turn.",
  priceCents: 399,
  colors: ["#070b18", "#a855f7", "#4ade80", "#facc15"],
  duration: 6,
  intro: 1.6,
  build: (c) => {
    const eyes = (name: string, x: number, y: number, phase: number, size = 1): Clip[] => {
      const blink = cycle(c, 3.6, [[0, 1], [0.46, 1], [0.5, 0.06], [0.55, 1]], phase);
      const one = (side: number) => [
        make(c, `${name} eye ${side}`, disc(26 * size, "#facc15", 15 * size), { blend: "add", fx: [glow("#fde047", 12, 1.8)], transform: tf({ x: x + side * 24 * size, y, scaleY: blink }) }),
        make(c, `${name} pupil ${side}`, disc(7 * size, "#14081f", 15 * size), { transform: tf({ x: x + side * 24 * size + 2, y, scaleY: blink }) }),
      ];
      return [...one(-1), ...one(1)];
    };
    return [
      make(c, "Vignette", { type: "gradient", w: EW * 1.05, h: EH * 1.05, kind: "radial", angle: 0, stops: [{ o: 0, c: "#07081800" }, { o: 0.4, c: "#07081800" }, { o: 1, c: "#070818dd" }] }, { transform: tf({ opacity: cycle(c, 4, [[0, 0.8], [0.5, 1]]) }) }),
      make(c, "Floor fog", { type: "gradient", w: EW, h: EH * 0.5, kind: "linear", angle: 90, stops: [{ o: 0, c: "#a855f700" }, { o: 1, c: "#a855f7aa" }] }, { blend: "screen", transform: tf({ y: EH * 0.25, opacity: cycle(c, 5, [[0, 0.6], [0.5, 1]]) }) }),
      haze(c, "#a855f7", { a: 0.4, scale: 220, speed: 0.16, contrast: 0.6, blend: "add", seed: 4, name: "Violet smoke", y: 60 }),
      haze(c, "#4ade80", { a: 0.34, scale: 180, speed: -0.13, contrast: 0.65, blend: "add", seed: 11, name: "Green smoke", y: 80 }),
      make(c, "Wisps", part(c, { shape: "dot", w: EW, h: 10, count: cnt(c, 9), life: fit(c, 6), speed: 40, angle: -90, spread: 50, size: 44, sizeJitter: 0.4, sizeEnd: 1.3, colors: ["#4ade80", "#a855f7"], drift: 30, fadeIn: 0.35, fadeOut: 0.45, seed: c.seed + 47 }), { blend: "add", fx: [blur(7)], transform: tf({ y: EH * 0.5 }) }),
      ...eyes("Top left", -170, -240, 0, 1.4),
      ...eyes("Top right", 170, -205, 0.5, 1.1),
      make(c, "Motes", part(c, { shape: "spark", w: EW, h: EH, count: cnt(c, 16), life: fit(c, 3), speed: 10, spread: 360, size: 9, sizeEnd: 0, colors: ["#bbf7d0", "#e9d5ff"], drift: 16, fadeIn: 0.35, fadeOut: 0.45, seed: c.seed + 18 }), { blend: "add" }),
      introFlash(c, "#86efac", 0.55),
      introBurst(c, { name: "Gust", shape: "dot", x: -EW / 2, w: 8, h: EH, count: 80, speed: 760, angle: 8, spread: 50, gravity: 30, size: 12, sizeEnd: 0.3, colors: ["#4ade80", "#a855f7"], spin: 0 }),
    ];
  },
};

const crystalBloom: CollectionDesign = {
  slug: "crystal-bloom-effect",
  name: "Crystal Bloom",
  kind: "effect",
  description: "Crystals push up through the foot of the card and light up from inside, in violet, cyan and magenta, while facets catch the light above them.",
  priceCents: 399,
  colors: ["#7c3aed", "#06b6d4", "#c026d3", "#e9d5ff"],
  duration: 6,
  intro: 2,
  build: (c) => {
    const body = ["#7c3aed", "#06b6d4", "#c026d3", "#6366f1"];
    const facet = ["#c4b5fd", "#a5f3fc", "#f0abfc", "#c7d2fe"];
    const base = EH / 2 + 8;
    const set: [number, number, number, number][] = [[-250, 84, 230, -8], [-150, 64, 160, -3], [-48, 90, 270, 0], [52, 70, 190, 3], [150, 86, 250, 5], [250, 66, 170, 9]];
    return [
      bed(c, "#7c3aed", { a: 0.5, y: EH * 0.42, w: 760, h: 380, name: "Violet light", period: 4 }),
      bed(c, "#06b6d4", { a: 0.34, x: 120, y: EH * 0.36, w: 420, h: 300, name: "Cyan light", period: 5 }),
      rays(c, "Facet light", 12, "#e9d5ff", { y: EH * 0.46, r: 520, a: 0.22, softness: 0.85 }),
      ...set.flatMap(([x, w, h, tilt], i) => crystal(c, `Crystal ${i + 1}`, x, base, w, h, body[i % 4], facet[i % 4], i / 6, tilt)),
      make(c, "Dust", part(c, { shape: "spark", w: EW, h: EH * 0.8, count: cnt(c, 30), life: fit(c, 4), speed: 12, angle: -90, spread: 360, size: 10, sizeEnd: 0, spin: 80, colors: ["#e9d5ff", "#a5f3fc", "#f0abfc"], drift: 22, fadeIn: 0.35, fadeOut: 0.4, seed: c.seed + 6 }), { blend: "add", transform: tf({ y: 60 }) }),
      twinkles(c, 12, 14, { h: EH * 0.6, y: -EH * 0.15, colors: ["#ffffff", "#e9d5ff"], seed: 27 }),
      edgeGlow(c, "#a855f7", 0.35),
      sweep(c, "#e0f2fe", { a: 0.3, period: 5, width: 0.12, angle: 65 }),
      introFlash(c, "#c4b5fd", 0.5),
      ...introRings(c, "#a5f3fc", { n: 2, y: EH * 0.4, size: 120, to: 5 }),
      introBurst(c, { y: EH * 0.42, count: 80, shape: "spark", speed: 460, angle: -90, spread: 150, gravity: 260, size: 12, colors: ["#e9d5ff", "#a5f3fc", "#f0abfc"] }),
    ];
  },
};

export const COLLECTION_NAMEPLATES: readonly CollectionDesign[] = [lofiRooftop, stormChaser, runeCircle, treasureVault, goldenGroove, mischiefNight, pizzazz, crystalCavern, lsdTrip];
export const COLLECTION_EFFECTS: readonly CollectionDesign[] = [lightningFrame, summoningCircle, treasureRain, starlitNight, confettiPop, mischiefSmoke, crystalBloom];
export const COLLECTION_DESIGNS: readonly CollectionDesign[] = [...COLLECTION_NAMEPLATES, ...COLLECTION_EFFECTS];

/**
 * A design as the motion spec it publishes as: fixed clip ids (so the same design is the same file, at the same address, every
 * time) and one lane per layer, bottom first.
 */
export function buildDesign(d: CollectionDesign): MotionSpec {
  const stage = { ...MOTION_STAGES[d.kind] };
  const c: Ctx = { kind: d.kind, stage, duration: d.duration, intro: d.intro, idle: r3(d.duration - d.intro), seed: 1 };
  let n = 0;
  const label = (clips: Clip[]): Clip[] =>
    clips.map((clip, i) => ({
      ...clip,
      id: `${d.slug}-${++n}`,
      track: Math.min(31, i),
      source: clip.source.type === "compound" ? { ...clip.source, clips: label(clip.source.clips) } : clip.source,
    }));
  return { v: 1, kind: d.kind, name: d.name, stage, duration: d.duration, loop: { mode: "loop", rest: 0, from: d.intro }, clips: label(d.build(c)) };
}

/** The grant a design is sold as. */
export const grantKindOf = (d: CollectionDesign): "nameplate" | "profileEffect" => (d.kind === "nameplate" ? "nameplate" : "profileEffect");

// --- Avatar decorations ---------------------------------------------------------------------------------------------------
// The artwork is in src/lib/avatar-decoration-collection.ts (SVG drawn in the app, so it needs no upload). What a SKU needs to
// know is only the key it is stored under and how it is sold; a test keeps the two lists in step.

export interface DecorationListing {
  key: string;
  name: string;
  description: string;
  priceCents: number;
}

export const COLLECTION_DECORATIONS: readonly DecorationListing[] = [
  { key: "cat-ears", name: "Cat Ears", description: "Flat anime-style cat ears: cream with a layered, scalloped pink inside and a pearl at the base, and three whiskers on each cheek. The ears flick and the whiskers twitch.", priceCents: 199 },
  { key: "halo", name: "Halo", description: "A glowing gold ring hovering over your head, with two little stars.", priceCents: 199 },
  { key: "laurel", name: "Laurel Wreath", description: "Two green branches with red berries wrapped round the sides of your avatar.", priceCents: 249 },
  { key: "lightning-corners", name: "Lightning Corners", description: "A crackle of electric blue and yellow in each corner.", priceCents: 249 },
  { key: "flame-ring", name: "Flame Ring", description: "A ring of flames, from deep red at the roots to yellow at the tips.", priceCents: 249 },
  { key: "frost", name: "Frost", description: "An icy ring with crystal spikes and drifting snowflakes.", priceCents: 249 },
  { key: "blossom", name: "Cherry Blossom", description: "A branch of cherry blossom across the corner, with petals blowing off it.", priceCents: 249 },
  { key: "crystal-cluster", name: "Crystal Cluster", description: "Violet and cyan crystals growing up from the bottom corners.", priceCents: 249 },
  { key: "pixel-frame", name: "Pixel Frame", description: "An 8-bit border of chunky coloured squares.", priceCents: 199 },
  { key: "saturn", name: "Ringed Planet", description: "A tilted ring wrapping your avatar like a planet, with two moons.", priceCents: 249 },
  { key: "gem-frame", name: "Jeweled Frame", description: "A gold frame set with a ruby, a sapphire, an emerald and a diamond.", priceCents: 299 },
  { key: "horns", name: "Little Horns", description: "A pair of small red horns, for the member who is up to something.", priceCents: 199 },
  { key: "ice-cube", name: "Ice Cube", description: "Your avatar frozen in a slab of ice that bends the picture behind it, and is melting: drips swell, fall and ring a puddle at its foot.", priceCents: 299 },
  { key: "sakura", name: "Sakura Wreath", description: "A wreath of cherry blossom on a twig round your avatar, swaying gently, with petals falling across the picture.", priceCents: 299 },
  { key: "moon", name: "Crescent Moon", description: "A cratered crescent moon over the corner of your avatar, in a sky of stars that twinkle on it and around it, with a shooting star every few seconds.", priceCents: 249 },
];
