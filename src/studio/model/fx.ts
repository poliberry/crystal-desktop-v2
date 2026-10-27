import { brushReach } from "@/studio/model/brush";
import type { Effects, Gradient, GradientStop, Material, Node, PathLive, PathPoint, Shader, ShaderType } from "@/studio/model/types";

/**
 * Paint and effects, without a canvas: what counts as "has effects", how far they reach,
 * gradients as CSS, and the pixel programs ("shaders") themselves. Kept free of the DOM so the
 * arithmetic can be tested on plain arrays; `fx-render.ts` does the drawing.
 */

// --- Reading ------------------------------------------------------------------------------------

export function nodeGradient(n: Node): Gradient | undefined {
  if (n.type === "shape" || n.type === "path") return n.fillGradient;
  if (n.type === "text") return n.colorGradient;
  return undefined;
}

/** The material a node's fill (or a text's letters) is made of, if any. */
export function nodeMaterial(n: Node): Material | undefined {
  if (n.type === "shape" || n.type === "path") return n.fillMaterial;
  if (n.type === "text") return n.colorMaterial;
  return undefined;
}

/** The material an outline is made of, if any. */
export const strokeMaterialOf = (n: Node): Material | undefined => (n.type === "shape" || n.type === "path" ? n.strokeMaterial : undefined);

const activeShaders = (fx?: Effects) => (fx?.shaders ?? []).filter((s) => s.on);

/**
 * Whether a node has to be rendered to a picture to be sent: a gradient or material, any effect switched on, or
 * it is a path (the app's layer renderer has no way to say "this outline"). Such a node is drawn
 * in the editor by the same renderer, so it looks the same everywhere.
 */
export function hasFx(n: Node): boolean {
  if (n.type !== "image" && n.type !== "shape" && n.type !== "text" && n.type !== "path") return false;
  if (n.type === "path") return true;
  const fx = n.fx;
  return !!nodeGradient(n) || !!nodeMaterial(n) || !!strokeMaterialOf(n) || (n.type === "shape" && !!n.strokeGradient) || !!fx?.shadow?.on || !!fx?.glow?.on || !!fx?.innerGlow?.on || !!fx?.innerShadow?.on || (fx?.blur ?? 0) > 0 || activeShaders(fx).length > 0;
}

/**
 * Whether a node of this document is sent as a rendered picture: anything with effects, and in a
 * scene *every* piece of artwork, because a room has no layer renderer of its own (a room is a
 * background with pictures laid over it). The background itself is the exception: it is the room.
 */
export function bakesToPicture(doc: { kind: string }, n: Node): boolean {
  if (hasFx(n)) return true;
  // A room, a nameplate and an effect have no layer renderer of their own: what is drawn goes out as pictures.
  if (doc.kind !== "scene" && doc.kind !== "nameplate" && doc.kind !== "effect") return false;
  if (n.type === "image" && n.role === "background") return false;
  return n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path";
}

/**
 * How far past the node's own box the effects can draw, in artboard units. Soft edges are cut
 * where they are fainter than ~2%: a blur of `b` is a Gaussian of sigma `b/2`, drawn to 2 sigma.
 * Padding is part of the answer to "does this stay inside the dashed edge", because the server
 * shrinks a layer that doesn't.
 */
export function fxPadding(fx?: Effects): number {
  if (!fx) return 0;
  let p = 0;
  if (fx.shadow?.on) p = Math.max(p, Math.max(Math.abs(fx.shadow.x), Math.abs(fx.shadow.y)) + fx.shadow.blur);
  if (fx.glow?.on) p = Math.max(p, fx.glow.blur);
  if ((fx.blur ?? 0) > 0) p = Math.max(p, fx.blur! * 2);
  for (const s of activeShaders(fx)) if (s.type === "chromatic") p = Math.max(p, Math.abs(s.offset));
  return Math.ceil(p);
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far a node's outline reaches past its box: half a stroke, and for a mitred corner more — a whole stroke covers it. */
export function strokeReach(n: Node): number {
  if (n.type === "path" && n.brush) return n.strokeWidth > 0 ? Math.ceil(n.strokeWidth * brushReach(n.brush)) + 1 : 0;
  if (n.type === "shape" || n.type === "path") return n.strokeWidth > 0 ? Math.ceil(n.strokeWidth * (n.type === "path" && n.join === "miter" ? 1.5 : 0.5)) : 0;
  if (n.type === "text") return n.strokeWidth > 0 ? Math.ceil(n.strokeWidth) : 0;
  return 0;
}

/** The box an effect-rendered node covers: its turned bounds, grown by the padding and the stroke. */
export function fxBox(n: Node): Box {
  const r = ((n.rotation || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  const w = n.w * cos + n.h * sin;
  const h = n.w * sin + n.h * cos;
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  // Always room for the outline: a plain stroked shape baked for a scene needs it as much as one with a glow.
  const pad = fxPadding(n.fx) + strokeReach(n);
  return { x: cx - w / 2 - pad, y: cy - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 };
}

/** A key that changes exactly when what a node looks like changes — not when it only moves. */
export function fxKey(n: Node): string {
  const { x: _x, y: _y, id: _id, name: _n, locked: _l, hidden: _h, opacity: _o, ...look } = n as Node & Record<string, unknown>;
  void [_x, _y, _id, _n, _l, _h, _o];
  return JSON.stringify(look);
}

// --- Colour -------------------------------------------------------------------------------------

export type RGBA = [number, number, number, number];

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`. Anything else is opaque black — a colour we can't read is never a crash. */
export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(s);
  if (m) {
    const h = m[1];
    const c = (i: number) => parseInt(h[i] + h[i], 16);
    return [c(0), c(1), c(2), h.length === 4 ? c(3) / 255 : 1];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), m[2] ? parseInt(m[2], 16) / 255 : 1];
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    const clamp = (v: string) => Math.min(255, Math.max(0, Math.round(parseFloat(v))));
    return [clamp(m[1]), clamp(m[2]), clamp(m[3]), Math.min(1, Math.max(0, a))];
  }
  return [0, 0, 0, 1];
}

export const toRgbaString = ([r, g, b, a]: RGBA, alpha = 1) => `rgba(${r},${g},${b},${+(a * alpha).toFixed(3)})`;

// --- Gradients ----------------------------------------------------------------------------------

export function sortedStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].map((s) => ({ offset: Math.min(1, Math.max(0, s.offset)), color: s.color })).sort((a, b) => a.offset - b.offset);
}

export const defaultGradient = (from = "#8b5cf6", to = "#22d3ee"): Gradient => ({
  type: "linear",
  angle: 90,
  stops: [
    { offset: 0, color: from },
    { offset: 1, color: to },
  ],
});

/** The same gradient as CSS, for the swatch in the Inspector. */
export function gradientCss(g: Gradient): string {
  const stops = sortedStops(g.stops).map((s) => `${s.color} ${+(s.offset * 100).toFixed(2)}%`).join(", ");
  // CSS measures angles from "up"; ours from "right".
  return g.type === "radial" ? `radial-gradient(circle farthest-corner at 50% 50%, ${stops})` : `linear-gradient(${g.angle + 90}deg, ${stops})`;
}

/**
 * The two end points of a linear gradient across a w×h box, as CSS defines them: the line goes
 * through the centre at the angle, and is as long as the box's extent along that direction, so
 * the corners land exactly on the first and last stop.
 */
export function linearEnds(g: Pick<Gradient, "angle">, w: number, h: number): { x0: number; y0: number; x1: number; y1: number } {
  const a = (g.angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = w / 2;
  const cy = h / 2;
  return { x0: cx - (dx * len) / 2, y0: cy - (dy * len) / 2, x1: cx + (dx * len) / 2, y1: cy + (dy * len) / 2 };
}

// --- Shaders ------------------------------------------------------------------------------------

export const SHADER_LABEL: Record<ShaderType, string> = {
  adjust: "Colour adjust",
  grain: "Film grain",
  duotone: "Duotone",
  pixelate: "Pixelate",
  posterize: "Posterize",
  scanlines: "Scanlines",
  chromatic: "Chromatic aberration",
};

let shaderCounter = 0;
export function newShader(type: ShaderType): Shader {
  const id = `s${Date.now().toString(36)}${(shaderCounter++).toString(36)}`;
  switch (type) {
    case "adjust":
      return { id, on: true, type, hue: 0, saturation: 1, brightness: 1, contrast: 1 };
    case "grain":
      return { id, on: true, type, amount: 0.25, seed: 1 };
    case "duotone":
      return { id, on: true, type, shadow: "#1b1464", highlight: "#f9d423" };
    case "pixelate":
      return { id, on: true, type, size: 6 };
    case "posterize":
      return { id, on: true, type, levels: 4 };
    case "scanlines":
      return { id, on: true, type, gap: 2, strength: 0.5 };
    case "chromatic":
      return { id, on: true, type, offset: 3 };
  }
}

/**
 * Ready-made looks built from the effects above. Applying one replaces the glow-type effects and
 * keeps the rest, so it can be added to a design that already has a shadow.
 */
export const GLOW_PRESETS: { id: string; label: string; apply: (fx: Effects | undefined, color: string) => Effects }[] = [
  { id: "soft", label: "Soft glow", apply: (fx, color) => ({ ...fx, glow: { on: true, blur: 18, color, opacity: 0.8, strength: 1 }, innerGlow: undefined }) },
  { id: "neon", label: "Neon tube", apply: (fx, color) => ({ ...fx, glow: { on: true, blur: 22, color, opacity: 1, strength: 3 }, innerGlow: { on: true, blur: 5, color: "#ffffff", opacity: 0.95, strength: 1 } }) },
  { id: "halo", label: "Halo", apply: (fx, color) => ({ ...fx, glow: { on: true, blur: 40, color, opacity: 0.9, strength: 2 }, innerGlow: undefined }) },
  { id: "ember", label: "Ember edge", apply: (fx, color) => ({ ...fx, glow: { on: true, blur: 10, color, opacity: 0.7, strength: 1 }, innerGlow: { on: true, blur: 12, color, opacity: 0.9, strength: 2 } }) },
];

export type EffectKind = "shadow" | "innerShadow" | "glow" | "innerGlow" | "blur" | `shader:${ShaderType}`;

/** The effects with one more added, using Illustrator-ish defaults. An effect that is already there is left as it is. */
export function addEffect(fx: Effects | undefined, kind: EffectKind): Effects {
  const cur = fx ?? {};
  switch (kind) {
    case "shadow":
      return { ...cur, shadow: cur.shadow ?? { on: true, x: 0, y: 6, blur: 12, color: "#000000", opacity: 0.5 } };
    case "innerShadow":
      return { ...cur, innerShadow: cur.innerShadow ?? { on: true, x: 0, y: 3, blur: 6, color: "#000000", opacity: 0.6 } };
    case "glow":
      return { ...cur, glow: cur.glow ?? { on: true, blur: 16, color: "#ffffff", opacity: 0.9, strength: 1 } };
    case "innerGlow":
      return { ...cur, innerGlow: cur.innerGlow ?? { on: true, blur: 10, color: "#ffffff", opacity: 0.9, strength: 1 } };
    case "blur":
      return { ...cur, blur: cur.blur || 4 };
    default:
      return { ...cur, shaders: [...(cur.shaders ?? []), newShader(kind.slice(7) as ShaderType)] };
  }
}

/** A cheap, repeatable hash to [0,1): the same pixel gets the same noise every time, so a design renders the same twice. */
export function hash01(i: number, seed: number): number {
  let h = (Math.imul(i, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Run one shader over straight (non-premultiplied) RGBA bytes in place. `scale` is pixels per
 * artboard unit, so a setting in units looks the same however large the picture is drawn.
 * Transparent pixels stay transparent for every shader except those that move pixels about.
 */
export function applyShader(data: Uint8ClampedArray, w: number, h: number, s: Shader, scale: number): void {
  const n = w * h;
  switch (s.type) {
    case "adjust": {
      const a = (s.hue * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      // The standard hue-rotation matrix (as CSS filters define it), then saturation about luma.
      const m = [
        0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
        0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
        0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
      ];
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (data[o + 3] === 0) continue;
        let r = data[o] * m[0] + data[o + 1] * m[1] + data[o + 2] * m[2];
        let g = data[o] * m[3] + data[o + 1] * m[4] + data[o + 2] * m[5];
        let b = data[o] * m[6] + data[o + 1] * m[7] + data[o + 2] * m[8];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * s.saturation;
        g = l + (g - l) * s.saturation;
        b = l + (b - l) * s.saturation;
        data[o] = clamp255(((r * s.brightness - 127.5) * s.contrast) + 127.5);
        data[o + 1] = clamp255(((g * s.brightness - 127.5) * s.contrast) + 127.5);
        data[o + 2] = clamp255(((b * s.brightness - 127.5) * s.contrast) + 127.5);
      }
      return;
    }
    case "grain": {
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (data[o + 3] === 0) continue;
        const d = (hash01(i, s.seed) - 0.5) * s.amount * 255;
        data[o] = clamp255(data[o] + d);
        data[o + 1] = clamp255(data[o + 1] + d);
        data[o + 2] = clamp255(data[o + 2] + d);
      }
      return;
    }
    case "duotone": {
      const lo = parseColor(s.shadow);
      const hi = parseColor(s.highlight);
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (data[o + 3] === 0) continue;
        const t = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
        data[o] = lo[0] + (hi[0] - lo[0]) * t;
        data[o + 1] = lo[1] + (hi[1] - lo[1]) * t;
        data[o + 2] = lo[2] + (hi[2] - lo[2]) * t;
      }
      return;
    }
    case "posterize": {
      const steps = Math.max(2, Math.min(32, Math.round(s.levels))) - 1;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        if (data[o + 3] === 0) continue;
        for (let c = 0; c < 3; c++) data[o + c] = Math.round(Math.round((data[o + c] / 255) * steps) * (255 / steps));
      }
      return;
    }
    case "scanlines": {
      const gap = Math.max(1, Math.round(s.gap * scale));
      for (let y = 0; y < h; y++) {
        if (Math.floor(y / gap) % 2 === 0) continue;
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4 + 3;
          data[o] = data[o] * (1 - Math.min(1, Math.max(0, s.strength)));
        }
      }
      return;
    }
    case "pixelate": {
      const size = Math.max(1, Math.round(s.size * scale));
      if (size === 1) return;
      for (let by = 0; by < h; by += size) {
        for (let bx = 0; bx < w; bx += size) {
          const x1 = Math.min(w, bx + size);
          const y1 = Math.min(h, by + size);
          // Colour is averaged weighted by alpha, so a transparent edge doesn't darken the block.
          let r = 0, g = 0, b = 0, a = 0;
          for (let y = by; y < y1; y++) {
            for (let x = bx; x < x1; x++) {
              const o = (y * w + x) * 4;
              const al = data[o + 3];
              r += data[o] * al;
              g += data[o + 1] * al;
              b += data[o + 2] * al;
              a += al;
            }
          }
          const count = (x1 - bx) * (y1 - by);
          const or = a ? r / a : 0, og = a ? g / a : 0, ob = a ? b / a : 0, oa = a / count;
          for (let y = by; y < y1; y++) {
            for (let x = bx; x < x1; x++) {
              const o = (y * w + x) * 4;
              data[o] = or;
              data[o + 1] = og;
              data[o + 2] = ob;
              data[o + 3] = oa;
            }
          }
        }
      }
      return;
    }
    case "chromatic": {
      const off = Math.round(s.offset * scale);
      if (off === 0) return;
      const src = new Uint8ClampedArray(data);
      const at = (x: number, y: number, c: number) => (x < 0 || x >= w ? 0 : src[(y * w + x) * 4 + c]);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          // The red copy is shifted right and the blue copy left; green and the shape stay put.
          const ra = at(x - off, y, 3);
          const ba = at(x + off, y, 3);
          const ga = src[o + 3];
          const a = Math.max(ra, ba, ga);
          data[o] = ra ? at(x - off, y, 0) : src[o];
          data[o + 2] = ba ? at(x + off, y, 2) : src[o + 2];
          data[o + 1] = src[o + 1];
          data[o + 3] = a;
        }
      }
      return;
    }
  }
}

// --- Reading from a file ------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
const col = (v: unknown, d: string) => (typeof v === "string" && v.length <= 64 ? v : d);
const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** A gradient from a file: rebuilt field by field, at least two stops, at most eight. */
export function sanitizeGradient(raw: unknown): Gradient | undefined {
  if (!isObj(raw) || !Array.isArray(raw.stops)) return undefined;
  const stops = raw.stops
    .filter(isObj)
    .slice(0, 8)
    .map((s) => ({ offset: fin(s.offset, 0, 1, 0), color: col(s.color, "#000000") }));
  if (stops.length < 2) return undefined;
  return { type: raw.type === "radial" ? "radial" : "linear", angle: fin(raw.angle, -360, 360, 90), stops };
}

const SHADER_TYPES: ShaderType[] = ["adjust", "grain", "duotone", "pixelate", "posterize", "scanlines", "chromatic"];

function sanitizeShader(raw: unknown): Shader | undefined {
  if (!isObj(raw) || !SHADER_TYPES.includes(raw.type as ShaderType)) return undefined;
  const id = typeof raw.id === "string" && /^[\w-]{1,32}$/.test(raw.id) ? raw.id : newShader("grain").id;
  const on = flag(raw.on, true);
  switch (raw.type as ShaderType) {
    case "adjust":
      return { id, on, type: "adjust", hue: fin(raw.hue, -360, 360, 0), saturation: fin(raw.saturation, 0, 4, 1), brightness: fin(raw.brightness, 0, 3, 1), contrast: fin(raw.contrast, 0, 3, 1) };
    case "grain":
      return { id, on, type: "grain", amount: fin(raw.amount, 0, 1, 0.25), seed: Math.round(fin(raw.seed, 0, 1e6, 1)) };
    case "duotone":
      return { id, on, type: "duotone", shadow: col(raw.shadow, "#000000"), highlight: col(raw.highlight, "#ffffff") };
    case "pixelate":
      return { id, on, type: "pixelate", size: fin(raw.size, 1, 200, 6) };
    case "posterize":
      return { id, on, type: "posterize", levels: Math.round(fin(raw.levels, 2, 32, 4)) };
    case "scanlines":
      return { id, on, type: "scanlines", gap: fin(raw.gap, 1, 100, 2), strength: fin(raw.strength, 0, 1, 0.5) };
    case "chromatic":
      return { id, on, type: "chromatic", offset: fin(raw.offset, -100, 100, 3) };
  }
}

/** Effects from a file. Ranges are held to what the renderer can draw cheaply: a file is not trusted to be sensible. */
export function sanitizeEffects(raw: unknown): Effects | undefined {
  if (!isObj(raw)) return undefined;
  const shadow = (v: unknown) =>
    isObj(v) ? { on: flag(v.on, true), x: fin(v.x, -500, 500, 0), y: fin(v.y, -500, 500, 4), blur: fin(v.blur, 0, 200, 8), color: col(v.color, "#000000"), opacity: fin(v.opacity, 0, 1, 0.5) } : undefined;
  const out: Effects = {};
  const sh = shadow(raw.shadow);
  if (sh) out.shadow = sh;
  const inner = shadow(raw.innerShadow);
  if (inner) out.innerShadow = inner;
  if (isObj(raw.glow)) {
    const g = raw.glow;
    out.glow = { on: flag(g.on, true), blur: fin(g.blur, 0, 200, 12), color: col(g.color, "#ffffff"), opacity: fin(g.opacity, 0, 1, 0.8), strength: Math.round(fin(g.strength, 1, 6, 1)) };
  }
  if (isObj(raw.innerGlow)) {
    const g = raw.innerGlow;
    out.innerGlow = { on: flag(g.on, true), blur: fin(g.blur, 0, 200, 10), color: col(g.color, "#ffffff"), opacity: fin(g.opacity, 0, 1, 0.9), strength: Math.round(fin(g.strength, 1, 6, 1)) };
  }
  const blur = fin(raw.blur, 0, 100, 0);
  if (blur > 0) out.blur = blur;
  if (Array.isArray(raw.shaders)) {
    const shaders = raw.shaders.slice(0, 12).map(sanitizeShader).filter((s): s is Shader => !!s);
    if (shaders.length) out.shaders = shaders;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The anchors of a path from a file: finite fractions of the box, within a sane range, at most 500. */
export function sanitizePoints(raw: unknown): PathPoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const f = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(50, Math.max(-50, v)) : undefined);
  const out: PathPoint[] = [];
  for (const p of raw.slice(0, 500)) {
    if (!isObj(p)) continue;
    const x = f(p.x);
    const y = f(p.y);
    if (x === undefined || y === undefined) continue;
    const q: PathPoint = { x, y };
    // A contour flag on the first anchor means nothing; elsewhere it starts a new contour.
    if (p.m === true && out.length > 0) q.m = true;
    const ix = f(p.inX), iy = f(p.inY), ox = f(p.outX), oy = f(p.outY);
    if (ix !== undefined && iy !== undefined) { q.inX = ix; q.inY = iy; }
    if (ox !== undefined && oy !== undefined) { q.outX = ox; q.outY = oy; }
    out.push(q);
  }
  return out.length >= 2 ? out : undefined;
}

export function sanitizeLive(raw: unknown): PathLive | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.kind === "polygon") return { kind: "polygon", sides: Math.round(fin(raw.sides, 3, 60, 6)) };
  if (raw.kind === "star") return { kind: "star", points: Math.round(fin(raw.points, 3, 40, 5)), inner: fin(raw.inner, 0.05, 0.95, 0.5) };
  return undefined;
}
