/**
 * Motion: animated profile effects and nameplates, as data.
 *
 * A motion design is a timeline of clips on tracks — pictures drawn in Crystal Studio's canvas editor,
 * generators (shapes, gradients, particles, shimmer…), titles and nested "compound" timelines — each with
 * keyframed transform, effects, blend mode, mask, retime and transitions. The app plays it live on a
 * canvas, so it is crisp at any size and a few kilobytes instead of a video.
 *
 * Pure — no Convex imports, no DOM — because the same rules run in three places: the server checks and
 * normalises a submission (and is the authority), Studio edits and previews with the same functions, and
 * the app samples a frame from them to draw. Nothing in a spec is code or a CSS declaration; colours are hex,
 * enums are matched against lists, numbers are clamped, and every address goes through the caller's
 * `assertUrl`.
 *
 * Time is in seconds. A frame is a pure function of the spec and the time `t`: particles are closed-form
 * (no simulation state), so scrubbing, seeking and looping give exactly the same picture every time.
 */

// --- Limits -----------------------------------------------------------------------------------

export const MOTION_LIMITS = {
  /** Longest a design may run, seconds. */
  duration: 12,
  /** Clips in the whole design, nested ones included. */
  clips: 96,
  /** Nesting depth of compound clips. */
  depth: 3,
  /** Keyframes on one property. */
  keys: 64,
  /** Distinct pictures. */
  images: 24,
  /** Effects on one clip. */
  fx: 6,
  /** Particles alive at once, per emitter. */
  particles: 400,
  text: 40,
  name: 60,
  /** Stage size bounds, in stage units. */
  stageMin: 16,
  stageMax: 2400,
} as const;

/** What a design is made for, and the stage (its own coordinate space) it is authored on. */
export const MOTION_STAGES = {
  /** Full over a profile card, covering it the way a picture with `object-fit: cover` would. */
  effect: { w: 600, h: 700 },
  /** A strip behind a name; faded towards the text and drawn faintly by the app. */
  nameplate: { w: 960, h: 176 },
} as const;
export type MotionKind = keyof typeof MOTION_STAGES;

export const MOTION_IMAGE_EXTENSIONS = ["png", "webp", "jpg", "jpeg", "gif"] as const;

// --- Types ------------------------------------------------------------------------------------

export type EasePreset = "linear" | "hold" | "in" | "out" | "inOut" | "sine" | "expo" | "back" | "bounce" | "elastic";
/** A preset by name, or a CSS-style cubic Bézier `[x1, y1, x2, y2]`. */
export type Ease = EasePreset | [number, number, number, number];
export const EASE_PRESETS: EasePreset[] = ["linear", "hold", "in", "out", "inOut", "sine", "expo", "back", "bounce", "elastic"];

/** One keyframe. `e` is how it eases *out* of this key towards the next. */
export interface Key<V> {
  t: number;
  v: V;
  e: Ease;
}
/** A property: a constant, or keyframes in clip time (seconds from the clip's start). */
export type Prop = number | { k: Key<number>[] };
export type ColorProp = string | { k: Key<string>[] };

export type BlendMode = "normal" | "add" | "multiply" | "screen" | "overlay" | "softLight" | "hardLight" | "colorDodge" | "difference" | "lighten" | "darken";
export const BLEND_MODES: BlendMode[] = ["normal", "add", "multiply", "screen", "overlay", "softLight", "hardLight", "colorDodge", "difference", "lighten", "darken"];

export type TextAnim = "none" | "fade" | "typewriter" | "slideUp" | "pop" | "wave" | "bounce" | "shimmer";
export const TEXT_ANIMS: TextAnim[] = ["none", "fade", "typewriter", "slideUp", "pop", "wave", "bounce", "shimmer"];

export type ShapeKind = "rect" | "ellipse" | "star" | "heart" | "ring" | "line" | "triangle";
export const SHAPE_KINDS: ShapeKind[] = ["rect", "ellipse", "star", "heart", "ring", "line", "triangle"];

export type ParticleShape = "dot" | "star" | "heart" | "spark" | "square" | "ring";
export const PARTICLE_SHAPES: ParticleShape[] = ["dot", "star", "heart", "spark", "square", "ring"];

export interface Particles {
  /** The emitter's box: particles are born anywhere inside it (centred on the clip's position). */
  w: number;
  h: number;
  /** Alive at once (steady state). */
  count: number;
  /** Seconds each lives. */
  life: number;
  /** `continuous` keeps emitting; `burst` fires everything at the start, then repeats every `life` seconds if the clip is longer. */
  mode: "continuous" | "burst";
  shape: ParticleShape;
  /** Pixels per second, and a spread of directions in degrees about `angle` (0 = right, 90 = down). */
  speed: number;
  speedJitter: number;
  angle: number;
  spread: number;
  /** Pixels per second²; positive pulls down. */
  gravity: number;
  size: number;
  sizeJitter: number;
  /** Size multiplier at the end of life (1 = unchanged, 0 = shrinks away). */
  sizeEnd: number;
  spin: number;
  colors: string[];
  /** Fraction of life spent fading in, and fading out. */
  fadeIn: number;
  fadeOut: number;
  seed: number;
  /** Wobble sideways like a drifting flake, pixels. */
  drift: number;
}

export type Source =
  /** A picture. `ox`,`oy` place its centre relative to the stage's centre (before the clip's own transform), so a picture drawn in the canvas editor rests where it was drawn. */
  | { type: "image"; url: string; w: number; h: number; ox: number; oy: number }
  /** Crystal Studio only: a layer of the canvas editor's artwork, drawn live. Becomes an `image` when a design is published; never valid in a published design. */
  | { type: "layer"; nodeId: string; w: number; h: number; ox: number; oy: number }
  | { type: "shape"; shape: ShapeKind; w: number; h: number; fill: ColorProp; stroke: ColorProp; strokeWidth: number; radius: number; points: number; inner: number }
  | { type: "text"; text: string; size: number; weight: number; italic: boolean; color: ColorProp; stroke: string; strokeWidth: number; anim: TextAnim; stagger: number; align: "left" | "center" | "right" }
  | { type: "solid"; w: number; h: number; color: ColorProp }
  | { type: "gradient"; w: number; h: number; kind: "linear" | "radial"; angle: Prop; stops: { o: number; c: ColorProp }[] }
  | { type: "noise"; w: number; h: number; scale: number; speed: number; color: ColorProp; contrast: number; seed: number }
  | { type: "shimmer"; w: number; h: number; angle: number; width: number; period: number; color: string; seed: number }
  | { type: "rays"; r: number; count: number; color: ColorProp; spin: number; softness: number }
  | ({ type: "particles" } & Particles)
  | { type: "compound"; duration: number; clips: Clip[] }
  /** An adjustment layer: has no picture of its own; its effects, blend and opacity apply to everything below it. */
  | { type: "adjust" };
export type SourceType = Source["type"];

export type ClipFx =
  | { type: "blur"; amount: Prop }
  | { type: "glow"; color: ColorProp; blur: Prop; strength: Prop }
  | { type: "shadow"; color: ColorProp; x: Prop; y: Prop; blur: Prop; opacity: Prop }
  | { type: "adjust"; hue: Prop; saturation: Prop; brightness: Prop; contrast: Prop }
  | { type: "tint"; color: ColorProp; amount: Prop };
export type ClipFxType = ClipFx["type"];

export type TransitionKind = "fade" | "slide" | "zoom" | "pop" | "blur" | "wipe" | "flash" | "spin";
export const TRANSITION_KINDS: TransitionKind[] = ["fade", "slide", "zoom", "pop", "blur", "wipe", "flash", "spin"];
export type Dir = "left" | "right" | "up" | "down";
export const DIRS: Dir[] = ["left", "right", "up", "down"];
export interface Transition {
  type: TransitionKind;
  /** Seconds. */
  d: number;
  dir: Dir;
  e: Ease;
}

export interface Mask {
  shape: "rect" | "ellipse";
  /** Centre and size in stage units, relative to the clip's pivot (its centre unless moved), before the clip's own transform. */
  x: Prop;
  y: Prop;
  w: Prop;
  h: Prop;
  feather: number;
  invert: boolean;
}

export interface Transform {
  x: Prop;
  y: Prop;
  scaleX: Prop;
  scaleY: Prop;
  rotation: Prop;
  opacity: Prop;
  /** The point it turns and scales about, as a fraction of the clip's own box (0.5 is the centre). */
  anchorX: number;
  anchorY: number;
}

export interface Clip {
  id: string;
  name: string;
  /** Stacking lane: a higher track is drawn over a lower one. */
  track: number;
  /** Where it starts on the design's timeline, and how long it plays there. */
  start: number;
  duration: number;
  /** Where in its source it begins (a compound clip or a generator's own clock), seconds. */
  in: number;
  /** Playback speed: a constant, or keyframes in clip time for a speed ramp. 1 is normal. */
  speed: Prop;
  reverse: boolean;
  /** Repeat the source if the clip is longer than it; otherwise it holds its last moment. */
  loop: boolean;
  source: Source;
  transform: Transform;
  blend: BlendMode;
  fx: ClipFx[];
  mask?: Mask;
  transitionIn?: Transition;
  transitionOut?: Transition;
  /** Switched off clips are skipped. */
  on: boolean;
}

export interface MotionSpec {
  v: 1;
  kind: MotionKind;
  name: string;
  stage: { w: number; h: number };
  duration: number;
  /** `loop` plays again at once; `once` plays through and then rests `rest` seconds on the last frame before playing again. */
  loop: { mode: "loop" | "once"; rest: number };
  clips: Clip[];
}

/** Whether an address is a published motion design (see convex/motion.ts): a content-hashed `.json` file. */
export const isMotionUrl = (url: string | null | undefined): boolean => !!url && /\/[0-9a-f]{64}\.json(\?.*)?$/.test(url);

// --- Small helpers ----------------------------------------------------------------------------

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function num(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}
function oneOf<T extends string>(value: unknown, list: readonly T[], fallback: T): T {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : fallback;
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` to lowercase `#rrggbb` / `#rrggbbaa`; anything else is the fallback. */
export function cleanColor(value: unknown, fallback = "#ffffff"): string {
  if (typeof value !== "string") return fallback;
  const s = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) return `#${[...m[1]].map((c) => c + c).join("")}`;
  m = /^#([0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  return m ? `#${m[1]}` : fallback;
}

// --- Easing -----------------------------------------------------------------------------------

const bounceOut = (t: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
};

/** A CSS cubic-bezier(x1,y1,x2,y2) evaluated at progress `x`, by Newton's method with a bisection fallback. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - x;
    if (Math.abs(err) < 1e-6) return sy(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 40; i++) {
    const v = sx(t);
    if (Math.abs(v - x) < 1e-6) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sy(t);
}

/** Eased progress for linear progress `p` in [0,1]. `hold` jumps at the end of the segment. */
export function ease(e: Ease, p: number): number {
  const t = clamp(p, 0, 1);
  if (Array.isArray(e)) return cubicBezier(clamp(e[0], 0, 1), e[1], clamp(e[2], 0, 1), e[3], t);
  switch (e) {
    case "hold":
      return t >= 1 ? 1 : 0;
    case "in":
      return t * t * t;
    case "out":
      return 1 - (1 - t) ** 3;
    case "inOut":
      return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    case "sine":
      return -(Math.cos(Math.PI * t) - 1) / 2;
    case "expo":
      return t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
    case "back": {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    }
    case "bounce":
      return bounceOut(t);
    case "elastic":
      return t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;
    default:
      return t;
  }
}

// --- Keyframes --------------------------------------------------------------------------------

/** The value of a property at clip time `t`. Before the first key it is the first value, after the last the last. */
export function evalProp(p: Prop, t: number): number {
  if (typeof p === "number") return p;
  const k = p.k;
  if (k.length === 0) return 0;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[i + 1];
  const span = b.t - a.t || 1;
  return lerp(a.v, b.v, ease(a.e, (t - a.t) / span));
}

type RGBA = [number, number, number, number];
export function parseHex(c: string): RGBA {
  const s = cleanColor(c, "#ffffff");
  return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), s.length === 9 ? parseInt(s.slice(7, 9), 16) / 255 : 1];
}
/** The `rgba(r,g,b,a)` strings `evalColor` makes, back to channels; a hex colour is read as hex. Anything else is opaque white. */
export function parseRgba(css: string): RGBA {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(css);
  return m ? [+m[1], +m[2], +m[3], Math.min(1, Math.max(0, parseFloat(m[4])))] : parseHex(css);
}
export const rgbaString = ([r, g, b, a]: RGBA) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;

/** A colour property at clip time `t`, as `rgba(…)`. Colours blend channel by channel between keys. */
export function evalColor(p: ColorProp, t: number): string {
  if (typeof p === "string") return rgbaString(parseHex(p));
  const k = p.k;
  if (k.length === 0) return "rgba(255,255,255,1)";
  if (t <= k[0].t) return rgbaString(parseHex(k[0].v));
  const last = k[k.length - 1];
  if (t >= last.t) return rgbaString(parseHex(last.v));
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const a = k[i];
  const b = k[i + 1];
  const u = ease(a.e, (t - a.t) / (b.t - a.t || 1));
  const x = parseHex(a.v);
  const y = parseHex(b.v);
  return rgbaString([lerp(x[0], y[0], u), lerp(x[1], y[1], u), lerp(x[2], y[2], u), lerp(x[3], y[3], u)]);
}

/** Keys of a property, or none if it is a constant. */
export const keysOf = (p: Prop | ColorProp): Key<number | string>[] => (typeof p === "object" ? (p.k as Key<number | string>[]) : []);
export const isAnimated = (p: Prop | ColorProp) => typeof p === "object" && p.k.length > 0;

// --- Retime -----------------------------------------------------------------------------------

const speedAt = (p: Prop, t: number) => clamp(evalProp(p, t), 0.05, 16);

/**
 * Distance travelled through the source after `t` seconds of clip time: the integral of the speed. A constant
 * speed is `speed·t`; keyframed speeds are linear between keys (a ramp), integrated exactly segment by segment.
 */
export function sourceElapsed(speed: Prop, t: number): number {
  if (t <= 0) return 0;
  if (typeof speed === "number") return clamp(speed, 0.05, 16) * t;
  const k = speed.k;
  if (k.length === 0) return t;
  let total = 0;
  // Before the first key the speed is the first key's; between keys it ramps; after the last it holds.
  const pts: { t: number; s: number }[] = [{ t: 0, s: speedAt(speed, 0) }];
  for (const key of k) if (key.t > 0 && key.t < t) pts.push({ t: key.t, s: speedAt(speed, key.t) });
  pts.push({ t, s: speedAt(speed, t) });
  for (let i = 0; i < pts.length - 1; i++) {
    const dt = pts[i + 1].t - pts[i].t;
    total += ((pts[i].s + pts[i + 1].s) / 2) * dt;
  }
  return total;
}

/** Where a source's centre rests relative to the stage's centre, before the clip's own transform. */
export const restOffset = (s: Source): { x: number; y: number } => (s.type === "image" || s.type === "layer" ? { x: s.ox, y: s.oy } : { x: 0, y: 0 });

/** How long a source runs, if it has a length of its own (a compound clip); generators and pictures run for ever. */
export const sourceLength = (s: Source): number => (s.type === "compound" ? s.duration : Infinity);

/** Where in its source a clip is, at timeline time `t`: after speed ramps, reverse, the in-point and looping. */
export function sourceTime(clip: Clip, t: number): number {
  const local = clamp(t - clip.start, 0, clip.duration);
  const through = clip.reverse ? sourceElapsed(clip.speed, clip.duration) - sourceElapsed(clip.speed, local) : sourceElapsed(clip.speed, local);
  let s = clip.in + through;
  const len = sourceLength(clip.source);
  if (Number.isFinite(len) && len > 0) s = clip.loop ? ((s % len) + len) % len : clamp(s, 0, len);
  return s;
}

// --- Transitions ------------------------------------------------------------------------------

const DIR_VEC: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export interface TransitionState {
  opacity: number;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  blur: number;
  /** Brightness added: 0 is none. */
  flash: number;
  /** A wipe: the share revealed (1 = all) from the edge the direction comes from. */
  wipe?: { dir: Dir; p: number };
}

export const NO_TRANSITION: TransitionState = { opacity: 1, dx: 0, dy: 0, scale: 1, rotation: 0, blur: 0, flash: 0 };

/** How a transition changes a clip at progress `p` (0 = hidden, 1 = fully shown), on a stage of `stage` size. */
export function applyTransition(tr: Transition, p: number, stage: { w: number; h: number }): TransitionState {
  const e = ease(tr.e, p);
  const s: TransitionState = { ...NO_TRANSITION };
  const [vx, vy] = DIR_VEC[tr.dir];
  switch (tr.type) {
    case "fade":
      s.opacity = e;
      break;
    case "slide":
      // Comes in from the `dir` side: starts one stage-width away that way.
      s.dx = vx * (1 - e) * stage.w;
      s.dy = vy * (1 - e) * stage.h;
      s.opacity = Math.min(1, e * 3);
      break;
    case "zoom":
      s.scale = lerp(0.2, 1, e);
      s.opacity = e;
      break;
    case "pop": {
      s.scale = Math.max(0, ease("back", p));
      s.opacity = Math.min(1, p * 4);
      break;
    }
    case "blur":
      s.blur = (1 - e) * 24;
      s.opacity = e;
      break;
    case "wipe":
      s.wipe = { dir: tr.dir, p: e };
      break;
    case "flash":
      s.flash = (1 - e) * 2.5;
      s.opacity = Math.min(1, e * 2);
      break;
    case "spin":
      s.rotation = (1 - e) * 180;
      s.scale = e;
      s.opacity = e;
      break;
  }
  return s;
}

/** A clip's in and out transitions at timeline time `t`, combined. */
export function transitionState(clip: Clip, t: number, stage: { w: number; h: number }): TransitionState {
  const local = t - clip.start;
  let s: TransitionState = { ...NO_TRANSITION };
  const merge = (n: TransitionState) => {
    s = {
      opacity: s.opacity * n.opacity,
      dx: s.dx + n.dx,
      dy: s.dy + n.dy,
      scale: s.scale * n.scale,
      rotation: s.rotation + n.rotation,
      blur: s.blur + n.blur,
      flash: s.flash + n.flash,
      wipe: n.wipe ?? s.wipe,
    };
  };
  const tin = clip.transitionIn;
  if (tin && tin.d > 0 && local < tin.d) merge(applyTransition(tin, clamp(local / tin.d, 0, 1), stage));
  const tout = clip.transitionOut;
  if (tout && tout.d > 0 && clip.duration - local < tout.d) merge(applyTransition(tout, clamp((clip.duration - local) / tout.d, 0, 1), stage));
  return s;
}

// --- Sampling one clip ------------------------------------------------------------------------

export type ResolvedFx =
  | { type: "blur"; amount: number }
  | { type: "glow"; color: string; blur: number; strength: number }
  | { type: "shadow"; color: string; x: number; y: number; blur: number; opacity: number }
  | { type: "adjust"; hue: number; saturation: number; brightness: number; contrast: number }
  | { type: "tint"; color: string; amount: number };

export interface ResolvedMask {
  shape: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  feather: number;
  invert: boolean;
}

/** Everything about a clip at one moment, with every keyframe evaluated: what the renderer draws. */
export interface Resolved {
  clip: Clip;
  /** Seconds from the clip's start. */
  local: number;
  /** Where in its source (see `sourceTime`). */
  src: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  rotation: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  blend: BlendMode;
  fx: ResolvedFx[];
  mask?: ResolvedMask;
  transition: TransitionState;
}

const fxResolve = (fx: ClipFx, t: number): ResolvedFx => {
  switch (fx.type) {
    case "blur":
      return { type: "blur", amount: Math.max(0, evalProp(fx.amount, t)) };
    case "glow":
      return { type: "glow", color: evalColor(fx.color, t), blur: Math.max(0, evalProp(fx.blur, t)), strength: clamp(evalProp(fx.strength, t), 0, 6) };
    case "shadow":
      return { type: "shadow", color: evalColor(fx.color, t), x: evalProp(fx.x, t), y: evalProp(fx.y, t), blur: Math.max(0, evalProp(fx.blur, t)), opacity: clamp(evalProp(fx.opacity, t), 0, 1) };
    case "adjust":
      return { type: "adjust", hue: evalProp(fx.hue, t), saturation: clamp(evalProp(fx.saturation, t), 0, 4), brightness: clamp(evalProp(fx.brightness, t), 0, 4), contrast: clamp(evalProp(fx.contrast, t), 0, 4) };
    case "tint":
      return { type: "tint", color: evalColor(fx.color, t), amount: clamp(evalProp(fx.amount, t), 0, 1) };
  }
};

/** The clip at timeline time `t`, or null if it is off or not on screen then. A clip is on for [start, start+duration). */
export function sampleClip(clip: Clip, t: number, stage: { w: number; h: number }): Resolved | null {
  if (!clip.on) return null;
  const local = t - clip.start;
  if (local < 0 || local >= clip.duration) return null;
  const tf = clip.transform;
  const tr = transitionState(clip, t, stage);
  const m = clip.mask;
  return {
    clip,
    local,
    src: sourceTime(clip, t),
    x: evalProp(tf.x, local) + tr.dx,
    y: evalProp(tf.y, local) + tr.dy,
    sx: evalProp(tf.scaleX, local) * tr.scale,
    sy: evalProp(tf.scaleY, local) * tr.scale,
    rotation: evalProp(tf.rotation, local) + tr.rotation,
    opacity: clamp(evalProp(tf.opacity, local), 0, 1) * clamp(tr.opacity, 0, 1),
    anchorX: tf.anchorX,
    anchorY: tf.anchorY,
    blend: clip.blend,
    fx: clip.fx.map((f) => fxResolve(f, local)),
    mask: m ? { shape: m.shape, x: evalProp(m.x, local), y: evalProp(m.y, local), w: Math.max(0, evalProp(m.w, local)), h: Math.max(0, evalProp(m.h, local)), feather: m.feather, invert: m.invert } : undefined,
    transition: tr,
  };
}

/** The clips on screen at `t`, bottom first (lower tracks, then earlier starts). */
export function sampleClips(clips: Clip[], t: number, stage: { w: number; h: number }): Resolved[] {
  return clips
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.track - b.c.track || a.c.start - b.c.start || a.i - b.i)
    .map(({ c }) => sampleClip(c, t, stage))
    .filter((r): r is Resolved => r !== null);
}

/**
 * The time to sample a design at, for wall-clock time `elapsed` since it started playing: loops, or plays once and
 * rests on the last frame for `rest` seconds before playing again.
 */
export function playbackTime(spec: Pick<MotionSpec, "duration" | "loop">, elapsed: number): number {
  const d = Math.max(0.001, spec.duration);
  if (spec.loop.mode === "loop") return elapsed < 0 ? 0 : elapsed % d;
  const cycle = d + Math.max(0, spec.loop.rest);
  const x = elapsed < 0 ? 0 : elapsed % cycle;
  // Held on the last frame, which is just before the end so that clips ending there are still drawn.
  return Math.min(x, d - 1e-4);
}

// --- Particles --------------------------------------------------------------------------------

const hash = (i: number, seed: number) => {
  let h = (Math.imul(i, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

export interface Particle {
  /** Relative to the emitter's centre. */
  x: number;
  y: number;
  size: number;
  alpha: number;
  rotation: number;
  color: string;
  shape: ParticleShape;
}

/**
 * Every particle alive at emitter time `t`, as a closed-form function of time: particle `i` is born at a fixed
 * point in a repeating cycle, so nothing is simulated and any `t` — scrubbed to, looped to — gives the same picture.
 */
export function particlesAt(p: Particles, t: number): Particle[] {
  const out: Particle[] = [];
  const n = clamp(Math.round(p.count), 0, MOTION_LIMITS.particles);
  const life = Math.max(0.05, p.life);
  if (n === 0 || t < 0) return out;
  const colors = p.colors.length ? p.colors : ["#ffffff"];
  for (let i = 0; i < n; i++) {
    const r = (k: number) => hash(i * 13 + k, p.seed);
    // Continuous: births are spread evenly across a life, so there are always ~n alive. Burst: all at once.
    const offset = p.mode === "burst" ? r(1) * 0.08 * life : (i / n) * life;
    const age = (((t - offset) % life) + life) % life;
    const cycle = Math.floor((t - offset) / life);
    // A burst waits for its moment of birth. A continuous emitter has been running since before the clip began,
    // so it is already in steady state at t=0 and a looping design has no empty first second.
    if (p.mode === "burst" && t < offset) continue;
    const u = age / life;
    const q = (k: number) => hash(i * 13 + k + cycle * 7919, p.seed);
    const dir = ((p.angle + (q(2) - 0.5) * p.spread) * Math.PI) / 180;
    const speed = p.speed * (1 + (q(3) - 0.5) * 2 * p.speedJitter);
    const bx = (q(4) - 0.5) * p.w;
    const by = (q(5) - 0.5) * p.h;
    const sideways = p.drift ? Math.sin(age * 3 + q(6) * 6.283) * p.drift : 0;
    const x = bx + Math.cos(dir) * speed * age + sideways;
    const y = by + Math.sin(dir) * speed * age + 0.5 * p.gravity * age * age;
    const base = p.size * (1 + (q(7) - 0.5) * 2 * p.sizeJitter);
    const size = Math.max(0, base * lerp(1, p.sizeEnd, u));
    const fin = p.fadeIn > 0 ? clamp(u / p.fadeIn, 0, 1) : 1;
    const fout = p.fadeOut > 0 ? clamp((1 - u) / p.fadeOut, 0, 1) : 1;
    out.push({
      x,
      y,
      size,
      alpha: fin * fout,
      rotation: (q(8) * 360 + p.spin * age) % 360,
      color: colors[Math.floor(q(9) * colors.length) % colors.length],
      shape: p.shape,
    });
  }
  return out;
}

// --- Noise ------------------------------------------------------------------------------------

const fade = (t: number) => t * t * (3 - 2 * t);
const lat = (ix: number, iy: number, seed: number) => hash((Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0, seed);

/** Smooth value noise in [0,1). */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  return lerp(lerp(lat(ix, iy, seed), lat(ix + 1, iy, seed), fx), lerp(lat(ix, iy + 1, seed), lat(ix + 1, iy + 1, seed), fx), fy);
}

/** Layered noise in [0,1): detail at several sizes, like clouds or smoke. */
export function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 131);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

// --- Text -------------------------------------------------------------------------------------

export interface CharState {
  ch: string;
  alpha: number;
  dx: number;
  dy: number;
  scale: number;
}

/** Each character of a title at clip time `t` under its animation preset: staggered by `stagger` seconds per character. */
export function textChars(s: Extract<Source, { type: "text" }>, t: number): CharState[] {
  const chars = [...s.text];
  const dur = 0.35;
  return chars.map((ch, i) => {
    const local = t - i * s.stagger;
    const p = clamp(local / dur, 0, 1);
    const st: CharState = { ch, alpha: 1, dx: 0, dy: 0, scale: 1 };
    switch (s.anim) {
      case "fade":
        st.alpha = ease("out", p);
        break;
      case "typewriter":
        st.alpha = local >= 0 ? 1 : 0;
        break;
      case "slideUp":
        st.alpha = ease("out", p);
        st.dy = (1 - ease("out", p)) * s.size * 0.8;
        break;
      case "pop":
        st.scale = Math.max(0, ease("back", p));
        st.alpha = Math.min(1, p * 4);
        break;
      case "wave":
        st.dy = Math.sin(t * 5 - i * 0.6) * s.size * 0.18;
        break;
      case "bounce": {
        const b = ((t * 1.6 - i * s.stagger * 2) % 1 + 1) % 1;
        st.dy = -Math.abs(Math.sin(b * Math.PI)) * s.size * 0.35;
        break;
      }
      case "shimmer":
        st.alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 4 - i * 0.7));
        break;
    }
    return st;
  });
}

// --- Defaults and constructors ----------------------------------------------------------------

export const defaultTransform = (): Transform => ({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, anchorX: 0.5, anchorY: 0.5 });

let counter = 0;
export const newMotionId = (prefix = "c") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function newClip(source: Source, o: Partial<Omit<Clip, "source">> = {}): Clip {
  return {
    id: o.id ?? newMotionId(),
    name: o.name ?? "Clip",
    track: o.track ?? 0,
    start: o.start ?? 0,
    duration: o.duration ?? 2,
    in: o.in ?? 0,
    speed: o.speed ?? 1,
    reverse: o.reverse ?? false,
    loop: o.loop ?? true,
    source,
    transform: o.transform ?? defaultTransform(),
    blend: o.blend ?? "normal",
    fx: o.fx ?? [],
    mask: o.mask,
    transitionIn: o.transitionIn,
    transitionOut: o.transitionOut,
    on: o.on ?? true,
  };
}

export const emptyMotion = (kind: MotionKind, name = "Untitled"): MotionSpec => ({
  v: 1,
  kind,
  name,
  stage: { ...MOTION_STAGES[kind] },
  duration: 4,
  loop: { mode: "loop", rest: 0 },
  clips: [],
});

export const defaultParticles = (): Particles => ({
  w: 200, h: 200, count: 40, life: 2, mode: "continuous", shape: "dot", speed: 40, speedJitter: 0.4, angle: -90, spread: 90, gravity: 0,
  size: 6, sizeJitter: 0.4, sizeEnd: 0.2, spin: 0, colors: ["#ffffff"], fadeIn: 0.15, fadeOut: 0.5, seed: 1, drift: 0,
});

/** Where the design's own length is decided: the end of its last clip. */
export const contentEnd = (clips: Clip[]) => clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);

// --- Validation -------------------------------------------------------------------------------

export type UrlCheck = (url: string, role: string) => string;

function extensionOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  return (path.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
}

function easeOf(v: unknown): Ease {
  if (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n))) return [clamp(v[0], 0, 1), clamp(v[1], -2, 3), clamp(v[2], 0, 1), clamp(v[3], -2, 3)];
  return oneOf(v, EASE_PRESETS, "linear");
}

function propOf(v: unknown, min: number, max: number, fallback: number, duration: number): Prop {
  if (typeof v === "number") return num(v, min, max, fallback);
  if (isObj(v) && Array.isArray(v.k)) {
    const keys: Key<number>[] = [];
    for (const raw of v.k.slice(0, MOTION_LIMITS.keys)) {
      if (!isObj(raw)) continue;
      keys.push({ t: round3(num(raw.t, 0, duration, 0)), v: round3(num(raw.v, min, max, fallback)), e: easeOf(raw.e) });
    }
    keys.sort((a, b) => a.t - b.t);
    // Two keys at one moment are one key: the later one wins.
    const dedup = keys.filter((k, i) => i === keys.length - 1 || keys[i + 1].t !== k.t);
    if (dedup.length === 1) return dedup[0].v;
    if (dedup.length) return { k: dedup };
  }
  return fallback;
}

function colorPropOf(v: unknown, fallback: string, duration: number): ColorProp {
  if (typeof v === "string") return cleanColor(v, fallback);
  if (isObj(v) && Array.isArray(v.k)) {
    const keys: Key<string>[] = [];
    for (const raw of v.k.slice(0, MOTION_LIMITS.keys)) {
      if (!isObj(raw)) continue;
      keys.push({ t: round3(num(raw.t, 0, duration, 0)), v: cleanColor(raw.v, fallback), e: easeOf(raw.e) });
    }
    keys.sort((a, b) => a.t - b.t);
    const dedup = keys.filter((k, i) => i === keys.length - 1 || keys[i + 1].t !== k.t);
    if (dedup.length === 1) return dedup[0].v;
    if (dedup.length) return { k: dedup };
  }
  return fallback;
}

const size = (v: unknown, fallback: number) => round3(num(v, 1, MOTION_LIMITS.stageMax * 2, fallback));

interface Ctx {
  /** Studio's own copy of a design may refer to canvas layers; a published one may not. */
  studio: boolean;
  assertUrl: UrlCheck;
  clips: number;
  images: Set<string>;
  ids: Set<string>;
}

function sourceOf(raw: unknown, c: Ctx, depth: number, duration: number): Source {
  if (!isObj(raw)) throw new Error("A clip has no source.");
  switch (raw.type) {
    case "image": {
      const url = c.assertUrl(String(raw.url ?? ""), "motion picture");
      const ext = extensionOf(url);
      if (ext && !(MOTION_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) throw new Error("A picture in a motion design has to be a PNG, WebP, JPEG or GIF.");
      c.images.add(url);
      if (c.images.size > MOTION_LIMITS.images) throw new Error(`A motion design can use at most ${MOTION_LIMITS.images} pictures.`);
      return { type: "image", url, w: size(raw.w, 100), h: size(raw.h, 100), ox: round3(num(raw.ox, -MOTION_LIMITS.stageMax, MOTION_LIMITS.stageMax, 0)), oy: round3(num(raw.oy, -MOTION_LIMITS.stageMax, MOTION_LIMITS.stageMax, 0)) };
    }
    case "layer": {
      // Only while editing in Studio: a published design has nothing to point at but pictures.
      if (!c.studio) throw new Error("A published design can't refer to a layer.");
      const nodeId = typeof raw.nodeId === "string" && /^[\w-]{1,40}$/.test(raw.nodeId) ? raw.nodeId : "";
      if (!nodeId) throw new Error("A layer clip has lost its layer.");
      return { type: "layer", nodeId, w: size(raw.w, 100), h: size(raw.h, 100), ox: round3(num(raw.ox, -MOTION_LIMITS.stageMax, MOTION_LIMITS.stageMax, 0)), oy: round3(num(raw.oy, -MOTION_LIMITS.stageMax, MOTION_LIMITS.stageMax, 0)) };
    }
    case "shape":
      return {
        type: "shape",
        shape: oneOf(raw.shape, SHAPE_KINDS, "rect"),
        w: size(raw.w, 100),
        h: size(raw.h, 100),
        fill: colorPropOf(raw.fill, "#ffffff", duration),
        stroke: colorPropOf(raw.stroke, "#ffffff", duration),
        strokeWidth: round3(num(raw.strokeWidth, 0, 200, 0)),
        radius: round3(num(raw.radius, 0, 1000, 0)),
        points: Math.round(num(raw.points, 3, 24, 5)),
        inner: round3(num(raw.inner, 0.05, 0.95, 0.5)),
      };
    case "text": {
      // Printable characters only: no control characters, and a short title.
      const text = typeof raw.text === "string" ? [...raw.text.replace(/[\u0000-\u001f\u007f]/g, " ")].slice(0, MOTION_LIMITS.text).join("") : "";
      return {
        type: "text",
        text,
        size: round3(num(raw.size, 4, 600, 48)),
        weight: Math.round(clamp(num(raw.weight, 100, 900, 700), 100, 900) / 100) * 100,
        italic: raw.italic === true,
        color: colorPropOf(raw.color, "#ffffff", duration),
        stroke: cleanColor(raw.stroke, "#000000"),
        strokeWidth: round3(num(raw.strokeWidth, 0, 60, 0)),
        anim: oneOf(raw.anim, TEXT_ANIMS, "none"),
        stagger: round3(num(raw.stagger, 0, 1, 0.05)),
        align: oneOf(raw.align, ["left", "center", "right"] as const, "center"),
      };
    }
    case "solid":
      return { type: "solid", w: size(raw.w, 100), h: size(raw.h, 100), color: colorPropOf(raw.color, "#ffffff", duration) };
    case "gradient": {
      const stops: { o: number; c: ColorProp }[] = [];
      for (const s of Array.isArray(raw.stops) ? raw.stops.slice(0, 8) : []) {
        if (isObj(s)) stops.push({ o: round3(num(s.o, 0, 1, 0)), c: colorPropOf(s.c, "#ffffff", duration) });
      }
      stops.sort((a, b) => a.o - b.o);
      if (stops.length < 2) stops.splice(0, stops.length, { o: 0, c: "#8b5cf6" }, { o: 1, c: "#22d3ee" });
      return { type: "gradient", w: size(raw.w, 100), h: size(raw.h, 100), kind: oneOf(raw.kind, ["linear", "radial"] as const, "linear"), angle: propOf(raw.angle, -3600, 3600, 0, duration), stops };
    }
    case "noise":
      return { type: "noise", w: size(raw.w, 100), h: size(raw.h, 100), scale: round3(num(raw.scale, 4, 600, 80)), speed: round3(num(raw.speed, -5, 5, 0.3)), color: colorPropOf(raw.color, "#ffffff", duration), contrast: round3(num(raw.contrast, 0, 1, 0.6)), seed: Math.round(num(raw.seed, 0, 99999, 1)) };
    case "shimmer":
      return { type: "shimmer", w: size(raw.w, 100), h: size(raw.h, 100), angle: round3(num(raw.angle, -180, 180, 20)), width: round3(num(raw.width, 0.02, 1, 0.25)), period: round3(num(raw.period, 0.2, 20, 2)), color: cleanColor(raw.color, "#ffffff"), seed: Math.round(num(raw.seed, 0, 99999, 1)) };
    case "rays":
      return { type: "rays", r: size(raw.r, 200), count: Math.round(num(raw.count, 2, 64, 12)), color: colorPropOf(raw.color, "#ffffff", duration), spin: round3(num(raw.spin, -720, 720, 20)), softness: round3(num(raw.softness, 0, 1, 0.5)) };
    case "particles": {
      const d = defaultParticles();
      const colors = (Array.isArray(raw.colors) ? raw.colors.slice(0, 6) : []).map((x) => cleanColor(x, "#ffffff"));
      return {
        type: "particles",
        w: size(raw.w, d.w),
        h: size(raw.h, d.h),
        count: Math.round(num(raw.count, 1, MOTION_LIMITS.particles, d.count)),
        life: round3(num(raw.life, 0.1, 12, d.life)),
        mode: oneOf(raw.mode, ["continuous", "burst"] as const, "continuous"),
        shape: oneOf(raw.shape, PARTICLE_SHAPES, "dot"),
        speed: round3(num(raw.speed, 0, 2000, d.speed)),
        speedJitter: round3(num(raw.speedJitter, 0, 1, d.speedJitter)),
        angle: round3(num(raw.angle, -360, 360, d.angle)),
        spread: round3(num(raw.spread, 0, 360, d.spread)),
        gravity: round3(num(raw.gravity, -2000, 2000, d.gravity)),
        size: round3(num(raw.size, 0.5, 200, d.size)),
        sizeJitter: round3(num(raw.sizeJitter, 0, 1, d.sizeJitter)),
        sizeEnd: round3(num(raw.sizeEnd, 0, 4, d.sizeEnd)),
        spin: round3(num(raw.spin, -2000, 2000, d.spin)),
        colors: colors.length ? colors : d.colors,
        fadeIn: round3(num(raw.fadeIn, 0, 1, d.fadeIn)),
        fadeOut: round3(num(raw.fadeOut, 0, 1, d.fadeOut)),
        seed: Math.round(num(raw.seed, 0, 99999, 1)),
        drift: round3(num(raw.drift, 0, 200, d.drift)),
      };
    }
    case "compound": {
      if (depth >= MOTION_LIMITS.depth) throw new Error(`Compound clips can be nested at most ${MOTION_LIMITS.depth} deep.`);
      const inner = num(raw.duration, 0.1, MOTION_LIMITS.duration, 2);
      return { type: "compound", duration: round3(inner), clips: clipsOf(raw.clips, c, depth + 1, inner) };
    }
    case "adjust":
      return { type: "adjust" };
    default:
      throw new Error(`"${String(raw.type)}" isn't something a motion clip can be.`);
  }
}

function fxOf(raw: unknown, duration: number): ClipFx | null {
  if (!isObj(raw)) return null;
  switch (raw.type) {
    case "blur":
      return { type: "blur", amount: propOf(raw.amount, 0, 100, 0, duration) };
    case "glow":
      return { type: "glow", color: colorPropOf(raw.color, "#ffffff", duration), blur: propOf(raw.blur, 0, 200, 12, duration), strength: propOf(raw.strength, 0, 6, 1, duration) };
    case "shadow":
      return { type: "shadow", color: colorPropOf(raw.color, "#000000", duration), x: propOf(raw.x, -500, 500, 0, duration), y: propOf(raw.y, -500, 500, 6, duration), blur: propOf(raw.blur, 0, 200, 10, duration), opacity: propOf(raw.opacity, 0, 1, 0.5, duration) };
    case "adjust":
      return { type: "adjust", hue: propOf(raw.hue, -360, 360, 0, duration), saturation: propOf(raw.saturation, 0, 4, 1, duration), brightness: propOf(raw.brightness, 0, 4, 1, duration), contrast: propOf(raw.contrast, 0, 4, 1, duration) };
    case "tint":
      return { type: "tint", color: colorPropOf(raw.color, "#ff4d8d", duration), amount: propOf(raw.amount, 0, 1, 0.5, duration) };
    default:
      return null;
  }
}

function transitionOf(raw: unknown, max: number): Transition | undefined {
  if (!isObj(raw)) return undefined;
  const d = num(raw.d, 0, max, 0.5);
  if (d <= 0) return undefined;
  return { type: oneOf(raw.type, TRANSITION_KINDS, "fade"), d: round3(d), dir: oneOf(raw.dir, DIRS, "left"), e: easeOf(raw.e ?? "out") };
}

function transformOf(raw: unknown, duration: number): Transform {
  const r = isObj(raw) ? raw : {};
  return {
    x: propOf(r.x, -MOTION_LIMITS.stageMax * 2, MOTION_LIMITS.stageMax * 2, 0, duration),
    y: propOf(r.y, -MOTION_LIMITS.stageMax * 2, MOTION_LIMITS.stageMax * 2, 0, duration),
    scaleX: propOf(r.scaleX, -20, 20, 1, duration),
    scaleY: propOf(r.scaleY, -20, 20, 1, duration),
    rotation: propOf(r.rotation, -3600, 3600, 0, duration),
    opacity: propOf(r.opacity, 0, 1, 1, duration),
    anchorX: round3(num(r.anchorX, 0, 1, 0.5)),
    anchorY: round3(num(r.anchorY, 0, 1, 0.5)),
  };
}

function clipsOf(raw: unknown, c: Ctx, depth: number, within: number): Clip[] {
  const out: Clip[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isObj(item)) continue;
    if (++c.clips > MOTION_LIMITS.clips) throw new Error(`A motion design can have at most ${MOTION_LIMITS.clips} clips.`);
    const duration = round3(num(item.duration, 0.05, within, Math.min(2, within)));
    const start = round3(num(item.start, 0, Math.max(0, within - 0.05), 0));
    const clipLen = round3(Math.min(duration, within - start));
    let id = typeof item.id === "string" && /^[a-zA-Z0-9_-]{1,40}$/.test(item.id) ? item.id : newMotionId();
    if (c.ids.has(id)) id = newMotionId();
    c.ids.add(id);
    const mask = isObj(item.mask)
      ? ({
          shape: oneOf(item.mask.shape, ["rect", "ellipse"] as const, "rect"),
          x: propOf(item.mask.x, -4800, 4800, 0, clipLen),
          y: propOf(item.mask.y, -4800, 4800, 0, clipLen),
          w: propOf(item.mask.w, 0, 9600, 200, clipLen),
          h: propOf(item.mask.h, 0, 9600, 200, clipLen),
          feather: round3(num(item.mask.feather, 0, 200, 0)),
          invert: item.mask.invert === true,
        } as Mask)
      : undefined;
    const fx: ClipFx[] = [];
    for (const f of Array.isArray(item.fx) ? item.fx.slice(0, MOTION_LIMITS.fx) : []) {
      const x = fxOf(f, clipLen);
      if (x) fx.push(x);
    }
    out.push({
      id,
      name: typeof item.name === "string" ? item.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 60) || "Clip" : "Clip",
      track: Math.round(num(item.track, 0, 31, 0)),
      start,
      duration: clipLen,
      in: round3(num(item.in, 0, 3600, 0)),
      speed: propOf(item.speed, 0.05, 16, 1, clipLen),
      reverse: item.reverse === true,
      loop: item.loop !== false,
      source: sourceOf(item.source, c, depth, clipLen),
      transform: transformOf(item.transform, clipLen),
      blend: oneOf(item.blend, BLEND_MODES, "normal"),
      fx,
      mask,
      transitionIn: transitionOf(item.transitionIn, clipLen),
      transitionOut: transitionOf(item.transitionOut, clipLen),
      on: item.on !== false,
    });
  }
  return out;
}

/**
 * A motion design rebuilt from whatever was sent: numbers clamped, lists capped, enums matched, colours checked, every
 * address through `assertUrl`, nested depth and clip counts limited. What comes out is the only thing stored or played.
 * Throws a plain sentence for something that can't be repaired.
 */
export function normalizeMotionSpec(input: unknown, assertUrl: UrlCheck, opts: { studio?: boolean } = {}): MotionSpec {
  if (!isObj(input)) throw new Error("That motion design is broken.");
  const kind = oneOf(input.kind, ["effect", "nameplate"] as const, "effect");
  // The stage is fixed by what the design is for: a design can't be authored on a stage the app won't show.
  const stage = { ...MOTION_STAGES[kind] };
  const name = typeof input.name === "string" ? input.name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MOTION_LIMITS.name) : "";
  const duration = round3(num(input.duration, 0.1, MOTION_LIMITS.duration, 4));
  const ctx: Ctx = { studio: opts.studio === true, assertUrl, clips: 0, images: new Set(), ids: new Set() };
  const clips = clipsOf(input.clips, ctx, 0, duration);
  const loop = isObj(input.loop) ? input.loop : {};
  return {
    v: 1,
    kind,
    name,
    stage,
    duration,
    loop: { mode: oneOf(loop.mode, ["loop", "once"] as const, "loop"), rest: round3(num(loop.rest, 0, 30, 2)) },
    clips,
  };
}

/** The pictures a design uses, once each: what has to exist on the CDN before it can be played. */
export function motionImageUrls(spec: MotionSpec): string[] {
  const urls = new Set<string>();
  const walk = (clips: Clip[]) => {
    for (const c of clips) {
      if (c.source.type === "image") urls.add(c.source.url);
      if (c.source.type === "compound") walk(c.source.clips);
    }
  };
  walk(spec.clips);
  return [...urls];
}

/** Every clip in a design, nested ones included. */
export function allClips(clips: Clip[]): Clip[] {
  return clips.flatMap((c) => (c.source.type === "compound" ? [c, ...allClips(c.source.clips)] : [c]));
}
