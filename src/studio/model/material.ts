import { hash01, parseColor, type RGBA } from "@/studio/model/fx";
import type { Material, MaterialType } from "@/studio/model/types";

/**
 * Materials: procedural textures (wood, marble, brushed metal…) used as a fill or an outline.
 *
 * Every texture is a function of position and the material's own settings, made from value noise: no
 * pictures, no randomness beyond the material's `seed`, so the same material is the same pixels every
 * time, at any size, in the editor, the store picture and what is sent to the server. Positions are in
 * artboard units measured from the top-left of the node's box, so `scale` means the same thing
 * however large the picture is drawn, and a shape that is resized shows more or less of the same
 * grain rather than a stretched one.
 *
 * Pure arithmetic on arrays (no canvas), like the shaders in `fx.ts`; `fx-render.ts` draws it.
 */

// --- Noise ------------------------------------------------------------------------------------

const lattice = (ix: number, iy: number, seed: number) => hash01((Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0, seed);
const fade = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
const fract = (v: number) => v - Math.floor(v);

/** Smooth value noise in [0,1). */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const a = lattice(ix, iy, seed);
  const b = lattice(ix + 1, iy, seed);
  const c = lattice(ix, iy + 1, seed);
  const d = lattice(ix + 1, iy + 1, seed);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

/** Layered noise in [0,1): detail at several sizes, as natural surfaces have. */
export function fbm(x: number, y: number, seed: number, octaves = 4): number {
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

/** Distance to the nearest and second-nearest of a jittered grid of points: the cells of leather, scales, cracked ice. */
function cells(x: number, y: number, seed: number): { f1: number; f2: number; id: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const px = cx + lattice(cx, cy, seed);
      const py = cy + lattice(cx, cy, seed + 77);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = lattice(cx, cy, seed + 5);
      } else if (d < f2) f2 = d;
    }
  }
  return { f1, f2, id };
}

// --- The materials ----------------------------------------------------------------------------

export const MATERIAL_LABEL: Record<MaterialType, string> = {
  wood: "Wood",
  marble: "Marble",
  stone: "Stone",
  brick: "Brick",
  metal: "Metal",
  leather: "Leather",
  fabric: "Fabric",
  carbon: "Carbon fibre",
  ice: "Ice",
  lava: "Lava",
  glitter: "Glitter",
  parchment: "Parchment",
};

export const MATERIAL_TYPES = Object.keys(MATERIAL_LABEL) as MaterialType[];

/** What each of a material's two colours means, for labelling the pickers. */
export const MATERIAL_COLORS: Record<MaterialType, [string, string]> = {
  wood: ["Light grain", "Dark grain"],
  marble: ["Stone", "Veins"],
  stone: ["Stone", "Flecks"],
  brick: ["Brick", "Mortar"],
  metal: ["Metal", "Highlight"],
  leather: ["Leather", "Creases"],
  fabric: ["Thread", "Weft"],
  carbon: ["Weave", "Sheen"],
  ice: ["Ice", "Frost"],
  lava: ["Rock", "Glow"],
  glitter: ["Base", "Sparkle"],
  parchment: ["Paper", "Stains"],
};

/** Which settings a material uses, so the panel shows only what does something. */
export const MATERIAL_USES: Record<MaterialType, { angle: boolean }> = {
  wood: { angle: true },
  marble: { angle: true },
  stone: { angle: false },
  brick: { angle: true },
  metal: { angle: true },
  leather: { angle: false },
  fabric: { angle: true },
  carbon: { angle: true },
  ice: { angle: false },
  lava: { angle: false },
  glitter: { angle: false },
  parchment: { angle: false },
};

type RGB = [number, number, number];
const toRgb = (c: RGBA): RGB => [c[0], c[1], c[2]];
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** The colour of one point of a material. `u`,`v` are artboard units from the node's top-left. */
function sampleAt(m: Material, c1: RGB, c2: RGB, u: number, v: number, turn: { cos: number; sin: number }): RGB {
  const s = Math.max(0.5, m.scale);
  const k = clamp01(m.intensity);
  const seed = m.seed | 0;
  // Along and across the grain.
  const x = u * turn.cos + v * turn.sin;
  const y = -u * turn.sin + v * turn.cos;

  switch (m.type) {
    case "wood": {
      // Growth rings: distance from an off-centre axis, wobbled by noise, folded into repeating bands.
      const wobble = fbm(x / (s * 5), y / (s * 0.9), seed, 4) - 0.5;
      const ring = fract((y + wobble * s * 2.2) / (s * 0.42));
      const band = Math.pow(ring, 2.1); // soft early wood, a hard dark edge of late wood
      const streak = noise2(x / (s * 7), y / (s * 0.05), seed + 9);
      const pore = noise2(x / (s * 0.5), y / (s * 0.04), seed + 21);
      const t = clamp01(0.5 + (band - 0.5) * (0.5 + k) + (streak - 0.5) * 0.45 * k - (pore > 0.86 ? 0.14 * k : 0));
      return lerpRgb(c1, c2, t);
    }
    case "marble": {
      const warp = fbm(u / (s * 1.4), v / (s * 1.4), seed, 5);
      const vein = Math.abs(Math.sin(((x + y * 0.35) / s) * 1.6 + warp * 7));
      const line = 1 - smooth(0, 0.1 + 0.1 * (1 - k), vein);
      const fine = 1 - smooth(0, 0.035, Math.abs(Math.sin(((x * 0.6 - y) / s) * 3.1 + warp * 11)));
      const cloud = fbm(u / (s * 2.5), v / (s * 2.5), seed + 3, 4);
      const base = lerpRgb(c1, shade(c1, 0.86), cloud);
      return lerpRgb(base, c2, clamp01(line * (0.55 + 0.45 * k) + fine * 0.3 * k));
    }
    case "stone": {
      const body = fbm(u / (s * 0.9), v / (s * 0.9), seed, 4);
      const fleck = noise2(u / (s * 0.09), v / (s * 0.09), seed + 11);
      const fleck2 = noise2(u / (s * 0.2), v / (s * 0.2), seed + 31);
      let t = (body - 0.5) * 0.8 * k + 0.5;
      if (fleck > 0.78) t = mix(t, 1, 0.8 * k);
      else if (fleck2 < 0.16) t = mix(t, 0, 0.7 * k);
      const base = lerpRgb(shade(c1, 0.8), shade(c1, 1.15), body);
      return lerpRgb(base, c2, clamp01(Math.max(0, t - 0.55) * 2.2 * k + (fleck > 0.78 ? 0.7 * k : 0)));
    }
    case "brick": {
      const bw = s * 2;
      const bh = s;
      const mortar = s * 0.09;
      const row = Math.floor(y / bh);
      const bx = x + (row & 1 ? bw / 2 : 0);
      const col = Math.floor(bx / bw);
      const fx = bx - col * bw;
      const fy = y - row * bh;
      const inMortar = fx < mortar || fy < mortar;
      const grit = fbm(u / (s * 0.18), v / (s * 0.18), seed + 2, 3);
      if (inMortar) return lerpRgb(c2, shade(c2, 0.82), grit);
      const tint = lattice(col, row, seed) - 0.5;
      const bevel = Math.min(smooth(mortar, mortar * 3, fx), smooth(mortar, mortar * 3, fy));
      return shade(lerpRgb(shade(c1, 1 + tint * 0.5 * k), shade(c1, 0.8), 1 - bevel), 0.85 + 0.3 * grit);
    }
    case "metal": {
      // Brushed: noise stretched a long way along the grain, with a soft band of light across it.
      const brush = noise2(x / (s * 9), y / (s * 0.035), seed) * 0.6 + noise2(x / (s * 3), y / (s * 0.012), seed + 4) * 0.4;
      const band = 0.5 + 0.5 * Math.sin((y / (s * 2.5)) * Math.PI * 2 + fbm(x / (s * 6), y / (s * 6), seed, 2) * 3);
      const light = clamp01(0.55 + (brush - 0.5) * 0.7 * k + (band - 0.5) * 0.9 * k);
      return light > 0.62 ? lerpRgb(c1, c2, smooth(0.62, 0.95, light)) : shade(c1, 0.55 + 0.45 * smooth(0.1, 0.62, light));
    }
    case "leather": {
      const g = cells(u / (s * 0.55), v / (s * 0.55), seed);
      const crease = smooth(0, 0.18, g.f2 - g.f1); // 0 on the lines between pebbles
      const pebble = 0.82 + 0.18 * g.id + (noise2(u / (s * 0.05), v / (s * 0.05), seed + 8) - 0.5) * 0.12;
      return lerpRgb(c2, shade(c1, pebble), clamp01(mix(1, crease, 0.35 + 0.65 * k)));
    }
    case "fabric": {
      const tu = (x / s) * Math.PI * 2 * 3;
      const tv = (y / s) * Math.PI * 2 * 3;
      const warpOver = Math.sin(tu) * Math.sin(tv) > 0; // over-under weave
      const thread = warpOver ? 0.5 + 0.5 * Math.cos(tu) : 0.5 + 0.5 * Math.cos(tv);
      const slub = noise2(x / (s * 4), y / (s * 0.05), seed) - 0.5;
      const base = warpOver ? c1 : c2;
      return shade(base, 0.7 + 0.3 * mix(1, thread, k) + slub * 0.25 * k);
    }
    case "carbon": {
      const cell = s * 0.5;
      const ci = Math.floor(x / cell);
      const cj = Math.floor(y / cell);
      const fx = x / cell - ci;
      const fy = y / cell - cj;
      // Twill: each cell is a diagonal strand, alternating direction like a checkerboard.
      const along = (ci + cj) & 1 ? fx : fy;
      const ridge = Math.sin(along * Math.PI);
      const sheen = ridge * 0.55 + (noise2(x / (s * 3), y / (s * 3), seed) - 0.5) * 0.12;
      return lerpRgb(shade(c1, 0.7 + 0.3 * ridge), c2, clamp01(sheen * k * 0.9 - 0.1));
    }
    case "ice": {
      const frost = fbm(u / (s * 1.2), v / (s * 1.2), seed, 5);
      const g = cells(u / (s * 1.6), v / (s * 1.6), seed + 3);
      const crack = 1 - smooth(0, 0.07, g.f2 - g.f1);
      const deep = fbm(u / (s * 4), v / (s * 4), seed + 6, 3);
      const base = lerpRgb(shade(c1, 0.9), c1, deep);
      return lerpRgb(base, c2, clamp01(crack * 0.7 * k + Math.max(0, frost - 0.55) * 1.4 * k));
    }
    case "lava": {
      // Dark crust over a glowing network: where the ridged noise is near zero the heat shows through.
      // Layered noise sits near 0.5 most of the time, so "close to 0.5" is the thin network of seams.
      const n = fbm(u / (s * 1.3), v / (s * 1.3), seed, 5);
      const heat = 1 - smooth(0.004, 0.012 + 0.05 * k, Math.abs(n - 0.5));
      const crust = lerpRgb(c1, shade(c1, 1.7), fbm(u / (s * 0.4), v / (s * 0.4), seed + 4, 3));
      const hot = lerpRgb(c2, [255, 240, 170], smooth(0.65, 1, heat));
      return lerpRgb(crust, hot, heat);
    }
    case "glitter": {
      const cell = s * 0.16;
      const gu = u / cell;
      const gv = v / cell;
      const id = lattice(Math.floor(gu), Math.floor(gv), seed + 13);
      const inside = Math.hypot(fract(gu) - 0.5, fract(gv) - 0.5);
      const spark = id > 1 - 0.22 * k - 0.03 ? smooth(0.42, 0, inside) * (0.5 + id) : 0;
      const shimmer = fbm(u / (s * 1.5), v / (s * 1.5), seed, 3);
      const base = lerpRgb(shade(c1, 0.78), c1, shimmer);
      return lerpRgb(base, c2, clamp01(spark * 1.2));
    }
    case "parchment": {
      const fibre = noise2(x / (s * 0.8), y / (s * 0.02), seed) * 0.5 + noise2(x / (s * 0.02), y / (s * 0.8), seed + 5) * 0.5;
      const blotch = fbm(u / (s * 3), v / (s * 3), seed + 2, 5);
      const stain = smooth(0.42, 0.7, blotch);
      const edge = smooth(0.5, 0.75, fbm(u / (s * 0.5), v / (s * 0.5), seed + 7, 3));
      const base = lerpRgb(shade(c1, 0.88), shade(c1, 1.04), fibre);
      return lerpRgb(base, c2, clamp01(stain * 0.8 * k + edge * 0.18 * k + (fibre < 0.3 ? 0.1 * k : 0)));
    }
  }
}

/**
 * A material as straight (non-premultiplied) RGBA bytes: `w`×`h` pixels, drawn at `scale` pixels per
 * artboard unit, so a texture is the same whatever size it is made at. `origin` is where the picture's
 * top-left corner is in the node's own units (negative for a picture that reaches past the node's box,
 * so an outline's outer half is textured too). Always opaque.
 */
export function materialPixels(m: Material, w: number, h: number, scale: number, origin: { x: number; y: number } = { x: 0, y: 0 }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const c1 = toRgb(parseColor(m.color));
  const c2 = toRgb(parseColor(m.color2));
  const a = ((m.angle || 0) * Math.PI) / 180;
  const turn = { cos: Math.cos(a), sin: Math.sin(a) };
  const inv = 1 / Math.max(1e-6, scale);
  for (let py = 0; py < h; py++) {
    const v = (py + 0.5) * inv + origin.y;
    for (let px = 0; px < w; px++) {
      const [r, g, b] = sampleAt(m, c1, c2, (px + 0.5) * inv + origin.x, v, turn);
      const o = (py * w + px) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

// --- Defaults and presets ---------------------------------------------------------------------

export const DEFAULT_MATERIAL: Record<MaterialType, Omit<Material, "type">> = {
  wood: { color: "#c8935a", color2: "#6b3f1d", scale: 36, intensity: 0.7, angle: 0, seed: 1 },
  marble: { color: "#f1f1ee", color2: "#5d6470", scale: 60, intensity: 0.7, angle: 20, seed: 1 },
  stone: { color: "#8a8a90", color2: "#e9e9ef", scale: 40, intensity: 0.7, angle: 0, seed: 1 },
  brick: { color: "#a4492f", color2: "#cfc6b8", scale: 26, intensity: 0.6, angle: 0, seed: 1 },
  metal: { color: "#9aa2ad", color2: "#ffffff", scale: 40, intensity: 0.7, angle: 0, seed: 1 },
  leather: { color: "#7a4a2a", color2: "#2c180c", scale: 24, intensity: 0.7, angle: 0, seed: 1 },
  fabric: { color: "#b9a98c", color2: "#8f8068", scale: 12, intensity: 0.7, angle: 0, seed: 1 },
  carbon: { color: "#16171b", color2: "#7d8594", scale: 12, intensity: 0.7, angle: 45, seed: 1 },
  ice: { color: "#9fd6f2", color2: "#ffffff", scale: 40, intensity: 0.7, angle: 0, seed: 1 },
  lava: { color: "#241410", color2: "#ff5a14", scale: 34, intensity: 0.7, angle: 0, seed: 1 },
  glitter: { color: "#c9a227", color2: "#fff8d6", scale: 30, intensity: 0.7, angle: 0, seed: 1 },
  parchment: { color: "#e8d9b0", color2: "#a67c3d", scale: 50, intensity: 0.6, angle: 0, seed: 1 },
};

export const defaultMaterial = (type: MaterialType): Material => ({ type, ...DEFAULT_MATERIAL[type] });

export interface MaterialPreset {
  id: string;
  label: string;
  group: string;
  material: Material;
}

const P = (id: string, label: string, group: string, type: MaterialType, o: Partial<Omit<Material, "type">>): MaterialPreset => ({ id, label, group, material: { type, ...DEFAULT_MATERIAL[type], ...o } });

export const MATERIAL_PRESETS: MaterialPreset[] = [
  P("oak", "Oak", "Wood", "wood", {}),
  P("walnut", "Walnut", "Wood", "wood", { color: "#7a4e2d", color2: "#2e180b" }),
  P("pine", "Pine", "Wood", "wood", { color: "#e3c08a", color2: "#a7753d", scale: 44 }),
  P("cherry", "Cherry", "Wood", "wood", { color: "#b5593a", color2: "#5a2314" }),
  P("ebony", "Ebony", "Wood", "wood", { color: "#3a3430", color2: "#0d0a09", intensity: 0.55 }),
  P("birch", "Birch", "Wood", "wood", { color: "#efe3c8", color2: "#bfa77b", scale: 50, intensity: 0.5 }),
  P("white-marble", "White marble", "Stone", "marble", {}),
  P("black-marble", "Black marble", "Stone", "marble", { color: "#1c1d22", color2: "#d9c58a", intensity: 0.8 }),
  P("green-marble", "Green marble", "Stone", "marble", { color: "#2f6b52", color2: "#e8f2ea" }),
  P("granite", "Granite", "Stone", "stone", {}),
  P("slate", "Slate", "Stone", "stone", { color: "#4d5560", color2: "#a9b3be", intensity: 0.5 }),
  P("sandstone", "Sandstone", "Stone", "stone", { color: "#cfa56e", color2: "#f3dcae", intensity: 0.55 }),
  P("red-brick", "Red brick", "Stone", "brick", {}),
  P("grey-brick", "Grey brick", "Stone", "brick", { color: "#7c7f86", color2: "#b9b9b4" }),
  P("gold", "Gold", "Metal", "metal", { color: "#c99a2e", color2: "#fff2b0" }),
  P("silver", "Silver", "Metal", "metal", { color: "#aeb5bf", color2: "#ffffff" }),
  P("copper", "Copper", "Metal", "metal", { color: "#b3643c", color2: "#ffd2a8" }),
  P("steel", "Steel", "Metal", "metal", { color: "#6d7580", color2: "#e4eaf2", intensity: 0.8 }),
  P("rose-gold", "Rose gold", "Metal", "metal", { color: "#c98a7a", color2: "#ffe3dc" }),
  P("brown-leather", "Brown leather", "Fabric", "leather", {}),
  P("black-leather", "Black leather", "Fabric", "leather", { color: "#1d1d20", color2: "#050506" }),
  P("linen", "Linen", "Fabric", "fabric", {}),
  P("denim", "Denim", "Fabric", "fabric", { color: "#35557f", color2: "#26405f" }),
  P("red-cloth", "Red cloth", "Fabric", "fabric", { color: "#a3262b", color2: "#7a1a1f" }),
  P("carbon-fibre", "Carbon fibre", "Fabric", "carbon", {}),
  P("ice", "Ice", "Elements", "ice", {}),
  P("lava", "Lava", "Elements", "lava", {}),
  P("gold-glitter", "Gold glitter", "Elements", "glitter", {}),
  P("pink-glitter", "Pink glitter", "Elements", "glitter", { color: "#d94c9a", color2: "#ffe0f3" }),
  P("silver-glitter", "Silver glitter", "Elements", "glitter", { color: "#9ca3af", color2: "#ffffff" }),
  P("parchment", "Parchment", "Elements", "parchment", {}),
];

export const PRESET_GROUPS = [...new Set(MATERIAL_PRESETS.map((p) => p.group))];

/** Clamp a material to what is valid; anything unrecognised becomes a sensible default rather than an error. */
export function cleanMaterial(raw: unknown): Material | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!MATERIAL_TYPES.includes(r.type as MaterialType)) return undefined;
  const d = DEFAULT_MATERIAL[r.type as MaterialType];
  const color = (v: unknown, fallback: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    type: r.type as MaterialType,
    color: color(r.color, d.color),
    color2: color(r.color2, d.color2),
    scale: num(r.scale, 2, 400, d.scale),
    intensity: num(r.intensity, 0, 1, d.intensity),
    angle: num(r.angle, -360, 360, d.angle),
    seed: Math.round(num(r.seed, 0, 99999, 1)),
  };
}
