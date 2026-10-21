/**
 * The drawing kit for Crystal's remade cosmetics (scripts/cosmetics/designs-*.ts).
 *
 * Every design is drawn straight onto a 2D canvas as a function of time, and follows the same calm rules:
 *
 *  - **An intro, then an idle.** Things fade and settle into place over the first `intro` seconds (`T.enter`), and every
 *    envelope is exactly 1 from `intro` on.
 *  - **The idle is periodic by construction.** Everything that moves after the intro is a function of `T.u`, the phase of
 *    the idle (0 → 1 over `idle` seconds), through whole-number harmonics (`T.wave(k)`). So the frame at the end of the
 *    file *is* the frame at `intro`, and the player's seek back to the loop point is invisible.
 *  - **Slow and soft.** Nothing blinks, strobes or flashes: brightness changes are low-amplitude sine swells lasting
 *    seconds, particles are sparse and drift, and light is soft-edged. `scripts/render-cosmetics.mjs` measures every
 *    frame against a strict photosensitivity budget and refuses to publish a design that breaks it.
 */

export const TAU = Math.PI * 2;

export type Ctx = CanvasRenderingContext2D;

export interface Design {
  slug: string;
  name: string;
  kind: "nameplate" | "effect" | "decoration";
  /** What the listing says it is (kept in step with what is drawn). */
  description: string;
  /** Seconds of intro, played once. */
  intro: number;
  /** Seconds of idle, looped. */
  idle: number;
  /** Seconds over which the renderer fades the finished picture up (default: most of the intro, at most 1.45 s). A
   *  design that covers a lot of the card in dark cloud takes longer, so a light card darkens gently. */
  fadeIn?: number;
  /** Set for a decoration that bends the picture behind it (see src/lib/decoration-refraction.ts). */
  refract?: "ice";
  draw: (g: Ctx, t: Time) => void;
}

export const STAGES = {
  nameplate: { w: 960, h: 176 },
  effect: { w: 600, h: 700 },
  /** A decoration's 100-unit viewBox, drawn at 3.84 px per unit. The avatar is the middle 76 units (12 to 88). */
  decoration: { w: 384, h: 384 },
} as const;

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (x: number) => {
  const v = clamp01(x);
  return v * v * (3 - 2 * v);
};
export const smoother = (x: number) => {
  const v = clamp01(x);
  return v * v * v * (v * (v * 6 - 15) + 10);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const frac = (x: number) => x - Math.floor(x);

export interface Time {
  /** Seconds into the file. */
  t: number;
  intro: number;
  idle: number;
  /** The idle's phase, 0 → 1, defined (and continuous) at every time, the intro included. */
  u: number;
  /** An intro envelope: 0 before `delay`, easing to 1 over `dur` seconds, and exactly 1 from the end of the intro. */
  enter: (delay: number, dur: number) => number;
  /** A slow wave, −1 → 1, `k` whole cycles per idle. */
  wave: (k: number, phase?: number) => number;
  /** The same wave as 0 → 1. */
  swell: (k: number, phase?: number) => number;
}

export function timeAt(t: number, intro: number, idle: number): Time {
  const u = frac((t - intro) / idle);
  return {
    t,
    intro,
    idle,
    u,
    enter: (delay, dur) => (t >= intro ? 1 : smoother((t - delay) / Math.max(1e-6, dur))),
    wave: (k, phase = 0) => {
      if (!Number.isInteger(k)) throw new Error(`a wave must have a whole number of cycles per idle (got ${k})`);
      return Math.sin(TAU * (k * u + phase));
    },
    swell: (k, phase = 0) => {
      if (!Number.isInteger(k)) throw new Error(`a wave must have a whole number of cycles per idle (got ${k})`);
      return 0.5 + 0.5 * Math.sin(TAU * (k * u + phase));
    },
  };
}

/** A tiny deterministic generator, so a design is the same every time it is drawn. */
export function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    return ((s ^ (s >>> 13)) >>> 0) / 4294967296;
  };
}

// --- Colour -------------------------------------------------------------------------------------------------------------

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${Math.round(clamp01(a) * 1000) / 1000})`;
}
export function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  const c = x.map((v, i) => Math.round(lerp(v, y[i], clamp01(t))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// --- Light ---------------------------------------------------------------------------------------------------------------

/** A soft round pool of light, fading to nothing at `r`. */
export function glow(g: Ctx, x: number, y: number, r: number, color: string, a: number, falloff = 0.35): void {
  if (a <= 0 || r <= 0) return;
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(color, a));
  grad.addColorStop(falloff, rgba(color, a * 0.45));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** A soft pool of light squashed to an ellipse. */
export function glowEllipse(g: Ctx, x: number, y: number, rx: number, ry: number, color: string, a: number, falloff = 0.35): void {
  if (a <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  glow(g, 0, 0, rx, color, a, falloff);
  g.restore();
}

/** A soft, flat cloud built from overlapping pools. */
export function cloud(g: Ctx, x: number, y: number, w: number, h: number, color: string, a: number, seed: number, lumps = 6): void {
  const r = rng(seed);
  for (let i = 0; i < lumps; i++) {
    const px = x + (i / (lumps - 1) - 0.5) * w * 0.8 + (r() - 0.5) * w * 0.1;
    const py = y + (r() - 0.5) * h * 0.35 - Math.sin((i / (lumps - 1)) * Math.PI) * h * 0.18;
    const rx = (w / lumps) * (1.1 + r() * 0.6);
    glowEllipse(g, px, py, rx, rx * (h / w) * 2.2, color, a * (0.6 + r() * 0.4), 0.5);
  }
}

/** A four-pointed glint with a soft bloom. */
export function spark(g: Ctx, x: number, y: number, r: number, color: string, a: number, rot = 0, bloom = true): void {
  if (a <= 0.002) return;
  if (bloom) glow(g, x, y, r * 2.4, color, a * 0.35);
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.beginPath();
  const k = r * 0.22;
  g.moveTo(0, -r);
  g.quadraticCurveTo(k, -k, r, 0);
  g.quadraticCurveTo(k, k, 0, r);
  g.quadraticCurveTo(-k, k, -r, 0);
  g.quadraticCurveTo(-k, -k, 0, -r);
  g.closePath();
  g.fillStyle = rgba(color, a);
  g.fill();
  g.restore();
}

/** A soft dot. */
export function dot(g: Ctx, x: number, y: number, r: number, color: string, a: number): void {
  if (a <= 0.002) return;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = rgba(color, a);
  g.fill();
}

// --- Shapes -------------------------------------------------------------------------------------------------------------

export function starPath(g: Ctx, x: number, y: number, r: number, points: number, inner: number, rot = -Math.PI / 2): void {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}

export function heartPath(g: Ctx, x: number, y: number, s: number): void {
  g.beginPath();
  g.moveTo(x, y + s * 0.9);
  g.bezierCurveTo(x - s * 1.3, y + s * 0.1, x - s * 1.05, y - s * 1.05, x - s * 0.32, y - s * 0.82);
  g.bezierCurveTo(x - s * 0.12, y - s * 0.74, x, y - s * 0.58, x, y - s * 0.45);
  g.bezierCurveTo(x, y - s * 0.58, x + s * 0.12, y - s * 0.74, x + s * 0.32, y - s * 0.82);
  g.bezierCurveTo(x + s * 1.05, y - s * 1.05, x + s * 1.3, y + s * 0.1, x, y + s * 0.9);
  g.closePath();
}

export function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A faceted crystal standing on its base at (x, base), `h` tall, leaning `tilt` radians. */
export function crystal(g: Ctx, x: number, base: number, w: number, h: number, tilt: number, body: string, light: string, dark: string, a = 1, inner = 0): void {
  if (a <= 0) return;
  g.save();
  g.translate(x, base);
  g.rotate(tilt);
  g.globalAlpha *= a;
  const top = -h;
  const shoulder = -h * 0.78;
  // Lit facet, body and shade.
  const facets: [string, [number, number][]][] = [
    [dark, [[0, 0], [w / 2, 0], [w / 2, shoulder], [0, top]]],
    [body, [[-w / 2, 0], [0, 0], [0, top], [-w / 2, shoulder]]],
    [light, [[-w * 0.18, 0], [w * 0.06, 0], [0, top], [-w * 0.3, shoulder]]],
  ];
  for (const [color, pts] of facets) {
    g.beginPath();
    pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.closePath();
    const grad = g.createLinearGradient(0, 0, 0, top);
    grad.addColorStop(0, rgba(color, 0.92));
    grad.addColorStop(1, rgba(mix(color, "#ffffff", 0.25), 0.98));
    g.fillStyle = grad;
    g.fill();
  }
  // The light inside, breathing.
  if (inner > 0) {
    g.globalCompositeOperation = "lighter";
    glowEllipse(g, 0, -h * 0.45, w * 0.55, h * 0.5, light, inner * 0.5, 0.4);
    g.globalCompositeOperation = "source-over";
  }
  // A rim on the lit edge.
  g.beginPath();
  g.moveTo(-w / 2, 0);
  g.lineTo(-w / 2, shoulder);
  g.lineTo(0, top);
  g.strokeStyle = rgba("#ffffff", 0.35);
  g.lineWidth = Math.max(1, w * 0.04);
  g.stroke();
  g.restore();
}

/** A coin seen at an angle: `turn` 0 → 1 is a whole spin (the face narrows, shows its rim, widens again). */
export function coin(g: Ctx, x: number, y: number, r: number, turn: number, a = 1, tilt = 0): void {
  if (a <= 0) return;
  const sx = Math.max(0.12, Math.abs(Math.cos(turn * TAU)));
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.globalAlpha *= a;
  g.scale(sx, 1);
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  const grad = g.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, "#fff3b0");
  grad.addColorStop(0.45, "#fbbf24");
  grad.addColorStop(1, "#b45309");
  g.fillStyle = grad;
  g.fill();
  g.beginPath();
  g.arc(0, 0, r * 0.72, 0, TAU);
  g.strokeStyle = "rgba(146,64,14,0.55)";
  g.lineWidth = r * 0.12;
  g.stroke();
  g.restore();
}

/** A gem: a cut stone with a table and a highlight. */
export function gem(g: Ctx, x: number, y: number, r: number, color: string, a = 1, rot = 0): void {
  if (a <= 0) return;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.globalAlpha *= a;
  g.beginPath();
  g.moveTo(-r, -r * 0.3);
  g.lineTo(-r * 0.55, -r * 0.8);
  g.lineTo(r * 0.55, -r * 0.8);
  g.lineTo(r, -r * 0.3);
  g.lineTo(0, r);
  g.closePath();
  const grad = g.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, mix(color, "#ffffff", 0.5));
  grad.addColorStop(0.5, color);
  grad.addColorStop(1, mix(color, "#000000", 0.45));
  g.fillStyle = grad;
  g.fill();
  g.beginPath();
  g.moveTo(-r * 0.55, -r * 0.3);
  g.lineTo(-r * 0.3, -r * 0.8);
  g.lineTo(r * 0.3, -r * 0.8);
  g.lineTo(r * 0.55, -r * 0.3);
  g.closePath();
  g.fillStyle = rgba("#ffffff", 0.3);
  g.fill();
  g.restore();
}

/**
 * Sparse particles drifting along straight paths, each fading in and out over its own journey: `k` journeys per idle,
 * so the field is seamless. `fn` places particle `i` (with its random numbers) at progress `p`, 0 → 1, and alpha.
 */
export function drift(t: Time, n: number, seed: number, k: number, fn: (i: number, p: number, fade: number, r: () => number) => void): void {
  for (let i = 0; i < n; i++) {
    const r = rng(seed * 977 + i * 31);
    const offset = r();
    // Whole journeys per idle, the same for every particle: a steady, even stream that loops exactly.
    const p = frac(k * t.u + offset);
    const fade = Math.sin(Math.PI * p) ** 1.5;
    fn(i, p, fade, r);
  }
}

/** A soft vertical streak (rain). */
export function streak(g: Ctx, x: number, y: number, len: number, angle: number, color: string, a: number, width = 1.5): void {
  if (a <= 0.002) return;
  const dx = Math.cos(angle) * len;
  const dy = Math.sin(angle) * len;
  const grad = g.createLinearGradient(x, y, x + dx, y + dy);
  grad.addColorStop(0, rgba(color, 0));
  grad.addColorStop(1, rgba(color, a));
  g.strokeStyle = grad;
  g.lineWidth = width;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + dx, y + dy);
  g.stroke();
}

/** Draw `fn` with a composite operation, restoring afterwards. */
export function blend(g: Ctx, op: GlobalCompositeOperation, fn: () => void): void {
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = op;
  fn();
  g.globalCompositeOperation = prev;
}

/** Draw `fn` at an opacity, restoring afterwards. */
export function fade(g: Ctx, a: number, fn: () => void): void {
  if (a <= 0) return;
  g.save();
  g.globalAlpha *= clamp01(a);
  fn();
  g.restore();
}

/** A linear gradient fill over a rect. */
export function linear(g: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const grad = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) grad.addColorStop(o, c);
  return grad;
}
