import { MOTION_LIMITS, MOTION_STAGES, defaultParticles, defaultTransform, evalProp, newClip, type BlendMode, type Clip, type ClipFx, type Ease, type Key, type MotionKind, type Particles, type ParticleShape, type Prop, type Source, type Transform } from "./motion";

/**
 * Crystal's library of ready-made animated effects for nameplates and profile effects: signature scenes, sparkles, weather,
 * fire, hearts, confetti, space, water, glitch and colour washes — built from the same generators and keyframes anyone can
 * use by hand in Studio's timeline.
 *
 * ## Depth
 *
 * An effect is not one emitter. Each is a stack, bottom to top, the way a painted scene is: an **atmosphere** (a breathing
 * wash, drifting haze), the **subject** (rain, embers, petals…) drawn as three particle layers at different depths — small,
 * slow, soft ones behind, the main ones, and big blurred ones close to the glass — then **light** (an edge glow, a sweep,
 * glints). Most also have an **intro**: a burst, a flash, rings or a sweep that plays *once* when the profile is opened, with
 * the rest fading up underneath it; after that only the idle loops (see `MotionSpec.loop.from`). The signature scenes are
 * authored by hand; the older effects get the same treatment from their group's recipe (`ENRICH`) around their own core.
 *
 * Pure data and pure functions, no DOM and no Convex, because it is used in four places: Studio's timeline browser, the MCP
 * tools an AI agent edits designs with, the script that publishes the library to the CDN, and the tests. An effect is a
 * function from the stage and a few choices (colours, intensity, length) to clips, so one definition fits a profile card
 * (600 × 700) and a nameplate strip (960 × 176) and any colours someone wants. Nothing here is code that runs in the app:
 * what comes out is ordinary clips, checked by the same `normalizeMotionSpec` as anything else.
 *
 * ## Looping
 *
 * The design is `intro` seconds that play once, then `idle` seconds that repeat. Everything that repeats is periodic in the
 * idle: particle lives divide it (`fit`), keyframed motion is laid on a grid anchored where the idle begins (`cycle`), rays
 * turn a whole number of steps (`raySpin`), and a noise layer — which drifts, and so can't repeat — swells to almost nothing
 * at the seam and back (see `make`). Layers that belong to the idle fade in under the intro, with a transition that only the
 * first pass has, rather than switching on at the end of it.
 */

export interface EffectContext {
  kind: MotionKind;
  stage: { w: number; h: number };
  /** Seconds the effect runs: the length of the design it is added to. */
  duration: number;
  /** Seconds of intro, played once before the loop. 0 when it is used as plain looping layers. */
  intro: number;
  /** `duration - intro`: the part that loops. */
  idle: number;
  /** The colours to use. An effect's own are the default. */
  colors: string[];
  seed: number;
  /** How much of it: 1 is as designed; more is denser and brighter. */
  k: number;
}

export interface EffectDef {
  id: string;
  name: string;
  group: string;
  description: string;
  kinds: MotionKind[];
  /** Its own colours, which `colors` replaces. */
  colors: string[];
  /** Seconds of intro it wants (0: none). Held to at most a third of the design, and dropped if that is under 0.4 s. */
  intro?: number;
  build: (c: EffectContext) => Clip[];
}

/** Seconds a library effect runs by default: a short intro, then enough idle to be worth looping. */
export const DEFAULT_LENGTH = 6;

export interface EffectOptions {
  kind: MotionKind;
  duration?: number;
  /** Seconds of intro (before the loop): the design's own if it has one. */
  intro?: number;
  colors?: string[];
  seed?: number;
  intensity?: number;
  /** Clip ids are `<prefix>-<n>` rather than random, for effects that must come out the same every time (the published library). */
  idPrefix?: string;
}

// --- Building blocks ---------------------------------------------------------------------------------------------------

const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Keyframes with one to a moment — the later wins, as the validator would have it — so what is built is what is stored. */
const keys = (list: Key<number>[]): Prop => {
  const sorted = [...list].sort((a, b) => a.t - b.t);
  const out = sorted.filter((k, i) => i === sorted.length - 1 || sorted[i + 1].t !== k.t);
  return out.length === 1 ? out[0].v : { k: out };
};
const pick = (c: EffectContext, i: number) => c.colors[((i % c.colors.length) + c.colors.length) % c.colors.length];
/** How the size of the stage scales particle counts, so a strip isn't as crowded as a card. */
const area = (c: EffectContext) => Math.sqrt((c.stage.w * c.stage.h) / (MOTION_STAGES.effect.w * MOTION_STAGES.effect.h));
const cnt = (c: EffectContext, n: number) => Math.max(2, Math.min(MOTION_LIMITS.particles, Math.round(n * c.k * area(c))));
/** A particle life near `life` that divides the idle's length exactly, so the effect loops with no jump. */
const fit = (c: EffectContext, life: number) => r3(c.idle / Math.max(1, Math.round(c.idle / life)));
/** A colour with an alpha, for the `#rrggbb` colours the library uses (anything else is passed through). */
const alpha = (hex: string, a: number) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${Math.round(Math.min(1, Math.max(0, a)) * 255).toString(16).padStart(2, "0")}` : hex);
const dim = (c: EffectContext) => Math.min(c.stage.w, c.stage.h);
const big = (c: EffectContext) => Math.max(c.stage.w, c.stage.h);
/** Degrees a second that turn `count` rays through a whole number of steps in one idle, so they repeat exactly. */
const raySpin = (c: EffectContext, count: number, steps = 1) => r3(((360 / count) * steps) / c.idle);
/** A colour that is the same colour fully transparent: what a gradient fades to. */
const clear = (hex: string) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}00` : hex);
const part = (c: EffectContext, over: Partial<Particles>): Source => ({ type: "particles", ...defaultParticles(), seed: c.seed, ...over });
const tf = (o: Partial<Transform> & { scale?: number } = {}): Transform => {
  const { scale, ...rest } = o;
  const t = { ...defaultTransform(), ...(scale !== undefined ? { scaleX: scale, scaleY: scale } : {}), ...rest };
  for (const k of ["x", "y", "scaleX", "scaleY", "rotation", "opacity"] as const) if (typeof t[k] === "number") (t as unknown as Record<string, number>)[k] = r3(t[k] as number);
  return t;
};
interface ClipOpts {
  blend?: BlendMode;
  fx?: ClipFx[];
  transform?: Transform;
  loop?: boolean;
  start?: number;
  duration?: number;
  /** Plays once, in the intro, and is gone before the idle begins: it has to be invisible by its last key. */
  intro?: boolean;
  /** Belongs to the idle alone: starts where the loop does, so its own keyframes are the loop. */
  idleOnly?: boolean;
  /** Fade in under the intro (the default for what loops) or switch on at once. */
  ramp?: boolean;
}
/** Sizes and offsets rounded to the precision a design is stored at, so what is built is exactly what the validator keeps. */
function tidy(src: Source): Source {
  const out: Record<string, unknown> = { ...src };
  for (const k of ["w", "h", "r", "ox", "oy", "size", "speed", "gravity"]) if (typeof out[k] === "number") out[k] = r3(out[k] as number);
  return out as unknown as Source;
}
function make(c: EffectContext, name: string, source: Source, o: ClipOpts = {}): Clip {
  let transform = o.transform ?? tf();
  const introOnly = o.intro === true;
  const idleOnly = o.idleOnly === true;
  const span = introOnly ? { start: o.start ?? 0, duration: o.duration ?? c.intro } : idleOnly ? { start: c.intro, duration: c.idle } : { start: o.start ?? 0, duration: o.duration ?? c.duration };
  // A drifting noise field can't repeat, so it swells to almost nothing once per idle and the seam is lost in the dip.
  if (!introOnly && source.type === "noise" && typeof transform.opacity === "number") transform = { ...transform, opacity: cycle(c, c.idle, [[0, r3(transform.opacity * 0.1)], [0.5, transform.opacity]]) };
  const rise = c.intro > 0 && !introOnly && !idleOnly && o.ramp !== false;
  return newClip(tidy(source), {
    name,
    start: span.start,
    duration: span.duration,
    loop: introOnly ? false : (o.loop ?? true),
    blend: o.blend,
    fx: o.fx,
    transform,
    // What belongs to the loop comes up under the intro (a fade on the clip's first moments, which only the first pass has).
    transitionIn: rise ? { type: "fade", d: r3(c.intro * 0.9), dir: "left", e: "out" } : undefined,
  });
}

const glow = (color: string, blur = 14, strength = 1.4): ClipFx => ({ type: "glow", color, blur, strength });

/**
 * A value that repeats: `pattern` is points `[u, value, ease?]` with `u` from 0 to under 1 within one period, and the whole
 * thing is laid out as many times as fits the idle (at most 60 keyframes' worth), ending exactly where it began so the loop
 * has no seam. `phase` slides it later by a fraction of a period, so several clips can pulse out of step.
 *
 * With an intro (`c.intro`), the grid starts where the idle does and the value is held at its starting level until then; and
 * `at` is where in the design the clip itself starts, so a clip that comes in part-way through the intro still lands on the
 * same grid as the rest. Without one it is a plain repeat over the whole design, as it always was.
 */
export function cycle(c: Pick<EffectContext, "duration"> & { intro?: number }, period: number, pattern: [number, number, Ease?][], phase = 0, at = 0): Prop {
  const intro = Math.max(0, c.intro ?? 0);
  const origin = Math.min(at, intro);
  const span = c.duration - intro;
  const pts = pattern.map(([u, v, e]) => ({ u, v, e: e ?? ("inOut" as Ease) })).sort((a, b) => a.u - b.u);
  const n = Math.min(Math.max(1, Math.floor(60 / pts.length)), Math.max(1, Math.round(span / period)));
  const p = span / n;
  const valueAt = (u: number): number => {
    const x = ((u % 1) + 1) % 1;
    const xx = x < pts[0].u ? x + 1 : x;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j];
      const b = pts[(j + 1) % pts.length];
      const ub = j + 1 < pts.length ? b.u : b.u + 1;
      if (xx >= a.u && xx <= ub) return a.v + (b.v - a.v) * ((xx - a.u) / (ub - a.u || 1));
    }
    return pts[0].v;
  };
  // Times are in the clip's own time: the design's, less where the clip starts.
  const local = (abs: number) => r3(abs - origin);
  const real: Key<number>[] = [];
  for (let i = 0; i < n; i++) for (const pt of pts) real.push({ t: local(intro + (i + ((((pt.u + phase) % 1) + 1) % 1)) * p), v: r3(pt.v), e: pt.e });
  const edge = r3(valueAt(-phase));
  const has = (t: number) => real.some((k) => Math.abs(k.t - t) < 1e-6);
  const keys = [...real];
  const loopStart = local(intro);
  const end = r3(c.duration - origin);
  // Held at the loop's starting level through the intro, then the loop proper, ending where it began.
  if (loopStart > 0 && !has(0)) keys.push({ t: 0, v: edge, e: "linear" });
  if (!has(loopStart)) keys.push({ t: loopStart, v: edge, e: "linear" });
  if (!has(end)) keys.push({ t: end, v: edge, e: "linear" });
  keys.sort((a, b) => a.t - b.t);
  return { k: keys.filter((k, i) => i === 0 || Math.abs(k.t - keys[i - 1].t) > 1e-6) };
}

/** A property that moves at a steady rate across the whole design and is where it started, a whole number of turns on,
 * when the loop comes round: `turns` full turns per idle. For rotation, where 0° and 360° are the same picture. */
const spin = (c: EffectContext, turns: number): Prop => ({
  k: [
    { t: 0, v: r3((-turns * 360 * c.intro) / c.idle), e: "linear" },
    { t: r3(c.duration), v: r3(turns * 360), e: "linear" },
  ],
});

/** A colour that goes round `colors` once per idle and comes back to the first, for washes and glows that shift hue. */
function colorLoop(c: EffectContext, colors: string[]): { k: Key<string>[] } {
  const list = colors.length > 1 ? colors : [colors[0], colors[0]];
  const n = list.length;
  const keys: Key<string>[] = [];
  for (let i = 0; i < n; i++) keys.push({ t: r3(c.intro + (c.idle * i) / n), v: list[i], e: "inOut" });
  keys.push({ t: r3(c.duration), v: list[0], e: "inOut" });
  if (c.intro > 0) keys.unshift({ t: 0, v: list[0], e: "linear" });
  return { k: keys.filter((k, i) => i === 0 || k.t - keys[i - 1].t > 1e-6) };
}

const defs: EffectDef[] = [];

/** What a group of effects gets around each one's own clips: atmosphere beneath, light above, and an intro. */
interface Recipe {
  under: (c: EffectContext) => Clip[];
  over: (c: EffectContext) => Clip[];
  intro: (c: EffectContext) => Clip[];
}
const ENRICH: Record<string, Recipe> = {};
/** Seconds of intro an ordinary library effect has. */
const INTRO = 1.6;

const def = (d: Omit<EffectDef, "kinds"> & { kinds?: MotionKind[] }) => {
  const recipe = () => ENRICH[d.group];
  const own = d.build;
  void defs.push({
    kinds: ["effect", "nameplate"],
    intro: INTRO,
    ...d,
    // The effect's own clips, in the middle of its group's: atmosphere under them, light and the intro over.
    build: (c) => {
      const r = recipe();
      const core = d.group === G_SIG ? own(c) : own(c).flatMap((clip) => deepen(c, clip));
      return r ? [...r.under(c), ...core, ...r.over(c), ...r.intro(c)] : core;
    },
  });
};

// --- The kit: layers every scene is made of ----------------------------------------------------------------------------

/** A wash of colour that breathes, behind everything: the air the rest is in. */
function bed(c: EffectContext, color: string, o: { a?: number; y?: number; scale?: number; blend?: BlendMode; name?: string; period?: number } = {}): Clip[] {
  const a = o.a ?? 0.3;
  const s = o.scale ?? 1.2;
  return [make(c, o.name ?? "Atmosphere", { type: "gradient", w: c.stage.w * s, h: c.stage.h * s, kind: "radial", angle: 0, stops: [{ o: 0, c: alpha(color, 0.85) }, { o: 0.6, c: alpha(color, 0.3) }, { o: 1, c: clear(color) }] }, { blend: o.blend ?? "add", transform: tf({ y: o.y ?? 0, opacity: cycle(c, o.period ?? 4, [[0, r3(a * 0.55)], [0.5, a]]) }) })];
}

/** Light gathering at the edges, as if the card were lit from behind. */
function edgeGlow(c: EffectContext, color: string, a = 0.45): Clip[] {
  return [make(c, "Edge light", { type: "gradient", w: c.stage.w * 1.04, h: c.stage.h * 1.04, kind: "radial", angle: 0, stops: [{ o: 0, c: clear(color) }, { o: 0.5, c: clear(color) }, { o: 1, c: alpha(color, a) }] }, { blend: "add", transform: tf({ opacity: cycle(c, 3.6, [[0, 0.55], [0.5, 1]]) }) })];
}

/** Drifting haze: fog, cloud, gas. Swells to nothing once per loop to lose its seam (see `make`). */
function haze(c: EffectContext, color: string, o: { a?: number; scale?: number; speed?: number; contrast?: number; seed?: number; blend?: BlendMode; name?: string; y?: number } = {}): Clip[] {
  return [make(c, o.name ?? "Haze", { type: "noise", w: c.stage.w * 1.2, h: c.stage.h * 1.2, scale: o.scale ?? 260, speed: o.speed ?? 0.15, color, contrast: o.contrast ?? 0.4, seed: c.seed + (o.seed ?? 0) }, { blend: o.blend ?? "screen", transform: tf({ y: o.y ?? 0, opacity: o.a ?? 0.4 }) })];
}

/** A sweep of light crossing, then resting. */
function sweep(c: EffectContext, color: string, o: { width?: number; period?: number; angle?: number; a?: number; seed?: number } = {}): Clip[] {
  return [make(c, "Sweep", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: o.angle ?? 20, width: o.width ?? 0.16, period: fit(c, o.period ?? 3.2), color, seed: c.seed + (o.seed ?? 0) }, { blend: "add", transform: tf({ opacity: o.a ?? 0.7 }) })];
}

/** Stars blinking on and off across the whole area. */
function twinkles(c: EffectContext, n = 16, size = 11, seed = 71): Clip[] {
  return [make(c, "Twinkles", part(c, { shape: "star", w: c.stage.w, h: c.stage.h, count: cnt(c, n), life: fit(c, 2.2), speed: 0, size, sizeEnd: 0, spin: 50, colors: c.colors, fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + seed }), { blend: "add" })];
}

const clampN = (x: number) => Math.max(2, Math.min(MOTION_LIMITS.particles, Math.round(x)));
const scaleProp = (p: Prop, k: number): Prop => (typeof p === "number" ? r3(p * k) : { k: p.k.map((x) => ({ ...x, v: r3(x.v * k) })) });

/**
 * A steadily emitting particle clip, as three: small slow soft ones behind it (far), the clip itself, and a few big blurred
 * ones close to the glass (near). They share a shape, a colour and a direction and differ in size, speed and softness, the
 * way things at different distances do — which is most of what makes a scene read as a place rather than a layer.
 *
 * Anything else (a burst, a wash, a shape, a field too big to be a speck) is returned as it is.
 */
function deepen(c: EffectContext, clip: Clip): Clip[] {
  const s = clip.source;
  if (s.type !== "particles" || s.mode !== "continuous" || s.size >= 30 || s.count < 6) return [clip];
  const layer = (suffix: string, over: Partial<Particles>, k: number, blur: number): Clip =>
    newClip(tidy({ ...s, ...over, life: fit(c, over.life ?? s.life) } as Source), {
      name: `${clip.name} ${suffix}`,
      start: clip.start,
      duration: clip.duration,
      loop: clip.loop,
      blend: clip.blend,
      fx: [...clip.fx.filter((f) => f.type !== "blur"), { type: "blur", amount: blur }],
      transform: { ...clip.transform, opacity: scaleProp(clip.transform.opacity, k) },
      transitionIn: clip.transitionIn,
    });
  return [
    layer("far", { count: clampN(s.count * 0.8), size: r3(Math.max(1, s.size * 0.5)), speed: r3(s.speed * 0.55), life: s.life * 1.5, seed: s.seed + 11, drift: r3(s.drift * 0.6) }, 0.45, 1.2),
    clip,
    layer("near", { count: clampN(s.count * 0.16), size: r3(Math.min(120, s.size * 2.8)), speed: r3(s.speed * 1.5), life: s.life * 0.8, seed: s.seed + 23, sizeJitter: 0.4, drift: r3(s.drift * 1.4) }, 0.5, 4),
  ];
}

/** A particle field made at three depths from the start (see `deepen`), for scenes written by hand. */
function depth(c: EffectContext, name: string, p: Partial<Particles>, o: { x?: number; y?: number; blend?: BlendMode; glow?: string } = {}): Clip[] {
  const mid = make(c, `${name}`, part(c, { colors: c.colors, ...p, life: fit(c, p.life ?? 3) }), { blend: o.blend, fx: o.glow ? [glow(o.glow, 10, 1.2)] : undefined, transform: tf({ x: o.x ?? 0, y: o.y ?? 0 }) });
  return deepen(c, mid).map((clip) => (clip === mid ? clip : { ...clip, name: clip.name.replace(`${name}`, name) }));
}

// The intro: what plays once, when the profile is opened — gone before the loop begins, so each of these ends invisible.

/** A flash of light that peaks at once and dies away. `at` (a fraction of the intro, up to a half) delays it, for a second strike. */
function introFlash(c: EffectContext, color: string, peak = 0.5, at = 0): Clip[] {
  if (!c.intro) return [];
  const I = c.intro;
  const a = Math.min(0.5, Math.max(0, at));
  return [make(c, at > 0 ? "Intro flash 2" : "Intro flash", { type: "solid", w: c.stage.w, h: c.stage.h, color }, { intro: true, blend: "add", transform: tf({ opacity: keys([{ t: 0, v: 0, e: "out" }, { t: r3(I * a), v: 0, e: "out" }, { t: r3(I * (a + 0.06)), v: peak, e: "out" }, { t: r3(I * (a + 0.5)), v: 0, e: "linear" }, { t: r3(I), v: 0, e: "linear" }]) }) })];
}

/** Rings of light spreading out from the middle, one after another. */
function introRings(c: EffectContext, color: string, n = 2): Clip[] {
  if (!c.intro) return [];
  const I = c.intro;
  const size = dim(c) * 0.3;
  const grow = (from: number): Prop => keys([{ t: 0, v: 0.1, e: "linear" }, { t: r3(from), v: 0.1, e: "out" }, { t: r3(from + I * 0.7), v: 3.4, e: "linear" }, { t: r3(I), v: 3.4, e: "linear" }]);
  return Array.from({ length: n }, (_, i) => {
    const from = I * 0.14 * i;
    return make(c, `Intro ring ${i + 1}`, { type: "shape", shape: "ring", w: size, h: size, fill: "#ffffff00", stroke: color, strokeWidth: 8, radius: 0, points: 5, inner: 0.5 }, {
      intro: true,
      blend: "add",
      fx: [glow(color, 14, 1.6)],
      transform: tf({ scaleX: grow(from), scaleY: grow(from), opacity: keys([{ t: 0, v: 0, e: "linear" }, { t: r3(from), v: 0, e: "out" }, { t: r3(from + 0.03), v: 1, e: "out" }, { t: r3(from + I * 0.7), v: 0, e: "linear" }, { t: r3(I), v: 0, e: "linear" }]) }),
    });
  });
}

/** A band of light crossing from one side to the other — the intro for a strip, where rings have nowhere to go. */
function introSweep(c: EffectContext, color: string): Clip[] {
  if (!c.intro) return [];
  const I = c.intro;
  const w = c.stage.w * 0.28;
  return [make(c, "Intro sweep", { type: "gradient", w, h: c.stage.h * 1.6, kind: "linear", angle: 0, stops: [{ o: 0, c: clear(color) }, { o: 0.5, c: alpha(color, 0.9) }, { o: 1, c: clear(color) }] }, {
    intro: true,
    blend: "add",
    transform: tf({ x: { k: [{ t: 0, v: r3(-c.stage.w * 0.62), e: "linear" }, { t: r3(I), v: r3(c.stage.w * 0.62), e: "linear" }] }, opacity: { k: [{ t: 0, v: 0, e: "linear" }, { t: r3(I * 0.1), v: 1, e: "linear" }, { t: r3(I * 0.85), v: 1, e: "linear" }, { t: r3(I), v: 0, e: "linear" }] } }),
  })];
}

/** Everything thrown out at once, which falls or fades by the end of the intro. */
function introBurst(c: EffectContext, o: Partial<Particles> & { x?: number; y?: number; count?: number; name?: string } = {}): Clip[] {
  if (!c.intro) return [];
  const { x, y, count, name, ...p } = o;
  return [make(c, name ?? "Intro burst", part(c, { shape: "star", mode: "burst", w: 4, h: 4, count: cnt(c, count ?? 60), life: c.intro, speed: 320, speedJitter: 0.5, angle: -90, spread: 360, gravity: 160, size: 10, sizeJitter: 0.5, sizeEnd: 0.4, spin: 200, colors: c.colors, fadeIn: 0, fadeOut: 0.45, seed: c.seed + 41, ...p }), { intro: true, blend: "add", transform: tf({ x: x ?? 0, y: y ?? 0 }) })];
}

/** The usual opening: a flash, rings (or a sweep, on a strip) and a burst of whatever the scene is made of. */
function introBloom(c: EffectContext, o: { color?: string; accent?: string; flash?: number; rings?: number; burst?: Partial<Particles> & { x?: number; y?: number; count?: number } } = {}): Clip[] {
  const color = o.color ?? pick(c, 0);
  const accent = o.accent ?? pick(c, 1);
  const strip = c.kind === "nameplate";
  return [
    ...introFlash(c, color, o.flash ?? 0.45),
    ...(strip ? introSweep(c, accent) : introRings(c, accent, o.rings ?? 2)),
    ...introBurst(c, { w: strip ? c.stage.w * 0.7 : 4, h: strip ? c.stage.h * 0.4 : 4, ...o.burst }),
  ];
}

/** Wind sweeping a flurry of particles across from one side. */
function introGust(c: EffectContext, shape: ParticleShape, o: { size?: number; count?: number; gravity?: number; angle?: number; flash?: number } = {}): Clip[] {
  const left = -c.stage.w / 2;
  return [
    ...introFlash(c, pick(c, 0), o.flash ?? 0.2),
    ...introBurst(c, { name: "Intro gust", shape, w: 8, h: c.stage.h, x: left, count: o.count ?? 70, speed: 760, speedJitter: 0.4, angle: o.angle ?? 8, spread: 60, gravity: o.gravity ?? 40, size: o.size ?? 9, sizeEnd: 0.8, spin: 240 }),
  ];
}

// --- Group recipes -----------------------------------------------------------------------------------------------------
// What each group wraps around its effects' own clips. They are written in terms of the effect's colours, so a recoloured
// effect recolours all of it.

const G_SIG = "Signature";
const G_SPARK = "Sparkle & light";
const G_NATURE = "Weather & nature";
const G_FIRE = "Fire & energy";
const G_FUN = "Love & fun";
const G_SPACE = "Space & magic";
const G_WATER = "Water";
const G_TECH = "Glitch & tech";
const G_WASH = "Colour washes";
const G_SHAPES = "Moving shapes";

ENRICH[G_SPARK] = {
  under: (c) => bed(c, pick(c, 0), { a: 0.2, name: "Warm air" }),
  over: (c) => [...edgeGlow(c, pick(c, 1), 0.3), ...sweep(c, "#ffffff", { a: 0.3, period: 4.5, width: 0.12, angle: 28, seed: 5 }), ...twinkles(c, 9, 9, 83)],
  intro: (c) => introBloom(c, { flash: 0.5, burst: { shape: "star", count: 56, speed: 300, gravity: 120 } }),
};
ENRICH[G_NATURE] = {
  under: (c) => [...haze(c, pick(c, 0), { a: 0.22, scale: 320, speed: 0.1, contrast: 0.35, seed: 31, name: "Weather" }), ...bed(c, pick(c, 1), { a: 0.14, y: -c.stage.h * 0.2, name: "Sky light" })],
  over: (c) => [...edgeGlow(c, pick(c, 0), 0.22), ...[make(c, "Motes", part(c, { shape: "dot", w: c.stage.w, h: c.stage.h, count: cnt(c, 12), life: fit(c, 5), speed: 8, spread: 360, size: 3, sizeEnd: 0.5, colors: c.colors, drift: 14, fadeIn: 0.4, fadeOut: 0.4, seed: c.seed + 61 }), { blend: "add", transform: tf({ opacity: 0.7 }) })]],
  intro: (c) => introGust(c, "dot", { size: 7, count: 80, flash: 0.18 }),
};
ENRICH[G_FIRE] = {
  under: (c) => [...bed(c, pick(c, 0), { a: 0.3, y: c.stage.h * 0.28, scale: 1.4, period: 1.8, name: "Heat" }), ...haze(c, pick(c, 1), { a: 0.22, scale: 150, speed: 0.4, contrast: 0.6, blend: "add", seed: 17, name: "Shimmer" })],
  over: (c) => [...edgeGlow(c, pick(c, 0), 0.5), make(c, "Sparks", part(c, { shape: "dot", w: c.stage.w * 0.7, h: 10, count: cnt(c, 22), life: fit(c, 2.4), speed: 140, angle: -90, spread: 50, size: 3, sizeEnd: 0, colors: c.colors, drift: 18, fadeIn: 0.05, fadeOut: 0.5, seed: c.seed + 53 }), { blend: "add", transform: tf({ y: c.stage.h * 0.42 }) })],
  intro: (c) => introBloom(c, { flash: 0.7, rings: 3, burst: { shape: "dot", count: 80, speed: 380, gravity: 220, size: 7 } }),
};
ENRICH[G_FUN] = {
  under: (c) => bed(c, pick(c, 0), { a: 0.16, name: "Glow" }),
  over: (c) => [...sweep(c, "#ffffff", { a: 0.28, period: 3.8, width: 0.14, angle: -22, seed: 9 }), ...twinkles(c, 12, 10, 91)],
  intro: (c) => introBloom(c, { flash: 0.35, burst: { shape: "square", count: 90, speed: 420, gravity: 420, spread: 150, size: 11, spin: 480 } }),
};
ENRICH[G_SPACE] = {
  under: (c) => [...haze(c, pick(c, 0), { a: 0.3, scale: 300, speed: 0.1, contrast: 0.5, seed: 3, name: "Gas" }), ...haze(c, pick(c, 1), { a: 0.22, scale: 220, speed: -0.07, contrast: 0.5, seed: 8, name: "Gas 2" })],
  over: (c) => [...twinkles(c, 18, 9, 97), ...edgeGlow(c, pick(c, 0), 0.28)],
  intro: (c) => introBloom(c, { flash: 0.35, rings: 3, burst: { shape: "spark", count: 70, speed: 300, gravity: 0, size: 12 } }),
};
ENRICH[G_WATER] = {
  under: (c) => [...bed(c, pick(c, 0), { a: 0.22, y: c.stage.h * 0.15, name: "Depth" }), ...haze(c, pick(c, 1), { a: 0.2, scale: 90, speed: 0.5, contrast: 0.8, blend: "add", seed: 29, name: "Light on water" })],
  over: (c) => [...sweep(c, "#ffffff", { a: 0.3, period: 5, width: 0.18, angle: 68, seed: 13 }), make(c, "Spray", part(c, { shape: "ring", w: c.stage.w, h: 10, count: cnt(c, 14), life: fit(c, 3.4), speed: 60, angle: -90, spread: 18, size: 9, sizeJitter: 0.6, sizeEnd: 1.4, colors: c.colors, drift: 10, fadeIn: 0.2, fadeOut: 0.35, seed: c.seed + 67 }), { transform: tf({ y: c.stage.h / 2, opacity: 0.8 }) })],
  intro: (c) => [...introFlash(c, pick(c, 1), 0.25), ...(c.kind === "nameplate" ? introSweep(c, pick(c, 0)) : introRings(c, pick(c, 0), 3)), ...introBurst(c, { name: "Intro splash", shape: "ring", w: c.stage.w * 0.5, h: 6, y: c.stage.h * 0.35, count: 40, speed: 360, angle: -90, spread: 70, gravity: 520, size: 10 })],
};
ENRICH[G_TECH] = {
  under: (c) => [...bed(c, pick(c, 0), { a: 0.14, name: "Screen glow" }), make(c, "Scanlines", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: 90, width: 0.04, period: fit(c, 1.8), color: pick(c, 0), seed: c.seed + 2 }, { blend: "add", transform: tf({ opacity: 0.35 }) })],
  over: (c) => [...edgeGlow(c, pick(c, 0), 0.35), make(c, "Data", part(c, { shape: "square", w: c.stage.w, h: c.stage.h, count: cnt(c, 16), life: fit(c, 1.5), speed: 0, size: 4, sizeEnd: 0, colors: c.colors, fadeIn: 0.1, fadeOut: 0.6, seed: c.seed + 71 }), { blend: "add" })],
  intro: (c) => [...introFlash(c, pick(c, 0), 0.4), ...introSweep(c, pick(c, 1)), ...introBurst(c, { name: "Intro bits", shape: "square", w: c.stage.w, h: c.stage.h, count: 70, speed: 60, spread: 360, gravity: 0, size: 6, sizeEnd: 0 })],
};
ENRICH[G_WASH] = {
  under: () => [],
  over: (c) => [...sweep(c, "#ffffff", { a: 0.25, period: 5, width: 0.2, angle: 30, seed: 4 }), ...twinkles(c, 8, 8, 101), ...edgeGlow(c, pick(c, 0), 0.25)],
  intro: (c) => [...introFlash(c, pick(c, 0), 0.4), ...(c.kind === "nameplate" ? introSweep(c, "#ffffff") : introRings(c, pick(c, 1), 2))],
};
ENRICH[G_SHAPES] = {
  under: (c) => bed(c, pick(c, 0), { a: 0.18, name: "Glow" }),
  over: (c) => [...twinkles(c, 10, 9, 103), ...edgeGlow(c, pick(c, 1), 0.28)],
  intro: (c) => introBloom(c, { flash: 0.4, burst: { shape: "star", count: 50, speed: 300, gravity: 100 } }),
};

// --- Scene helpers ------------------------------------------------------------------------------------------------------

const strip = (c: EffectContext) => c.kind === "nameplate";
/** Rings spreading from the middle on a card, a band of light crossing on a strip. */
const introReveal = (c: EffectContext, color: string, rings = 2): Clip[] => (strip(c) ? introSweep(c, color) : introRings(c, color, rings));

/** Rays fanning out from a point, turning a whole number of steps each loop. */
function rays(c: EffectContext, name: string, count: number, color: string, o: { steps?: number; dir?: 1 | -1; r?: number; x?: number; y?: number; a?: number; softness?: number } = {}): Clip[] {
  return [make(c, name, { type: "rays", r: o.r ?? big(c) * 0.85, count, color, spin: r3((o.dir ?? 1) * raySpin(c, count, o.steps ?? 1)), softness: o.softness ?? 0.6 }, { blend: "add", transform: tf({ x: o.x ?? 0, y: o.y ?? 0, opacity: o.a ?? 0.4 }) })];
}

/** A bright centre that swells and settles. */
function core(c: EffectContext, color: string, o: { size?: number; a?: number; x?: number; y?: number; period?: number; glow?: string } = {}): Clip[] {
  const size = dim(c) * (o.size ?? 1);
  return [make(c, "Core", { type: "gradient", w: size, h: size, kind: "radial", angle: 0, stops: [{ o: 0, c: alpha(color, 0.95) }, { o: 0.4, c: alpha(color, 0.45) }, { o: 1, c: clear(color) }] }, { blend: "add", fx: o.glow ? [glow(o.glow, 18, 1.5)] : undefined, transform: tf({ x: o.x ?? 0, y: o.y ?? 0, opacity: cycle(c, o.period ?? 2.4, [[0, r3((o.a ?? 1) * 0.65)], [0.5, o.a ?? 1]]) }) })];
}

/** Rings that swell and fade one after another, out of step with each other. */
function pulses(c: EffectContext, colors: string[], o: { n?: number; size?: number; period?: number; from?: number; to?: number; stroke?: number; y?: number } = {}): Clip[] {
  const n = o.n ?? 3;
  const size = dim(c) * (o.size ?? 0.5);
  const period = o.period ?? 2.4;
  return Array.from({ length: n }, (_, i) => {
    const phase = i / n;
    const col = colors[i % colors.length];
    const scale = cycle(c, period, [[0, o.from ?? 0.2, "out"], [0.99, o.to ?? 2.6]], phase);
    return make(c, `Pulse ${i + 1}`, { type: "shape", shape: "ring", w: size, h: size, fill: "#ffffff00", stroke: col, strokeWidth: o.stroke ?? 4, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(col, 12, 1.4)], transform: tf({ y: o.y ?? 0, scaleX: scale, scaleY: scale, opacity: cycle(c, period, [[0, 0], [0.1, 0.9, "out"], [0.9, 0]], phase) }) });
  });
}

/** Sudden white-blue flashes, `per` of them in each loop. */
function strikes(c: EffectContext, color: string, per = 1): Clip[] {
  return [make(c, "Lightning", { type: "solid", w: c.stage.w, h: c.stage.h, color }, { blend: "add", transform: tf({ opacity: cycle(c, c.idle / per, [[0, 0, "out"], [0.3, 0, "out"], [0.31, 0.85, "out"], [0.34, 0.1, "out"], [0.37, 0.65, "out"], [0.5, 0, "out"]]) }) })];
}

/** Big soft lights wandering upward: spirits, lanterns, will-o'-the-wisps. */
function wisps(c: EffectContext, n = 9, seed = 47): Clip[] {
  return [make(c, "Wisps", part(c, { shape: "dot", w: c.stage.w, h: 10, count: cnt(c, n), life: fit(c, 6), speed: 22, angle: -90, spread: 50, size: 28, sizeJitter: 0.4, sizeEnd: 1.2, colors: c.colors, drift: 28, fadeIn: 0.35, fadeOut: 0.45, seed: c.seed + seed }), { blend: "add", fx: [{ type: "blur", amount: 5 }, glow(pick(c, 0), 18, 1.2)], transform: tf({ y: c.stage.h * 0.4 }) })];
}

/** A band of mist lying along the bottom of a card. */
function groundMist(c: EffectContext, color: string, a = 0.45): Clip[] {
  if (strip(c)) return [];
  return [make(c, "Ground mist", { type: "gradient", w: c.stage.w, h: c.stage.h * 0.55, kind: "linear", angle: 90, stops: [{ o: 0, c: clear(color) }, { o: 1, c: alpha(color, 0.8) }] }, { blend: "screen", transform: tf({ y: c.stage.h * 0.225, opacity: cycle(c, 5, [[0, r3(a * 0.7)], [0.5, a]]) }) })];
}

/** An outline of light round the edge, which pulses. */
function frame(c: EffectContext, color: string, inset: number, o: { stroke?: number; period?: number; name?: string } = {}): Clip[] {
  return [make(c, o.name ?? "Frame", { type: "shape", shape: "rect", w: c.stage.w - inset * 2, h: c.stage.h - inset * 2, fill: "#ffffff00", stroke: color, strokeWidth: o.stroke ?? 4, radius: strip(c) ? 28 : 36, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(color, 18, 2.2)], transform: tf({ opacity: cycle(c, o.period ?? 2.4, [[0, 0.6], [0.5, 1]]) }) })];
}

/** A tint pulled in from the edges, to push the middle forward: the dark of a haunted room, the shade under a canopy. */
function vignette(c: EffectContext, color: string, a = 0.7): Clip[] {
  return [make(c, "Vignette", { type: "gradient", w: c.stage.w * 1.05, h: c.stage.h * 1.05, kind: "radial", angle: 0, stops: [{ o: 0, c: clear(color) }, { o: 0.45, c: clear(color) }, { o: 1, c: alpha(color, a) }] }, { transform: tf({ opacity: cycle(c, 3, [[0, 0.75], [0.5, 1]]) }) })];
}

/** Two coloured lights spilling across from opposite corners, slowly trading places. */
function spill(c: EffectContext, a: string, b: string, o: { opacity?: number; blend?: BlendMode } = {}): Clip[] {
  const wash = (name: string, color: string, flip: boolean) =>
    make(c, name, { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: cycle(c, 6, flip ? [[0, 70], [0.5, 20]] : [[0, 20], [0.5, 70]]), stops: [{ o: 0, c: alpha(color, 0.6) }, { o: 1, c: clear(color) }] }, { blend: o.blend ?? "screen", transform: tf({ opacity: cycle(c, 5, [[0, r3((o.opacity ?? 0.8) * 0.5)], [0.5, o.opacity ?? 0.8]], flip ? 0.5 : 0) }) });
  return [wash("Light A", a, false), wash("Light B", b, true)];
}

// --- Signature scenes --------------------------------------------------------------------------------------------------
// Each is a place rather than a layer: an atmosphere, a subject at three depths, light over it, and an opening of its own.

def({ id: "supernova", name: "Supernova", group: G_SIG, intro: 2, description: "A star going off: a white-hot flash and shockwaves, then a slowly turning corona, a pulsing core and embers circling in the afterglow.", colors: ["#fff1c2", "#fb923c", "#f43f5e"], build: (c) => [
  ...bed(c, pick(c, 2), { a: 0.32, scale: 1.3, name: "Afterglow", period: 3.2 }),
  ...rays(c, "Corona", 18, pick(c, 1), { a: 0.5, softness: 0.7 }),
  ...rays(c, "Fine corona", 36, pick(c, 0), { dir: -1, a: 0.3, softness: 0.9 }),
  ...core(c, pick(c, 0), { glow: pick(c, 1), period: 2.2 }),
  ...depth(c, "Embers", { shape: "dot", w: c.stage.w * 0.9, h: c.stage.h * 0.9, count: 46, life: 3, speed: 40, spread: 360, size: 5, sizeEnd: 0, drift: 18, fadeIn: 0.3, fadeOut: 0.5 }, { blend: "add" }),
  ...pulses(c, [pick(c, 1), pick(c, 2)], { n: 2, size: 0.4, period: 2.2, to: 2.8 }),
  ...sweep(c, pick(c, 0), { a: 0.4, period: 4.4, width: 0.14, angle: 32, seed: 3 }),
  ...edgeGlow(c, pick(c, 2), 0.5),
  ...introBloom(c, { color: pick(c, 0), accent: pick(c, 1), flash: 0.9, rings: 3, burst: { shape: "dot", count: 120, speed: 560, gravity: 60, size: 8 } }),
] });

def({ id: "enchanted-forest", name: "Enchanted forest", group: G_SIG, intro: 1.8, description: "Sun through a green canopy: light shafts, leaves turning as they fall, fireflies at three depths and mist along the ground. A gust of leaves blows in as it opens.", colors: ["#86efac", "#fde68a", "#34d399", "#bef264"], build: (c) => [
  ...haze(c, pick(c, 0), { a: 0.28, scale: 300, speed: 0.1, seed: 31, name: "Canopy mist" }),
  ...bed(c, pick(c, 1), { a: 0.22, y: -c.stage.h * 0.25, name: "Sun through leaves" }),
  ...rays(c, "Light shafts", 9, pick(c, 1), { y: strip(c) ? 0 : -c.stage.h * 0.42, a: 0.32, softness: 0.8 }),
  ...depth(c, "Leaves", { shape: "square", w: c.stage.w, h: 10, count: 22, life: 7, speed: 38, angle: 90, spread: 30, size: 9, sizeJitter: 0.5, sizeEnd: 1, spin: 170, drift: 36, fadeIn: 0.1, fadeOut: 0.2 }, { y: -c.stage.h / 2 }),
  ...depth(c, "Fireflies", { shape: "dot", w: c.stage.w, h: c.stage.h, count: 26, life: 4, speed: 12, spread: 360, size: 6, sizeEnd: 0.6, drift: 30, fadeIn: 0.4, fadeOut: 0.4, seed: c.seed + 5 }, { blend: "add", glow: pick(c, 3) }),
  ...groundMist(c, pick(c, 0), 0.4),
  ...edgeGlow(c, pick(c, 2), 0.32),
  ...introGust(c, "square", { size: 9, count: 90, flash: 0.22 }),
] });

def({ id: "thunderstorm", name: "Thunderstorm", group: G_SIG, intro: 1.6, description: "Heavy cloud, rain at three depths, ripples where it lands and a strike of lightning every loop. It opens on a double flash and a downpour.", colors: ["#93c5fd", "#e0f2fe", "#475569"], build: (c) => [
  ...haze(c, pick(c, 2), { a: 0.6, scale: 380, speed: 0.12, contrast: 0.55, blend: "normal", seed: 7, name: "Storm clouds" }),
  ...depth(c, "Rain", { shape: "dot", w: c.stage.w * 1.2, h: 10, count: 90, life: 0.9, speed: 520, speedJitter: 0.2, angle: 98, spread: 4, size: 3, sizeEnd: 0.8, fadeIn: 0.05, fadeOut: 0.3 }, { y: -c.stage.h / 2 }),
  ...pulses(c, [pick(c, 0)], { n: 2, size: 0.3, period: 1.6, to: 1.6, stroke: 2, y: strip(c) ? 0 : c.stage.h * 0.36 }),
  ...strikes(c, pick(c, 1)),
  ...edgeGlow(c, pick(c, 0), 0.3),
  ...introFlash(c, pick(c, 1), 0.95),
  ...introFlash(c, pick(c, 1), 0.8, 0.4),
  ...introBurst(c, { name: "Downpour", shape: "dot", w: c.stage.w * 1.2, h: 10, y: -c.stage.h / 2, count: 120, speed: 700, speedJitter: 0.2, angle: 98, spread: 6, gravity: 800, size: 3, sizeEnd: 0.8, spin: 0 }),
] });

def({ id: "deep-sea", name: "Deep sea", group: G_SIG, intro: 1.8, description: "Looking up through dark water: rippling caustics, shafts of light, bubbles at three depths and drifting plankton. A surge of bubbles rises as it opens.", colors: ["#22d3ee", "#38bdf8", "#a5f3fc", "#0e7490"], build: (c) => [
  make(c, "Depth", { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: 90, stops: [{ o: 0, c: clear(pick(c, 3)) }, { o: 1, c: alpha(pick(c, 3), 0.85) }] }, { transform: tf({ opacity: 0.8 }) }),
  ...haze(c, pick(c, 2), { a: 0.38, scale: 80, speed: 0.5, contrast: 0.85, blend: "add", seed: 7, name: "Caustics" }),
  ...rays(c, "Light shafts", 7, pick(c, 2), { y: strip(c) ? 0 : -c.stage.h * 0.4, a: 0.3, softness: 0.85 }),
  ...depth(c, "Bubbles", { shape: "ring", w: c.stage.w, h: 10, count: 34, life: 3.6, speed: 70, angle: -90, spread: 16, size: 12, sizeJitter: 0.7, sizeEnd: 1.4, drift: 14, fadeIn: 0.15, fadeOut: 0.35 }, { y: c.stage.h / 2 }),
  ...depth(c, "Plankton", { shape: "dot", w: c.stage.w, h: c.stage.h, count: 38, life: 5, speed: 6, spread: 360, size: 3, sizeEnd: 0.6, drift: 20, fadeIn: 0.4, fadeOut: 0.4, seed: c.seed + 9 }, { blend: "add" }),
  ...sweep(c, pick(c, 2), { a: 0.25, period: 5, width: 0.2, angle: 70, seed: 6 }),
  ...edgeGlow(c, pick(c, 1), 0.3),
  ...introFlash(c, pick(c, 2), 0.3),
  ...introReveal(c, pick(c, 1), 3),
  ...introBurst(c, { name: "Bubble surge", shape: "ring", w: c.stage.w, h: 8, y: c.stage.h / 2, count: 70, speed: 520, angle: -90, spread: 40, gravity: -120, size: 14, sizeEnd: 1.2, spin: 0 }),
] });

def({ id: "starforge", name: "Starforge", group: G_SIG, intro: 2, description: "A nebula with a bright heart: two clouds of gas, galactic arms turning, rings of light breathing out, stars at three depths and shooting stars. It opens by dropping out of warp.", colors: ["#c4b5fd", "#f0abfc", "#67e8f9", "#ffffff"], build: (c) => [
  ...haze(c, pick(c, 0), { a: 0.4, scale: 300, speed: 0.1, seed: 3, name: "Nebula" }),
  ...haze(c, pick(c, 1), { a: 0.3, scale: 230, speed: -0.07, seed: 8, name: "Nebula 2" }),
  ...rays(c, "Galactic arms", 40, pick(c, 0), { steps: 3, a: 0.32, softness: 0.9 }),
  ...core(c, pick(c, 3), { size: 0.7, a: 0.8 }),
  ...pulses(c, [pick(c, 2), pick(c, 0)], { n: 2, size: 0.8, period: 3, from: 0.3, to: 1.4, stroke: 3 }),
  ...depth(c, "Stars", { shape: "star", w: c.stage.w, h: c.stage.h, count: 34, life: 2.4, speed: 0, size: 10, sizeEnd: 0, spin: 40, fadeIn: 0.4, fadeOut: 0.5 }, { blend: "add" }),
  make(c, "Shooting stars", part(c, { shape: "star", w: c.stage.w * 0.6, h: 10, count: cnt(c, 4), life: fit(c, 2.4), speed: 620, angle: 35, spread: 4, size: 11, sizeEnd: 0.1, colors: c.colors, fadeIn: 0.05, fadeOut: 0.5, seed: c.seed + 5 }), { blend: "add", fx: [glow(pick(c, 3), 8, 1.4)], transform: tf({ x: -c.stage.w * 0.2, y: -c.stage.h / 2 }) }),
  ...edgeGlow(c, pick(c, 0), 0.3),
  ...introFlash(c, pick(c, 3), 0.5),
  ...introReveal(c, pick(c, 2), 3),
  ...introBurst(c, { name: "Warp", shape: "spark", count: 110, speed: 900, speedJitter: 0.4, spread: 360, gravity: 0, size: 12, sizeEnd: 0.1 }),
] });

def({ id: "frozen-realm", name: "Frozen realm", group: G_SIG, intro: 1.8, description: "Bitter clear air: a pale aurora, snow at three depths, glints off the ice and frost gathering at the edges. Frost blooms across it and shards fly as it opens.", colors: ["#e0f2fe", "#7dd3fc", "#bae6fd", "#ffffff"], build: (c) => [
  ...bed(c, pick(c, 1), { a: 0.3, name: "Cold air" }),
  ...haze(c, pick(c, 1), { a: 0.3, scale: 240, speed: 0.2, seed: 21, name: "Aurora veil" }),
  ...depth(c, "Snow", { shape: "dot", w: c.stage.w, h: 10, count: 70, life: 6, speed: 55, angle: 90, spread: 16, size: 6, sizeJitter: 0.7, sizeEnd: 1, drift: 24, fadeIn: 0.1, fadeOut: 0.2 }, { y: -c.stage.h / 2 }),
  ...depth(c, "Ice glints", { shape: "star", w: c.stage.w, h: c.stage.h, count: 20, life: 1.8, speed: 0, size: 12, sizeEnd: 0, spin: 90, fadeIn: 0.3, fadeOut: 0.5, seed: c.seed + 4 }, { blend: "add", glow: pick(c, 1) }),
  ...sweep(c, "#ffffff", { a: 0.5, period: 3.6, width: 0.16, angle: 25, seed: 2 }),
  ...groundMist(c, pick(c, 2), 0.5),
  ...edgeGlow(c, pick(c, 0), 0.55),
  ...introFlash(c, pick(c, 3), 0.6),
  ...introReveal(c, pick(c, 1), 2),
  ...introBurst(c, { name: "Ice shards", shape: "square", count: 80, speed: 480, spread: 360, gravity: 340, size: 9, sizeEnd: 0.3, spin: 520 }),
] });

def({ id: "volcano", name: "Volcano", group: G_SIG, intro: 2, description: "Heat from below: a flickering orange glow, churning lava, ash smoke and embers climbing at three depths. It opens with an eruption.", colors: ["#fde047", "#fb923c", "#ef4444", "#7f1d1d"], build: (c) => [
  ...bed(c, pick(c, 2), { a: 0.42, y: c.stage.h * 0.3, scale: 1.5, period: 1.8, name: "Heat" }),
  ...haze(c, pick(c, 3), { a: 0.4, scale: 260, speed: 0.12, contrast: 0.5, blend: "normal", seed: 5, name: "Ash smoke" }),
  ...haze(c, pick(c, 1), { a: 0.5, scale: 140, speed: 0.3, contrast: 0.8, blend: "add", seed: 12, name: "Lava" }),
  ...depth(c, "Embers", { shape: "dot", w: c.stage.w * 0.8, h: 10, count: 55, life: 2.6, speed: 110, angle: -90, spread: 40, size: 6, sizeEnd: 0, drift: 20, fadeIn: 0.1, fadeOut: 0.5 }, { blend: "add", y: c.stage.h * 0.4 }),
  make(c, "Firelight", { type: "solid", w: c.stage.w, h: c.stage.h, color: pick(c, 2) }, { blend: "screen", transform: tf({ opacity: cycle(c, 0.8, [[0, 0.04], [0.3, 0.2], [0.6, 0.08]], 0.1) }) }),
  ...edgeGlow(c, pick(c, 2), 0.55),
  ...introFlash(c, pick(c, 0), 0.85),
  ...introReveal(c, pick(c, 1), 3),
  ...introBurst(c, { name: "Eruption", shape: "dot", w: c.stage.w * 0.3, h: 6, y: c.stage.h * 0.4, count: 130, speed: 720, speedJitter: 0.5, angle: -90, spread: 70, gravity: 520, size: 8, spin: 0 }),
] });

def({ id: "neon-nights", name: "Neon nights", group: G_SIG, intro: 1.6, description: "A neon sign in the rain: magenta and cyan light trading places, two frames of tube light, a scanning line, tearing glitch bars and pixel sparks. It opens with the sign striking on.", colors: ["#f0abfc", "#22d3ee", "#facc15"], build: (c) => [
  ...spill(c, pick(c, 0), pick(c, 1)),
  ...frame(c, pick(c, 0), 7, { stroke: 5, period: 2.4, name: "Neon frame" }),
  ...frame(c, pick(c, 1), 20, { stroke: 2, period: 3, name: "Inner frame" }),
  ...sweep(c, pick(c, 1), { a: 0.8, period: 2.6, width: 0.06, angle: 90, seed: 2 }),
  ...[0, 1, 2].map((i) => make(c, `Glitch ${i + 1}`, { type: "solid", w: c.stage.w, h: 5 + i * 5, color: pick(c, i) }, { blend: "add", transform: tf({ y: (i - 1) * c.stage.h * 0.25, x: cycle(c, 2.2 + i * 0.4, [[0, 0], [0.1, 30 - i * 20], [0.14, -22], [0.2, 0]], i / 3), opacity: cycle(c, 2.2 + i * 0.4, [[0, 0, "out"], [0.1, 0.9, "out"], [0.14, 0, "out"], [0.5, 0, "out"], [0.55, 0.7, "out"], [0.58, 0, "out"]], i / 3) }) })),
  ...depth(c, "Pixels", { shape: "square", w: c.stage.w, h: c.stage.h, count: 30, life: 1.2, speed: 140, spread: 360, size: 5, sizeEnd: 0, fadeIn: 0, fadeOut: 0.5 }, { blend: "add" }),
  ...edgeGlow(c, pick(c, 0), 0.35),
  ...introFlash(c, pick(c, 1), 0.5),
  ...introSweep(c, pick(c, 0)),
  ...introFlash(c, pick(c, 0), 0.6, 0.3),
  ...introBurst(c, { name: "Sparks", shape: "square", w: c.stage.w, h: c.stage.h, count: 70, speed: 220, spread: 360, gravity: 160, size: 6, sizeEnd: 0, spin: 300 }),
] });

def({ id: "blossom-storm", name: "Blossom storm", group: G_SIG, intro: 1.8, description: "Spring wind: petals tumbling past at three depths on a slant, pale light through the branches, glints and a pink haze. A gust of petals sweeps in as it opens.", colors: ["#fbcfe8", "#f9a8d4", "#ffffff", "#fda4af"], build: (c) => [
  ...bed(c, pick(c, 1), { a: 0.3, name: "Pink haze" }),
  ...haze(c, pick(c, 0), { a: 0.22, scale: 300, speed: 0.1, seed: 33, name: "Soft cloud" }),
  ...rays(c, "Light through branches", 11, pick(c, 2), { y: strip(c) ? 0 : -c.stage.h * 0.4, a: 0.25, softness: 0.85 }),
  ...depth(c, "Petals", { shape: "heart", w: c.stage.w * 1.2, h: 10, count: 44, life: 7, speed: 45, angle: 70, spread: 40, size: 12, sizeJitter: 0.5, sizeEnd: 0.9, spin: 120, gravity: 8, drift: 34, fadeIn: 0.1, fadeOut: 0.25 }, { x: -c.stage.w * 0.1, y: -c.stage.h / 2 }),
  ...depth(c, "Glints", { shape: "star", w: c.stage.w, h: c.stage.h, count: 14, life: 2.2, speed: 0, size: 9, sizeEnd: 0, spin: 60, fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 6 }, { blend: "add" }),
  ...edgeGlow(c, pick(c, 1), 0.3),
  ...introGust(c, "heart", { size: 12, count: 90, flash: 0.22, angle: 20 }),
] });

def({ id: "royal-court", name: "Royal court", group: G_SIG, intro: 2, description: "Gold on velvet: spotlights sweeping, a double shine, gold dust at three depths and a warm light at the edges. It opens with a flare of gold and a shower of stars.", colors: ["#fde68a", "#fbbf24", "#fffbeb", "#fb7185"], build: (c) => [
  ...bed(c, pick(c, 3), { a: 0.22, blend: "screen", name: "Velvet glow" }),
  ...bed(c, pick(c, 1), { a: 0.26, y: -c.stage.h * 0.2, name: "Candlelight", period: 2.6 }),
  ...depth(c, "Gold dust", { shape: "spark", w: c.stage.w, h: c.stage.h, count: 40, life: 5, speed: 10, spread: 360, size: 9, sizeEnd: 0, drift: 22, spin: 60, fadeIn: 0.35, fadeOut: 0.4 }, { blend: "add" }),
  ...sweep(c, pick(c, 2), { a: 0.7, period: 3.4, width: 0.14, angle: 24, seed: 3 }),
  ...sweep(c, pick(c, 0), { a: 0.5, period: 4.4, width: 0.2, angle: -28, seed: 9 }),
  make(c, "Spotlight", { type: "gradient", w: dim(c) * 1.1, h: dim(c) * 1.1, kind: "radial", angle: 0, stops: [{ o: 0, c: alpha(pick(c, 2), 0.8) }, { o: 1, c: clear(pick(c, 2)) }] }, { blend: "add", transform: tf({ x: cycle(c, 4.4, [[0, -c.stage.w * 0.32], [0.5, c.stage.w * 0.32]]) }) }),
  ...twinkles(c, 14, 10, 105),
  ...edgeGlow(c, pick(c, 1), 0.6),
  ...introBloom(c, { color: pick(c, 2), accent: pick(c, 1), flash: 0.8, rings: 2, burst: { shape: "star", count: 100, speed: 420, gravity: 300, size: 11 } }),
] });

def({ id: "cosmic-rift", name: "Cosmic rift", group: G_SIG, intro: 2, description: "A tear in the sky: violet and cyan plasma folding into each other round a bright seam, three rings drawing inward and stars falling through. It opens with the rift splitting.", colors: ["#a78bfa", "#22d3ee", "#f0abfc", "#ffffff"], build: (c) => [
  make(c, "Plasma A", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 120, speed: 0.6, color: pick(c, 0), contrast: 0.7, seed: c.seed }, { blend: "screen", transform: tf({ opacity: 0.8 }) }),
  make(c, "Plasma B", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 180, speed: -0.5, color: pick(c, 1), contrast: 0.7, seed: c.seed + 2 }, { blend: "screen", transform: tf({ opacity: 0.8 }) }),
  ...rays(c, "Seam", 12, pick(c, 2), { a: 0.4, softness: 0.8 }),
  ...core(c, pick(c, 3), { size: 0.6, a: 0.85, glow: pick(c, 2) }),
  ...(strip(c) ? [] : []),
  ...[0, 1 / 3, 2 / 3].map((phase, i) => make(c, `Portal ${i + 1}`, { type: "shape", shape: "ring", w: dim(c) * 0.9, h: dim(c) * 0.9, fill: "#ffffff00", stroke: pick(c, i), strokeWidth: 4, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, i), 10, 1.3)], transform: tf({ scaleX: cycle(c, 2.4, [[0, 1.1], [0.99, 0.2]], phase), scaleY: cycle(c, 2.4, [[0, 1.1], [0.99, 0.2]], phase), opacity: cycle(c, 2.4, [[0, 0], [0.15, 0.9], [0.9, 0]], phase) }) })),
  ...depth(c, "Falling stars", { shape: "star", w: c.stage.w, h: 10, count: 30, life: 2.4, speed: 160, angle: 90, spread: 20, size: 9, sizeEnd: 0.3, spin: 90, fadeIn: 0.1, fadeOut: 0.4 }, { blend: "add", y: -c.stage.h / 2 }),
  ...edgeGlow(c, pick(c, 0), 0.4),
  ...introFlash(c, pick(c, 3), 0.7),
  ...introReveal(c, pick(c, 1), 3),
  ...introBurst(c, { name: "Shards", shape: "spark", count: 100, speed: 640, spread: 360, gravity: 0, size: 12, sizeEnd: 0.1 }),
] });

def({ id: "candy-pop", name: "Candy pop", group: G_SIG, intro: 1.6, description: "A party in pastel: shifting candy colour, bubbles and hearts floating at three depths, sprinkles raining down and glints. Confetti cannons fire from both corners as it opens.", colors: ["#f472b6", "#facc15", "#34d399", "#60a5fa", "#a78bfa"], build: (c) => [
  make(c, "Candy wash", { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: cycle(c, 8, [[0, 60], [0.5, 120]]), stops: c.colors.slice(0, 4).map((col, i, a) => ({ o: r3(i / (a.length - 1 || 1)), c: col })) }, { blend: "screen", transform: tf({ opacity: 0.32 }) }),
  ...depth(c, "Bubbles", { shape: "ring", w: c.stage.w * 0.9, h: 10, count: 22, life: 4.4, speed: 50, angle: -90, spread: 24, size: 20, sizeJitter: 0.6, sizeEnd: 1.3, drift: 16, fadeIn: 0.2, fadeOut: 0.4 }, { y: c.stage.h * 0.4 }),
  ...depth(c, "Hearts", { shape: "heart", w: c.stage.w * 0.7, h: 10, count: 16, life: 3.6, speed: 80, angle: -90, spread: 30, size: 20, sizeEnd: 0.4, drift: 16, seed: c.seed + 3 }, { y: c.stage.h * 0.35 }),
  ...depth(c, "Sprinkles", { shape: "square", w: c.stage.w, h: 10, count: 60, life: 3, speed: 160, angle: 90, spread: 20, size: 5, sizeJitter: 0.4, sizeEnd: 1, spin: 300, fadeIn: 0.05, fadeOut: 0.15, seed: c.seed + 8 }, { y: -c.stage.h / 2 }),
  ...twinkles(c, 12, 10, 107),
  ...sweep(c, "#ffffff", { a: 0.35, period: 3.6, width: 0.14, angle: -22, seed: 7 }),
  ...edgeGlow(c, pick(c, 0), 0.3),
  ...introFlash(c, "#ffffff", 0.35),
  ...introBurst(c, { name: "Cannon left", shape: "square", x: -c.stage.w * 0.45, y: c.stage.h * 0.45, count: 60, speed: 680, speedJitter: 0.5, angle: -60, spread: 40, gravity: 520, size: 11, sizeEnd: 1, spin: 540 }),
  ...introBurst(c, { name: "Cannon right", shape: "square", x: c.stage.w * 0.45, y: c.stage.h * 0.45, count: 60, speed: 680, speedJitter: 0.5, angle: -120, spread: 40, gravity: 520, size: 11, sizeEnd: 1, spin: -540, seed: c.seed + 43 }),
] });

def({ id: "haunted", name: "Haunted", group: G_SIG, intro: 1.8, description: "A cold, dark room: shadow closing in at the edges, fog rolling past, pale wisps drifting up at three depths and the odd cold glint. A chill gust and a green flash open it.", colors: ["#86efac", "#a78bfa", "#e2e8f0", "#1e1b4b"], build: (c) => [
  ...haze(c, pick(c, 2), { a: 0.35, scale: 280, speed: 0.12, seed: 14, name: "Fog" }),
  ...haze(c, pick(c, 0), { a: 0.2, scale: 180, speed: -0.09, seed: 27, name: "Green fog" }),
  ...wisps(c, 9),
  ...depth(c, "Spirits", { shape: "dot", w: c.stage.w, h: c.stage.h, count: 24, life: 5, speed: 10, spread: 360, size: 4, sizeEnd: 0.5, drift: 24, fadeIn: 0.4, fadeOut: 0.4, seed: c.seed + 10 }, { blend: "add", glow: pick(c, 0) }),
  ...twinkles(c, 6, 8, 109),
  ...vignette(c, pick(c, 3), 0.8),
  ...edgeGlow(c, pick(c, 1), 0.22),
  ...introFlash(c, pick(c, 0), 0.45),
  ...(strip(c) ? introSweep(c, pick(c, 2)) : introRings(c, pick(c, 1), 1)),
  ...introGust(c, "dot", { size: 12, count: 60, flash: 0, gravity: 0, angle: 0 }),
] });

def({ id: "geode-crystal", name: "Geode crystal", group: G_SIG, intro: 2, description: "Light inside a cut geode: violet glow, facets catching the light at three depths, slow crystal rays and two sweeps of amethyst shine. Crystals shoot up and ring out as it opens.", colors: ["#c084fc", "#e9d5ff", "#a855f7", "#f0abfc"], build: (c) => [
  ...bed(c, pick(c, 2), { a: 0.38, name: "Violet glow" }),
  ...rays(c, "Crystal rays", 8, pick(c, 0), { y: strip(c) ? 0 : c.stage.h * 0.05, a: 0.3, softness: 0.5 }),
  ...rays(c, "Crystal rays 2", 14, pick(c, 3), { dir: -1, a: 0.2, softness: 0.7 }),
  ...core(c, pick(c, 1), { size: 0.6, a: 0.6, glow: pick(c, 0) }),
  ...depth(c, "Facets", { shape: "star", w: c.stage.w, h: c.stage.h, count: 30, life: 1.8, speed: 0, size: 14, sizeEnd: 0, spin: 90, fadeIn: 0.3, fadeOut: 0.5 }, { blend: "add", glow: pick(c, 0) }),
  ...sweep(c, pick(c, 1), { a: 0.6, period: 3.2, width: 0.14, angle: 30, seed: 2 }),
  ...sweep(c, pick(c, 3), { a: 0.45, period: 4.4, width: 0.2, angle: -34, seed: 8 }),
  ...edgeGlow(c, pick(c, 0), 0.5),
  ...introFlash(c, pick(c, 1), 0.6),
  ...introReveal(c, pick(c, 3), 2),
  ...introBurst(c, { name: "Crystals", shape: "star", w: c.stage.w, h: 6, y: c.stage.h * 0.45, count: 90, speed: 560, speedJitter: 0.5, angle: -90, spread: 50, gravity: 360, size: 13, sizeEnd: 0.3, spin: 140 }),
] });

def({ id: "golden-hour", name: "Golden hour", group: G_SIG, intro: 1.8, description: "Low sun through a window: a warm flare gliding across, light leaking in at the edge, soft shafts and dust hanging in the air at three depths. The light slides in as it opens.", colors: ["#fed7aa", "#fb923c", "#fde68a", "#f43f5e"], build: (c) => [
  ...bed(c, pick(c, 1), { a: 0.3, y: c.stage.h * 0.1, name: "Warm light" }),
  make(c, "Light leak", { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: cycle(c, 6, [[0, 25], [0.5, 70]]), stops: [{ o: 0, c: pick(c, 1) }, { o: 0.45, c: `${pick(c, 3)}99` }, { o: 1, c: clear(pick(c, 2)) }] }, { blend: "screen", transform: tf({ opacity: cycle(c, 6, [[0, 0.3], [0.5, 0.65]]) }) }),
  ...rays(c, "Window light", 7, pick(c, 2), { x: -c.stage.w * 0.2, y: strip(c) ? 0 : -c.stage.h * 0.45, a: 0.3, softness: 0.8 }),
  ...depth(c, "Dust", { shape: "dot", w: c.stage.w, h: c.stage.h, count: 40, life: 6, speed: 8, spread: 360, size: 3, sizeEnd: 0.7, drift: 18, fadeIn: 0.4, fadeOut: 0.4 }, { blend: "add" }),
  make(c, "Lens flare", { type: "gradient", w: dim(c) * 0.9, h: dim(c) * 0.9, kind: "radial", angle: 0, stops: [{ o: 0, c: pick(c, 0) }, { o: 0.35, c: `${pick(c, 1)}88` }, { o: 1, c: clear(pick(c, 1)) }] }, { blend: "add", transform: tf({ x: cycle(c, c.idle, [[0, -c.stage.w * 0.55, "linear"], [0.999, c.stage.w * 0.55, "linear"]]), opacity: cycle(c, c.idle, [[0, 0], [0.3, 1, "linear"], [0.7, 1], [0.999, 0]]) }) }),
  ...edgeGlow(c, pick(c, 1), 0.35),
  ...introFlash(c, pick(c, 0), 0.5),
  ...introSweep(c, pick(c, 2)),
  ...introBurst(c, { name: "Motes", shape: "dot", w: c.stage.w, h: c.stage.h, count: 60, speed: 60, spread: 360, gravity: -40, size: 5, sizeEnd: 0 }),
] });

def({ id: "mainframe", name: "Mainframe", group: G_SIG, intro: 1.6, description: "A terminal waking up: code pouring down at three speeds, a scanning line, cyan interference and the odd glitch bar. It boots with a flash, a scan and a burst of bits.", colors: ["#4ade80", "#86efac", "#16a34a", "#22d3ee"], build: (c) => [
  ...haze(c, pick(c, 3), { a: 0.25, scale: 90, speed: 0.7, contrast: 0.6, blend: "add", seed: 4, name: "Interference" }),
  ...depth(c, "Code", { shape: "square", w: c.stage.w, h: 10, count: 70, life: 2.2, speed: 260, speedJitter: 0.3, angle: 90, spread: 0, size: 5, sizeEnd: 1, fadeIn: 0.05, fadeOut: 0.6 }, { blend: "add", y: -c.stage.h / 2 }),
  ...sweep(c, pick(c, 0), { a: 0.8, period: 2.6, width: 0.06, angle: 90, seed: 2 }),
  make(c, "Glitch bar", { type: "solid", w: c.stage.w, h: 8, color: pick(c, 3) }, { blend: "add", transform: tf({ y: -c.stage.h * 0.15, x: cycle(c, 2.6, [[0, 0], [0.1, 26], [0.14, -18], [0.2, 0]]), opacity: cycle(c, 2.6, [[0, 0, "out"], [0.1, 0.9, "out"], [0.14, 0, "out"], [0.6, 0, "out"], [0.65, 0.7, "out"], [0.68, 0, "out"]]) }) }),
  ...edgeGlow(c, pick(c, 0), 0.35),
  ...introFlash(c, pick(c, 0), 0.4),
  ...introSweep(c, pick(c, 1)),
  ...introBurst(c, { name: "Bits", shape: "square", w: c.stage.w, h: c.stage.h, count: 80, speed: 60, spread: 360, gravity: 0, size: 6, sizeEnd: 0, spin: 0 }),
] });

// --- Sparkle & light ---------------------------------------------------------------------------------------------------

def({ id: "twinkle-field", name: "Twinkle field", group: G_SPARK, description: "Stars blinking on and off across the whole area.", colors: ["#ffffff", "#fde68a", "#bae6fd"], build: (c) => [make(c, "Twinkle", part(c, { shape: "star", w: c.stage.w, h: c.stage.h, count: cnt(c, 46), life: fit(c, 2.4), speed: 0, size: 12, sizeEnd: 0, spin: 40, colors: c.colors, fadeIn: 0.4, fadeOut: 0.5 }), { blend: "add" })] });
def({ id: "glitter-fall", name: "Glitter fall", group: G_SPARK, description: "Fine glitter drifting down from above.", colors: ["#ffffff", "#fcd34d", "#f9a8d4"], build: (c) => [make(c, "Glitter", part(c, { shape: "dot", w: c.stage.w, h: 10, count: cnt(c, 80), life: fit(c, 4), speed: 70, angle: 90, spread: 20, size: 4, sizeJitter: 0.6, sizeEnd: 0.8, colors: c.colors, drift: 10, fadeIn: 0.1, fadeOut: 0.3 }), { blend: "add", transform: tf({ y: -c.stage.h / 2 }) })] });
def({ id: "diamond-dust", name: "Diamond dust", group: G_SPARK, description: "Tiny glints hanging in the air and slowly turning.", colors: ["#ffffff", "#e0f2fe"], build: (c) => [make(c, "Dust", part(c, { shape: "spark", w: c.stage.w, h: c.stage.h, count: cnt(c, 36), life: fit(c, 5), speed: 10, spread: 360, size: 9, sizeEnd: 0, drift: 22, spin: 60, colors: c.colors, fadeIn: 0.35, fadeOut: 0.4 }), { blend: "add" })] });
def({ id: "shine-sweep", name: "Shine sweep", group: G_SPARK, description: "A soft band of light sweeping across.", colors: ["#ffffff"], build: (c) => [make(c, "Shine", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: 20, width: 0.22, period: fit(c, 2.4), color: pick(c, 0), seed: c.seed }, { blend: "add" })] });
def({ id: "double-shine", name: "Double shine", group: G_SPARK, description: "Two crossing sweeps at different speeds.", colors: ["#ffffff", "#bfdbfe"], build: (c) => [make(c, "Shine A", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: 20, width: 0.14, period: fit(c, 2), color: pick(c, 0), seed: c.seed }, { blend: "add" }), make(c, "Shine B", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: -24, width: 0.2, period: fit(c, 3), color: pick(c, 1), seed: c.seed + 1 }, { blend: "add" })] });
def({ id: "halo-glow", name: "Halo glow", group: G_SPARK, description: "A warm glow that breathes in the middle.", colors: ["#fde68a"], build: (c) => [make(c, "Halo", { type: "gradient", w: c.stage.w * 1.2, h: c.stage.h * 1.2, kind: "radial", angle: 0, stops: [{ o: 0, c: pick(c, 0) }, { o: 1, c: clear(pick(c, 0)) }] }, { blend: "add", transform: tf({ opacity: cycle(c, 3, [[0, 0.45], [0.5, 1]]) }) })] });
def({ id: "god-rays", name: "God rays", group: G_SPARK, description: "Beams of light fanning down from the top.", colors: ["#fde68a"], build: (c) => [make(c, "Rays", { type: "rays", r: Math.max(c.stage.w, c.stage.h) * 0.9, count: 14, color: pick(c, 0), spin: raySpin(c, 14), softness: 0.65 }, { blend: "add", transform: tf({ y: c.kind === "effect" ? -c.stage.h * 0.4 : 0, opacity: 0.55 }) })] });
def({ id: "sunburst", name: "Sunburst", group: G_SPARK, description: "Sharp rays turning slowly behind a bright core.", colors: ["#fbbf24", "#fff7ed"], build: (c) => [make(c, "Rays", { type: "rays", r: Math.max(c.stage.w, c.stage.h) * 0.8, count: 24, color: pick(c, 0), spin: raySpin(c, 24, 2), softness: 0.25 }, { blend: "add", transform: tf({ opacity: 0.5 }) }), make(c, "Core", { type: "gradient", w: Math.min(c.stage.w, c.stage.h) * 1.1, h: Math.min(c.stage.w, c.stage.h) * 1.1, kind: "radial", angle: 0, stops: [{ o: 0, c: pick(c, 1) }, { o: 1, c: clear(pick(c, 1)) }] }, { blend: "add", transform: tf({ opacity: cycle(c, 2.5, [[0, 0.7], [0.5, 1]]) }) })] });
def({ id: "lens-flare", name: "Lens flare", group: G_SPARK, description: "A flare gliding across like sun catching a lens.", colors: ["#fef3c7", "#fb923c"], build: (c) => [make(c, "Flare", { type: "gradient", w: Math.min(c.stage.w, c.stage.h) * 0.9, h: Math.min(c.stage.w, c.stage.h) * 0.9, kind: "radial", angle: 0, stops: [{ o: 0, c: pick(c, 0) }, { o: 0.35, c: `${pick(c, 1)}88` }, { o: 1, c: clear(pick(c, 1)) }] }, { blend: "add", transform: tf({ x: cycle(c, c.idle, [[0, -c.stage.w * 0.55, "linear"], [0.999, c.stage.w * 0.55, "linear"]]), opacity: cycle(c, c.idle, [[0, 0], [0.3, 1, "linear"], [0.7, 1], [0.999, 0]]) }) })] });
def({ id: "light-leak", name: "Light leak", group: G_SPARK, description: "Warm film-style light washing in at the edge.", colors: ["#fb923c", "#f43f5e", "#fde68a"], build: (c) => [make(c, "Leak", { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: cycle(c, 6, [[0, 25], [0.5, 70]]), stops: [{ o: 0, c: pick(c, 0) }, { o: 0.45, c: `${pick(c, 1)}99` }, { o: 1, c: clear(pick(c, 2)) }] }, { blend: "screen", transform: tf({ opacity: cycle(c, 6, [[0, 0.35], [0.5, 0.75]]) }) })] });

// --- Weather & nature --------------------------------------------------------------------------------------------------

def({ id: "snowfall", name: "Snowfall", group: G_NATURE, description: "Soft flakes falling and drifting.", colors: ["#ffffff", "#e0f2fe"], build: (c) => [make(c, "Snow", part(c, { shape: "dot", w: c.stage.w, h: 10, count: cnt(c, 90), life: fit(c, 6), speed: 60, angle: 90, spread: 16, size: 6, sizeJitter: 0.7, sizeEnd: 1, colors: c.colors, drift: 24, fadeIn: 0.1, fadeOut: 0.2 }), { transform: tf({ y: -c.stage.h / 2 }) })] });
def({ id: "blizzard", name: "Blizzard", group: G_NATURE, description: "Wind-driven snow, fast and slanting.", colors: ["#ffffff", "#cbd5e1"], build: (c) => [make(c, "Blizzard", part(c, { shape: "dot", w: c.stage.w * 1.5, h: 10, count: cnt(c, 160), life: fit(c, 2.4), speed: 240, angle: 68, spread: 14, size: 4, sizeJitter: 0.6, sizeEnd: 1, colors: c.colors, drift: 10, fadeIn: 0.1, fadeOut: 0.2 }), { transform: tf({ x: -c.stage.w * 0.2, y: -c.stage.h / 2 }) })] });
def({ id: "rain", name: "Rain", group: G_NATURE, description: "Steady rain, with a cool cast.", colors: ["#93c5fd", "#bfdbfe"], build: (c) => [make(c, "Rain", part(c, { shape: "dot", w: c.stage.w * 1.2, h: 10, count: cnt(c, 120), life: fit(c, 0.9), speed: 520, speedJitter: 0.2, angle: 98, spread: 4, size: 3, sizeEnd: 0.8, colors: c.colors, fadeIn: 0.05, fadeOut: 0.3 }), { transform: tf({ y: -c.stage.h / 2, opacity: 0.8 }) })] });
def({ id: "cherry-blossoms", name: "Cherry blossoms", group: G_NATURE, description: "Petals turning as they fall.", colors: ["#fbcfe8", "#f9a8d4", "#ffffff"], build: (c) => [make(c, "Petals", part(c, { shape: "heart", w: c.stage.w, h: 10, count: cnt(c, 40), life: fit(c, 7), speed: 40, angle: 80, spread: 40, size: 12, sizeJitter: 0.5, sizeEnd: 0.9, spin: 120, gravity: 8, colors: c.colors, drift: 30, fadeIn: 0.1, fadeOut: 0.25 }), { transform: tf({ y: -c.stage.h / 2 }) })] });
def({ id: "autumn-leaves", name: "Autumn leaves", group: G_NATURE, description: "Orange and red leaves tumbling down.", colors: ["#f97316", "#dc2626", "#fbbf24", "#a16207"], build: (c) => [make(c, "Leaves", part(c, { shape: "square", w: c.stage.w, h: 10, count: cnt(c, 36), life: fit(c, 7), speed: 50, angle: 90, spread: 30, size: 10, sizeJitter: 0.5, sizeEnd: 1, spin: 220, colors: c.colors, drift: 40, fadeIn: 0.1, fadeOut: 0.2 }), { transform: tf({ y: -c.stage.h / 2 }) })] });
def({ id: "fireflies", name: "Fireflies", group: G_NATURE, description: "Warm lights wandering in the dark.", colors: ["#fde047", "#bef264"], build: (c) => [make(c, "Fireflies", part(c, { shape: "dot", w: c.stage.w, h: c.stage.h, count: cnt(c, 26), life: fit(c, 4), speed: 12, spread: 360, size: 7, sizeEnd: 0.6, colors: c.colors, drift: 28, fadeIn: 0.4, fadeOut: 0.4 }), { blend: "add", fx: [glow(pick(c, 0), 10, 1.2)] })] });
def({ id: "morning-mist", name: "Morning mist", group: G_NATURE, description: "Low fog rolling slowly past.", colors: ["#e2e8f0"], build: (c) => [make(c, "Mist", { type: "noise", w: c.stage.w * 1.2, h: c.stage.h * 1.2, scale: 260, speed: 0.15, color: pick(c, 0), contrast: 0.35, seed: c.seed }, { blend: "screen", transform: tf({ opacity: 0.55 }) }), make(c, "Mist 2", { type: "noise", w: c.stage.w * 1.2, h: c.stage.h * 1.2, scale: 140, speed: -0.1, color: pick(c, 0), contrast: 0.3, seed: c.seed + 5 }, { blend: "screen", transform: tf({ opacity: 0.3 }) })] });
def({ id: "drifting-clouds", name: "Drifting clouds", group: G_NATURE, description: "Big soft clouds moving across.", colors: ["#ffffff"], build: (c) => [make(c, "Clouds", { type: "noise", w: c.stage.w * 1.3, h: c.stage.h * 1.3, scale: 380, speed: 0.08, color: pick(c, 0), contrast: 0.6, seed: c.seed }, { transform: tf({ opacity: 0.55 }) })] });
def({ id: "aurora", name: "Aurora", group: G_NATURE, description: "Curtains of green and violet light.", colors: ["#5eead4", "#a78bfa"], build: (c) => [make(c, "Aurora", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 220, speed: 0.25, color: pick(c, 0), contrast: 0.6, seed: c.seed }, { blend: "screen" }), make(c, "Aurora 2", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 300, speed: -0.18, color: pick(c, 1), contrast: 0.55, seed: c.seed + 9 }, { blend: "screen", transform: tf({ opacity: 0.7 }) })] });
def({ id: "sandstorm", name: "Sandstorm", group: G_NATURE, description: "Wind-blown grit crossing sideways.", colors: ["#d6b88a", "#c2a070", "#f1e0c0"], build: (c) => [make(c, "Sand", part(c, { shape: "dot", w: 10, h: c.stage.h, count: cnt(c, 140), life: fit(c, 2), speed: 300, angle: 8, spread: 12, size: 3, sizeJitter: 0.6, sizeEnd: 1, colors: c.colors, drift: 14, fadeIn: 0.1, fadeOut: 0.3 }), { transform: tf({ x: -c.stage.w / 2, opacity: 0.85 }) })] });

// --- Fire & energy -----------------------------------------------------------------------------------------------------

def({ id: "embers", name: "Embers", group: G_FIRE, description: "Sparks rising from below.", colors: ["#fb923c", "#f97316", "#fde047"], build: (c) => [make(c, "Embers", part(c, { shape: "dot", w: c.stage.w * 0.8, h: 10, count: cnt(c, 60), life: fit(c, 2.6), speed: 110, angle: -90, spread: 40, size: 6, sizeEnd: 0, colors: c.colors, drift: 20, fadeIn: 0.1, fadeOut: 0.5 }), { blend: "add", transform: tf({ y: c.stage.h * 0.4 }) })] });
def({ id: "campfire", name: "Campfire", group: G_FIRE, description: "A flickering orange glow with sparks.", colors: ["#f97316", "#fde047"], build: (c) => [make(c, "Glow", { type: "gradient", w: c.stage.w * 1.2, h: c.stage.h * 0.9, kind: "radial", angle: 0, stops: [{ o: 0, c: pick(c, 0) }, { o: 1, c: clear(pick(c, 0)) }] }, { blend: "add", transform: tf({ y: c.stage.h * 0.3, opacity: cycle(c, 0.7, [[0, 0.5], [0.3, 0.95], [0.6, 0.65]], 0.1) }) }), make(c, "Sparks", part(c, { shape: "dot", w: c.stage.w * 0.4, h: 10, count: cnt(c, 24), life: fit(c, 2), speed: 120, angle: -90, spread: 30, size: 5, sizeEnd: 0, colors: c.colors, drift: 14, fadeIn: 0.1, fadeOut: 0.5, seed: c.seed + 3 }), { blend: "add", transform: tf({ y: c.stage.h * 0.4 }) })] });
def({ id: "lava", name: "Lava", group: G_FIRE, description: "Molten glow churning under the surface.", colors: ["#f97316", "#dc2626"], build: (c) => [make(c, "Lava", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 140, speed: 0.35, color: pick(c, 0), contrast: 0.8, seed: c.seed }, { blend: "add", transform: tf({ opacity: 0.8 }) }), make(c, "Heat", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 220, speed: -0.2, color: pick(c, 1), contrast: 0.6, seed: c.seed + 4 }, { blend: "add", transform: tf({ opacity: 0.5 }) })] });
def({ id: "lightning", name: "Lightning", group: G_FIRE, description: "Sudden flashes of white-blue light.", colors: ["#e0f2fe"], build: (c) => [make(c, "Flash", { type: "solid", w: c.stage.w, h: c.stage.h, color: pick(c, 0) }, { blend: "add", transform: tf({ opacity: cycle(c, 3.5, [[0, 0, "out"], [0.02, 0.9, "out"], [0.06, 0.1, "out"], [0.1, 0.7, "out"], [0.2, 0, "out"]]) }) })] });
def({ id: "static-charge", name: "Static charge", group: G_FIRE, description: "Little electric sparks crackling about.", colors: ["#67e8f9", "#ffffff"], build: (c) => [make(c, "Static", part(c, { shape: "spark", w: c.stage.w, h: c.stage.h, count: cnt(c, 40), life: fit(c, 0.6), speed: 130, spread: 360, size: 9, sizeEnd: 0, spin: 300, colors: c.colors, fadeIn: 0.1, fadeOut: 0.5 }), { blend: "add", fx: [glow(pick(c, 0), 8, 1.4)] })] });
def({ id: "plasma", name: "Plasma", group: G_FIRE, description: "Two colours swirling into each other.", colors: ["#f0abfc", "#22d3ee"], build: (c) => [make(c, "Plasma A", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 120, speed: 0.6, color: pick(c, 0), contrast: 0.7, seed: c.seed }, { blend: "screen" }), make(c, "Plasma B", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 180, speed: -0.5, color: pick(c, 1), contrast: 0.7, seed: c.seed + 2 }, { blend: "screen" })] });
def({ id: "energy-pulse", name: "Energy pulse", group: G_FIRE, description: "Rings of energy rippling outward.", colors: ["#a78bfa", "#38bdf8"], build: (c) => [0, 0.5].map((phase, i) => make(c, `Pulse ${i + 1}`, { type: "shape", shape: "ring", w: Math.min(c.stage.w, c.stage.h) * 0.4, h: Math.min(c.stage.w, c.stage.h) * 0.4, fill: "#ffffff00", stroke: pick(c, i), strokeWidth: 6, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, i), 12, 1.4)], transform: tf({ scaleX: cycle(c, 1.8, [[0, 0.2, "out"], [0.99, 2.8]], phase), scaleY: cycle(c, 1.8, [[0, 0.2, "out"], [0.99, 2.8]], phase), opacity: cycle(c, 1.8, [[0, 0], [0.08, 1, "out"], [0.9, 0]], phase) }) })) });
def({ id: "shockwave", name: "Shockwave", group: G_FIRE, description: "A fast ring bursting out from the centre.", colors: ["#fef3c7", "#fb923c"], build: (c) => [make(c, "Ring", { type: "shape", shape: "ring", w: Math.min(c.stage.w, c.stage.h) * 0.3, h: Math.min(c.stage.w, c.stage.h) * 0.3, fill: "#ffffff00", stroke: pick(c, 0), strokeWidth: 8, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, 1), 16, 1.6)], transform: tf({ scaleX: cycle(c, 2.4, [[0, 0.1, "out"], [0.55, 3.4, "linear"], [0.99, 3.4]]), scaleY: cycle(c, 2.4, [[0, 0.1, "out"], [0.55, 3.4, "linear"], [0.99, 3.4]]), opacity: cycle(c, 2.4, [[0, 0], [0.03, 1, "out"], [0.55, 0], [0.99, 0]]) }) })] });

// --- Love & fun --------------------------------------------------------------------------------------------------------

def({ id: "floating-hearts", name: "Floating hearts", group: G_FUN, description: "Hearts floating gently upward.", colors: ["#fb7185", "#f43f5e", "#fda4af"], build: (c) => [make(c, "Hearts", part(c, { shape: "heart", w: c.stage.w * 0.7, h: 20, count: cnt(c, 24), life: fit(c, 3.2), speed: 90, angle: -90, spread: 30, size: 22, sizeEnd: 0.4, colors: c.colors, drift: 16 }), { transform: tf({ y: c.stage.h * 0.3 }) })] });
def({ id: "heart-burst", name: "Heart burst", group: G_FUN, description: "A pop of hearts that arcs and falls.", colors: ["#fb7185", "#f43f5e", "#fecdd3"], build: (c) => [make(c, "Burst", part(c, { shape: "heart", w: 4, h: 4, mode: "burst", count: cnt(c, 36), life: fit(c, 2.4), speed: 260, speedJitter: 0.5, angle: -90, spread: 300, gravity: 160, size: 18, sizeEnd: 0.5, colors: c.colors, fadeIn: 0, fadeOut: 0.4 }), { transform: tf({ y: c.stage.h * 0.1 }) })] });
def({ id: "confetti-burst", name: "Confetti burst", group: G_FUN, description: "A party-popper of confetti.", colors: ["#f43f5e", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"], build: (c) => [make(c, "Confetti", part(c, { shape: "square", w: 1, h: 1, mode: "burst", count: cnt(c, 90), life: fit(c, 3), speed: 380, speedJitter: 0.6, angle: -90, spread: 120, gravity: 520, size: 12, sizeEnd: 1, spin: 540, colors: c.colors, fadeIn: 0, fadeOut: 0.25 }), { transform: tf({ y: c.stage.h * 0.25 }) })] });
def({ id: "confetti-rain", name: "Confetti rain", group: G_FUN, description: "Confetti showering down continuously.", colors: ["#f43f5e", "#fbbf24", "#34d399", "#60a5fa", "#a78bfa"], build: (c) => [make(c, "Confetti", part(c, { shape: "square", w: c.stage.w, h: 10, count: cnt(c, 70), life: fit(c, 4.5), speed: 130, angle: 90, spread: 14, size: 10, sizeJitter: 0.5, sizeEnd: 1, spin: 380, colors: c.colors, drift: 18, fadeIn: 0.05, fadeOut: 0.15 }), { transform: tf({ y: -c.stage.h / 2 }) })] });
def({ id: "soap-bubbles", name: "Soap bubbles", group: G_FUN, description: "Light bubbles rising and swelling.", colors: ["#bae6fd", "#ffffff", "#fbcfe8"], build: (c) => [make(c, "Bubbles", part(c, { shape: "ring", w: c.stage.w * 0.7, h: 10, count: cnt(c, 22), life: fit(c, 4), speed: 50, angle: -90, spread: 20, size: 26, sizeJitter: 0.6, sizeEnd: 1.3, colors: c.colors, drift: 14, fadeIn: 0.2, fadeOut: 0.4 }), { transform: tf({ y: c.stage.h * 0.35 }) })] });
def({ id: "disco", name: "Disco", group: G_FUN, description: "Spinning coloured beams and sparkles.", colors: ["#f0abfc", "#22d3ee", "#fde047"], build: (c) => [make(c, "Beams", { type: "rays", r: Math.max(c.stage.w, c.stage.h) * 0.8, count: 18, color: colorLoop(c, c.colors), spin: raySpin(c, 18, 2), softness: 0.4 }, { blend: "add", transform: tf({ opacity: 0.55 }) }), make(c, "Glints", part(c, { shape: "star", w: c.stage.w, h: c.stage.h, count: cnt(c, 24), life: fit(c, 1.6), speed: 0, size: 12, sizeEnd: 0, spin: 80, colors: c.colors, fadeIn: 0.3, fadeOut: 0.5, seed: c.seed + 6 }), { blend: "add" })] });
def({ id: "star-shower", name: "Star shower", group: G_FUN, description: "Stars streaming down on a slant.", colors: ["#fde68a", "#ffffff", "#fcd34d"], build: (c) => [make(c, "Stars", part(c, { shape: "star", w: c.stage.w * 1.2, h: 10, count: cnt(c, 30), life: fit(c, 2.4), speed: 200, angle: 62, spread: 10, size: 12, sizeEnd: 0.3, spin: 90, colors: c.colors, fadeIn: 0.1, fadeOut: 0.4 }), { blend: "add", transform: tf({ x: -c.stage.w * 0.1, y: -c.stage.h / 2 }) })] });
def({ id: "balloons", name: "Balloons", group: G_FUN, description: "Bright balloons floating up and swaying.", colors: ["#f43f5e", "#38bdf8", "#facc15", "#4ade80"], build: (c) => [make(c, "Balloons", part(c, { shape: "dot", w: c.stage.w * 0.8, h: 10, count: cnt(c, 10), life: fit(c, 6), speed: 70, angle: -90, spread: 12, size: 34, sizeJitter: 0.3, sizeEnd: 1, colors: c.colors, drift: 22, fadeIn: 0.1, fadeOut: 0.1 }), { transform: tf({ y: c.stage.h * 0.45 }) })] });
def({ id: "sprinkles", name: "Sprinkles", group: G_FUN, description: "Tiny sweets bouncing down.", colors: ["#f472b6", "#facc15", "#34d399", "#60a5fa"], build: (c) => [make(c, "Sprinkles", part(c, { shape: "square", w: c.stage.w, h: 10, count: cnt(c, 70), life: fit(c, 3), speed: 160, angle: 90, spread: 20, size: 5, sizeJitter: 0.4, sizeEnd: 1, spin: 300, colors: c.colors, fadeIn: 0.05, fadeOut: 0.15 }), { transform: tf({ y: -c.stage.h / 2 }) })] });

// --- Space & magic -----------------------------------------------------------------------------------------------------

def({ id: "starfield", name: "Starfield", group: G_SPACE, description: "Stars appearing and fading across the dark.", colors: ["#fef9c3", "#ffffff"], build: (c) => [make(c, "Stars", part(c, { shape: "star", w: c.stage.w, h: c.stage.h, count: cnt(c, 40), life: fit(c, 2.4), speed: 0, size: 12, sizeEnd: 0, spin: 40, colors: c.colors, fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 19 }), { blend: "add" })] });
def({ id: "shooting-stars", name: "Shooting stars", group: G_SPACE, description: "Streaks of light crossing the sky.", colors: ["#ffffff", "#bae6fd"], build: (c) => [make(c, "Streaks", part(c, { shape: "star", w: c.stage.w * 0.6, h: 10, count: cnt(c, 4), life: fit(c, 2.4), speed: 620, angle: 35, spread: 4, size: 11, sizeEnd: 0.1, colors: c.colors, fadeIn: 0.05, fadeOut: 0.5 }), { blend: "add", fx: [glow(pick(c, 1), 8, 1.4)], transform: tf({ x: -c.stage.w * 0.2, y: -c.stage.h / 2 }) })] });
def({ id: "nebula", name: "Nebula", group: G_SPACE, description: "Violet and pink gas clouds with stars.", colors: ["#7c3aed", "#ec4899", "#ffffff"], build: (c) => [make(c, "Gas", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 300, speed: 0.1, color: pick(c, 0), contrast: 0.5, seed: c.seed }, { blend: "screen" }), make(c, "Gas 2", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 240, speed: -0.08, color: pick(c, 1), contrast: 0.5, seed: c.seed + 3 }, { blend: "screen", transform: tf({ opacity: 0.7 }) }), make(c, "Stars", part(c, { shape: "dot", w: c.stage.w, h: c.stage.h, count: cnt(c, 30), life: fit(c, 3), speed: 0, size: 3, sizeEnd: 0, colors: [pick(c, 2)], fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 8 }), { blend: "add" })] });
def({ id: "galaxy-swirl", name: "Galaxy swirl", group: G_SPACE, description: "Arms of light turning around a bright core.", colors: ["#818cf8", "#f0abfc"], build: (c) => [make(c, "Arms", { type: "rays", r: Math.max(c.stage.w, c.stage.h) * 0.7, count: 40, color: pick(c, 0), spin: raySpin(c, 40, 3), softness: 0.9 }, { blend: "add", transform: tf({ opacity: 0.45 }) }), make(c, "Dust", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 200, speed: 0.12, color: pick(c, 1), contrast: 0.5, seed: c.seed }, { blend: "screen", transform: tf({ opacity: 0.6 }) }), make(c, "Core", { type: "gradient", w: Math.min(c.stage.w, c.stage.h) * 0.8, h: Math.min(c.stage.w, c.stage.h) * 0.8, kind: "radial", angle: 0, stops: [{ o: 0, c: "#ffffff" }, { o: 1, c: "#ffffff00" }] }, { blend: "add", transform: tf({ opacity: 0.7 }) })] });
def({ id: "magic-dust", name: "Magic dust", group: G_SPACE, description: "Glittering motes spiralling upward.", colors: ["#f0abfc", "#a5f3fc", "#fde68a"], build: (c) => [make(c, "Dust", part(c, { shape: "spark", w: c.stage.w * 0.6, h: 10, count: cnt(c, 50), life: fit(c, 3), speed: 40, angle: -90, spread: 120, size: 12, sizeEnd: 0, spin: 200, colors: c.colors, drift: 18, fadeIn: 0.2, fadeOut: 0.4 }), { blend: "add", transform: tf({ y: c.stage.h * 0.3 }) })] });
def({ id: "portal-rings", name: "Portal rings", group: G_SPACE, description: "Glowing rings pulsing in towards the middle.", colors: ["#22d3ee", "#a78bfa"], build: (c) => [0, 1 / 3, 2 / 3].map((phase, i) => make(c, `Ring ${i + 1}`, { type: "shape", shape: "ring", w: Math.min(c.stage.w, c.stage.h) * 0.9, h: Math.min(c.stage.w, c.stage.h) * 0.9, fill: "#ffffff00", stroke: pick(c, i), strokeWidth: 4, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, i), 10, 1.3)], transform: tf({ scaleX: cycle(c, 2.4, [[0, 1.1], [0.99, 0.2]], phase), scaleY: cycle(c, 2.4, [[0, 1.1], [0.99, 0.2]], phase), opacity: cycle(c, 2.4, [[0, 0], [0.15, 0.9], [0.9, 0]], phase) }) })) });
def({ id: "aether-orbs", name: "Aether orbs", group: G_SPACE, description: "Large soft orbs of light drifting about.", colors: ["#c4b5fd", "#7dd3fc"], build: (c) => [make(c, "Orbs", part(c, { shape: "dot", w: c.stage.w, h: c.stage.h, count: cnt(c, 8), life: fit(c, 6), speed: 14, spread: 360, size: 40, sizeJitter: 0.5, sizeEnd: 1.2, colors: c.colors, drift: 20, fadeIn: 0.4, fadeOut: 0.4 }), { blend: "add", fx: [{ type: "blur", amount: 6 }, glow(pick(c, 0), 18, 1.2)] })] });
def({ id: "moonlight", name: "Moonlight", group: G_SPACE, description: "Cool light from above, with a few stars.", colors: ["#bfdbfe", "#ffffff"], build: (c) => [make(c, "Light", { type: "gradient", w: c.stage.w * 1.2, h: c.stage.h, kind: "radial", angle: 0, stops: [{ o: 0, c: `${pick(c, 0)}cc` }, { o: 1, c: clear(pick(c, 0)) }] }, { blend: "add", transform: tf({ y: c.kind === "effect" ? -c.stage.h * 0.35 : 0, opacity: cycle(c, 5, [[0, 0.6], [0.5, 0.9]]) }) }), make(c, "Stars", part(c, { shape: "star", w: c.stage.w, h: c.stage.h, count: cnt(c, 14), life: fit(c, 2.8), speed: 0, size: 10, sizeEnd: 0, colors: [pick(c, 1)], fadeIn: 0.4, fadeOut: 0.5, seed: c.seed + 2 }), { blend: "add" })] });

// --- Water -------------------------------------------------------------------------------------------------------------

def({ id: "ripples", name: "Ripples", group: G_WATER, description: "Rings spreading across still water.", colors: ["#7dd3fc", "#e0f2fe"], build: (c) => [0, 1 / 3, 2 / 3].map((phase, i) => make(c, `Ripple ${i + 1}`, { type: "shape", shape: "ring", w: Math.min(c.stage.w, c.stage.h) * 0.5, h: Math.min(c.stage.w, c.stage.h) * 0.5, fill: "#ffffff00", stroke: pick(c, i), strokeWidth: 3, radius: 0, points: 5, inner: 0.5 }, { blend: "add", transform: tf({ y: c.stage.h * 0.1, scaleX: cycle(c, 3, [[0, 0.1, "out"], [0.99, 2.4]], phase), scaleY: cycle(c, 3, [[0, 0.05, "out"], [0.99, 1.2]], phase), opacity: cycle(c, 3, [[0, 0.9], [0.99, 0]], phase) }) })) });
def({ id: "rising-bubbles", name: "Rising bubbles", group: G_WATER, description: "Bubbles streaming up from the bottom.", colors: ["#a5f3fc", "#ffffff"], build: (c) => [make(c, "Bubbles", part(c, { shape: "ring", w: c.stage.w, h: 10, count: cnt(c, 30), life: fit(c, 3.6), speed: 70, angle: -90, spread: 16, size: 14, sizeJitter: 0.7, sizeEnd: 1.4, colors: c.colors, drift: 12, fadeIn: 0.15, fadeOut: 0.35 }), { transform: tf({ y: c.stage.h / 2 }) })] });
def({ id: "ocean-waves", name: "Ocean waves", group: G_WATER, description: "Deep blue swell with a lighter surface.", colors: ["#0ea5e9", "#22d3ee"], build: (c) => [make(c, "Depth", { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: 90, stops: [{ o: 0, c: clear(pick(c, 0)) }, { o: 1, c: `${pick(c, 0)}cc` }] }, { transform: tf({ opacity: 0.8 }) }), make(c, "Swell", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 200, speed: 0.5, color: pick(c, 1), contrast: 0.5, seed: c.seed }, { blend: "screen", transform: tf({ opacity: 0.6 }) })] });
def({ id: "caustics", name: "Caustics", group: G_WATER, description: "Shimmering light patterns, as under water.", colors: ["#67e8f9"], build: (c) => [make(c, "Light A", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 70, speed: 0.6, color: pick(c, 0), contrast: 0.85, seed: c.seed }, { blend: "add", transform: tf({ opacity: 0.45 }) }), make(c, "Light B", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 100, speed: -0.4, color: pick(c, 0), contrast: 0.85, seed: c.seed + 7 }, { blend: "add", transform: tf({ opacity: 0.35 }) })] });

// --- Glitch & tech -----------------------------------------------------------------------------------------------------

def({ id: "scan-sweep", name: "Scan sweep", group: G_TECH, description: "A thin scanning line passing over.", colors: ["#4ade80"], build: (c) => [make(c, "Scan", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: 90, width: 0.06, period: fit(c, 2.6), color: pick(c, 0), seed: c.seed }, { blend: "add", fx: [glow(pick(c, 0), 6, 1.2)] })] });
def({ id: "glitch-flicker", name: "Glitch flicker", group: G_TECH, description: "Bars of magenta and cyan tearing across.", colors: ["#f0abfc", "#22d3ee"], build: (c) => [0, 1, 2].map((i) => make(c, `Bar ${i + 1}`, { type: "solid", w: c.stage.w, h: 5 + i * 5, color: pick(c, i) }, { blend: "add", transform: tf({ y: (i - 1) * c.stage.h * 0.25, x: cycle(c, 2.2 + i * 0.4, [[0, 0], [0.1, 30 - i * 20], [0.14, -22], [0.2, 0]], i / 3), opacity: cycle(c, 2.2 + i * 0.4, [[0, 0, "out"], [0.1, 0.9, "out"], [0.14, 0, "out"], [0.5, 0, "out"], [0.55, 0.7, "out"], [0.58, 0, "out"]], i / 3) }) })) });
def({ id: "digital-rain", name: "Digital rain", group: G_TECH, description: "Green code-like specks pouring down.", colors: ["#4ade80", "#86efac", "#16a34a"], build: (c) => [make(c, "Rain", part(c, { shape: "square", w: c.stage.w, h: 10, count: cnt(c, 90), life: fit(c, 2.2), speed: 260, speedJitter: 0.3, angle: 90, spread: 0, size: 5, sizeEnd: 1, colors: c.colors, fadeIn: 0.05, fadeOut: 0.6 }), { blend: "add", transform: tf({ y: -c.stage.h / 2 }) })] });
def({ id: "pixel-sparks", name: "Pixel sparks", group: G_TECH, description: "Square bits flying out and falling.", colors: ["#f0abfc", "#22d3ee", "#facc15", "#4ade80"], build: (c) => [make(c, "Bits", part(c, { shape: "square", w: 6, h: 6, mode: "burst", count: cnt(c, 40), life: fit(c, 1.2), speed: 180, spread: 360, gravity: 120, size: 6, sizeEnd: 0, colors: c.colors, fadeIn: 0, fadeOut: 0.4 }), { blend: "add" })] });
def({ id: "hologram", name: "Hologram", group: G_TECH, description: "Cyan interference with a scanning shimmer.", colors: ["#22d3ee"], build: (c) => [make(c, "Interference", { type: "noise", w: c.stage.w, h: c.stage.h, scale: 90, speed: 0.7, color: pick(c, 0), contrast: 0.6, seed: c.seed }, { blend: "add", transform: tf({ opacity: 0.35 }) }), make(c, "Scan", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: 90, width: 0.1, period: fit(c, 2.2), color: pick(c, 0), seed: c.seed }, { blend: "add" })] });
def({ id: "neon-frame", name: "Neon frame", group: G_TECH, description: "A glowing neon outline that pulses.", colors: ["#22d3ee"], build: (c) => [make(c, "Frame", { type: "shape", shape: "rect", w: c.stage.w - 14, h: c.stage.h - 14, fill: "#ffffff00", stroke: pick(c, 0), strokeWidth: 4, radius: c.kind === "nameplate" ? 28 : 36, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, 0), 18, 2.2)], transform: tf({ opacity: cycle(c, 2.4, [[0, 0.6], [0.5, 1]]) }) })] });

// --- Colour washes -----------------------------------------------------------------------------------------------------

const wash = (id: string, name: string, description: string, colors: string[], blend: BlendMode = "normal", opacity = 0.4) =>
  def({ id, name, group: G_WASH, description, colors, build: (c) => [make(c, name, { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: cycle(c, 8, [[0, 60], [0.5, 120]]), stops: c.colors.map((col, i, a) => ({ o: a.length === 1 ? 0 : i / (a.length - 1), c: col })).concat(c.colors.length === 1 ? [{ o: 1, c: clear(c.colors[0]) }] : []) }, { blend, transform: tf({ opacity }) })] });
wash("sunset-wash", "Sunset wash", "Rose to amber, slowly turning.", ["#fb7185", "#f59e0b"]);
wash("ocean-wash", "Ocean wash", "Sky blue into indigo.", ["#0ea5e9", "#6366f1"]);
wash("candy-wash", "Candy wash", "Pink, violet and blue.", ["#f472b6", "#a78bfa", "#60a5fa"]);
wash("midnight-wash", "Midnight wash", "Deep indigo into purple.", ["#1e1b4b", "#4c1d95"], "normal", 0.6);
wash("mint-wash", "Mint wash", "Fresh green into aqua.", ["#34d399", "#22d3ee"]);
def({ id: "rose-gold", name: "Rose gold", group: G_WASH, description: "A warm metallic wash with a slow shine.", colors: ["#fda4af", "#fcd34d"], build: (c) => [make(c, "Metal", { type: "gradient", w: c.stage.w, h: c.stage.h, kind: "linear", angle: 45, stops: [{ o: 0, c: pick(c, 0) }, { o: 1, c: pick(c, 1) }] }, { transform: tf({ opacity: 0.4 }) }), make(c, "Shine", { type: "shimmer", w: c.stage.w, h: c.stage.h, angle: 25, width: 0.2, period: fit(c, 3.4), color: "#ffffff", seed: c.seed }, { blend: "add" })] });
def({ id: "breathing-glow", name: "Breathing glow", group: G_WASH, description: "A whole-area colour that swells and fades.", colors: ["#a78bfa"], build: (c) => [make(c, "Glow", { type: "solid", w: c.stage.w, h: c.stage.h, color: pick(c, 0) }, { blend: "screen", transform: tf({ opacity: cycle(c, 3.2, [[0, 0.04], [0.5, 0.4]]) }) })] });

// --- Moving shapes -----------------------------------------------------------------------------------------------------

def({ id: "spinning-stars", name: "Spinning stars", group: G_SHAPES, description: "Three glowing stars turning and pulsing.", colors: ["#fde047", "#f9a8d4", "#a5f3fc"], build: (c) => [-1, 0, 1].map((p, i) => make(c, `Star ${i + 1}`, { type: "shape", shape: "star", w: 46 - Math.abs(p) * 8, h: 46 - Math.abs(p) * 8, fill: pick(c, i), stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5, inner: 0.45 }, { blend: "add", fx: [glow(pick(c, i), 10, 1.4)], transform: tf({ x: p * Math.min(c.stage.w * 0.28, 150), y: p === 0 ? 0 : -p * Math.min(c.stage.h * 0.12, 40), rotation: spin(c, i % 2 ? -1 : 1), scaleX: cycle(c, 1.6, [[0, 0.8], [0.5, 1.15]], i / 3), scaleY: cycle(c, 1.6, [[0, 0.8], [0.5, 1.15]], i / 3) }) })) });
def({ id: "bouncing-dots", name: "Bouncing dots", group: G_SHAPES, description: "Three dots bouncing in turn.", colors: ["#f472b6", "#fbbf24", "#38bdf8"], build: (c) => [-1, 0, 1].map((p, i) => make(c, `Dot ${i + 1}`, { type: "shape", shape: "ellipse", w: 22, h: 22, fill: pick(c, i), stroke: "#ffffff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 }, { transform: tf({ x: p * 44, y: cycle(c, 1.2, [[0, 0, "out"], [0.25, -34, "in"], [0.5, 0, "out"]], i / 4) }) })) });
def({ id: "ticker-line", name: "Ticker line", group: G_SHAPES, description: "A bright line gliding across.", colors: ["#ffffff"], build: (c) => [make(c, "Line", { type: "shape", shape: "line", w: c.stage.w * 0.35, h: 6, fill: pick(c, 0), stroke: pick(c, 0), strokeWidth: 6, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, 0), 10, 1.4)], transform: tf({ y: c.kind === "nameplate" ? c.stage.h * 0.3 : c.stage.h * 0.35, x: cycle(c, c.idle, [[0, -c.stage.w * 0.7, "linear"], [0.999, c.stage.w * 0.7, "linear"]]), opacity: cycle(c, c.idle, [[0, 0, "linear"], [0.2, 1, "linear"], [0.8, 1, "linear"], [0.999, 0, "linear"]]) }) })] });
def({ id: "spotlight-sweep", name: "Spotlight sweep", group: G_SHAPES, description: "A pool of light sweeping from side to side.", colors: ["#fef3c7"], build: (c) => [make(c, "Spot", { type: "gradient", w: Math.min(c.stage.w, c.stage.h) * 1.1, h: Math.min(c.stage.w, c.stage.h) * 1.1, kind: "radial", angle: 0, stops: [{ o: 0, c: `${pick(c, 0)}cc` }, { o: 1, c: clear(pick(c, 0)) }] }, { blend: "add", transform: tf({ x: cycle(c, 4, [[0, -c.stage.w * 0.35], [0.5, c.stage.w * 0.35]]) }) })] });
def({ id: "breathing-ring", name: "Breathing ring", group: G_SHAPES, description: "A ring that slowly swells and settles.", colors: ["#c4b5fd"], build: (c) => [make(c, "Ring", { type: "shape", shape: "ring", w: Math.min(c.stage.w, c.stage.h) * 0.7, h: Math.min(c.stage.w, c.stage.h) * 0.7, fill: "#ffffff00", stroke: pick(c, 0), strokeWidth: 5, radius: 0, points: 5, inner: 0.5 }, { blend: "add", fx: [glow(pick(c, 0), 14, 1.4)], transform: tf({ scaleX: cycle(c, 3, [[0, 0.9], [0.5, 1.08]]), scaleY: cycle(c, 3, [[0, 0.9], [0.5, 1.08]]), opacity: cycle(c, 3, [[0, 0.5], [0.5, 1]]) }) })] });

// --- Using the library --------------------------------------------------------------------------------------------------

/** Every effect, in the order they are shown. */
export const EFFECT_LIBRARY: readonly EffectDef[] = defs;

export const effectById = (id: string): EffectDef | undefined => defs.find((d) => d.id === id);
export const EFFECT_GROUPS: readonly string[] = [...new Set(defs.map((d) => d.group))];

/** The length of an intro for a design this long: what was asked for, a third of the design at most, and none if that
 * would be too short to see. */
export function introFor(duration: number, asked: number): number {
  const I = Math.min(Math.max(0, asked), duration / 3);
  return I < 0.4 ? 0 : r3(I);
}

/**
 * The clips for an effect on a design of the given kind: its own colours unless `colors` is given.
 *
 * `intro` is how long the design's intro is — the part before it loops (`loop.from`). Left out, the effect brings its own;
 * pass the design's if it already has one, so that what is added loops on the same beat as what is there.
 */
export function buildEffect(def: EffectDef, o: EffectOptions): Clip[] {
  if (!def.kinds.includes(o.kind)) throw new Error(`${def.name} isn't for a ${o.kind}.`);
  const colors = (o.colors?.length ? o.colors : def.colors).slice(0, 6);
  const duration = r3(Math.min(MOTION_LIMITS.duration, Math.max(0.5, o.duration ?? DEFAULT_LENGTH)));
  const intro = introFor(duration, o.intro ?? def.intro ?? 0);
  const clips = def.build({ kind: o.kind, stage: { ...MOTION_STAGES[o.kind] }, duration, intro, idle: r3(duration - intro), colors, seed: Math.round(o.seed ?? 1), k: Math.min(3, Math.max(0.2, o.intensity ?? 1)) });
  // One lane per layer, bottom first, so the structure shows in a timeline and drawing order can't be a surprise.
  return clips.map((clip, i) => ({ ...clip, track: Math.min(31, i), ...(o.idPrefix ? { id: `${o.idPrefix}-${i + 1}` } : {}) }));
}

/** What is published about each effect: enough to list and describe it, and to know how to fetch it. */
export interface EffectCatalogEntry {
  id: string;
  name: string;
  group: string;
  description: string;
  kinds: MotionKind[];
  colors: string[];
  clips: number;
}

/** 2: effects are layered scenes with an intro, and a published file says how long it is. Version 1's folder is left where
 * it is on the CDN for apps that predate it, which read it as they always did. */
export const LIBRARY_VERSION = 2;
/** Where, under the CDN's address, the published library is. */
export const LIBRARY_FOLDER = `studio-library/effects/v${LIBRARY_VERSION}`;

export function catalogOf(lib: readonly EffectDef[] = defs): { version: number; effects: EffectCatalogEntry[] } {
  return {
    version: LIBRARY_VERSION,
    effects: lib.map((d) => ({ id: d.id, name: d.name, group: d.group, description: d.description, kinds: d.kinds, colors: d.colors, clips: buildEffect(d, { kind: d.kinds[0] }).length })),
  };
}

/** One published effect: its clips for each kind of design it fits, built with its own colours and the default length. */
export interface PublishedEffect extends EffectCatalogEntry {
  duration: number;
  /** Seconds before the loop: set a design's `loop.from` to this when adding the effect to one with no intro of its own. */
  intro: number;
  variants: Partial<Record<MotionKind, Clip[]>>;
}

export function publishedEffect(d: EffectDef): PublishedEffect {
  const variants: Partial<Record<MotionKind, Clip[]>> = {};
  for (const kind of d.kinds) variants[kind] = buildEffect(d, { kind, duration: DEFAULT_LENGTH, idPrefix: `${d.id}-${kind}` });
  return { id: d.id, name: d.name, group: d.group, description: d.description, kinds: d.kinds, colors: d.colors, clips: variants[d.kinds[0]]!.length, duration: DEFAULT_LENGTH, intro: introFor(DEFAULT_LENGTH, d.intro ?? 0), variants };
}
