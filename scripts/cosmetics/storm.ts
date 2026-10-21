/**
 * Storm weather for the remade cosmetics: banks of rain cloud with lit tops and dark bellies, rain that falls along its
 * own slant, and lightning that is felt more than seen.
 *
 * Lightning here follows the calm rules in kit.ts: it is a slow swell of light inside a cloud (half a second up, a second
 * and a half or more back down) and, now and then, a thin distant bolt that draws itself out of the cloud and fades with
 * that light. Nothing pops, and the cloud it lights is dark to begin with, so the change in brightness stays small.
 * Every event sits at a fixed point in the idle, so the storm loops exactly.
 */
import { TAU, clamp01, frac, glowEllipse, lerp, linear, rgba, rng, smoother, type Ctx, type Time } from "./kit";

// --- Scratch layers ------------------------------------------------------------------------------------------------------

const pool = new Map<string, HTMLCanvasElement>();
/**
 * Draw `fn` into a clear offscreen layer the size of `g`'s canvas, then lay it onto `g` at `alpha` (with an optional
 * CSS filter). A cloud bank is built from many overlapping puffs; drawing them at full strength first and fading the
 * finished bank keeps its overlaps from showing as darker patches.
 */
export function layer(g: Ctx, key: string, alpha: number, filter: string, fn: (l: Ctx) => void): void {
  if (alpha <= 0) return;
  const { width, height } = g.canvas;
  let c = pool.get(key);
  if (!c || c.width !== width || c.height !== height) {
    c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    pool.set(key, c);
  }
  const l = c.getContext("2d")!;
  l.save();
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.clearRect(0, 0, width, height);
  l.restore();
  l.save();
  fn(l);
  l.restore();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha *= clamp01(alpha);
  if (filter) g.filter = filter;
  g.drawImage(c, 0, 0);
  g.restore();
}

// --- Cloud ---------------------------------------------------------------------------------------------------------------

export interface Bank {
  seed: number;
  /** Left and right ends of the bank. */
  x0: number;
  x1: number;
  /**
   * The edge the bank hangs from (or, with `rise`, sits on). The cloud is solid on that side of the line, out past the
   * edge of the picture, and its billows reach `height` beyond it.
   */
  base: number;
  height: number;
  /** Billows grow upwards from the base instead of hanging below it. */
  rise?: boolean;
  /** Fill solidly behind the base line, for a bank that spans the whole width. */
  solid?: boolean;
  puffs: number;
  rMin: number;
  rMax: number;
  /** Deep in the cloud, its body, and the lit edge of its billows. */
  deep: string;
  body: string;
  edge: string;
  /** Pixels of slow side-to-side drift, and its phase in the idle. */
  sway?: number;
  phase?: number;
  /** How much each puff swells and shrinks (a fraction of its radius), so the bank seems to churn. */
  boil?: number;
}

/** The puffs of a bank at this moment: the same billows every frame, each churning in its own time. */
export function bankPuffs(t: Time, b: Bank): { x: number; y: number; r: number }[] {
  const r = rng(b.seed);
  const out: { x: number; y: number; r: number }[] = [];
  const dx = (b.sway ?? 0) * t.wave(1, b.phase ?? 0);
  const dir = b.rise ? -1 : 1;
  for (let i = 0; i < b.puffs; i++) {
    const s = (i + r()) / b.puffs;
    // Deeper in the middle of the bank, shallower towards its ends; most billows near the base, a few reaching far.
    const swell = 0.55 + 0.45 * Math.sin(Math.PI * s);
    const out1 = Math.pow(r(), 1.5);
    const rad = Math.max(2, lerp(b.rMin, b.rMax, r()) * (0.75 + 0.25 * swell));
    // A billow never strays further from the bank than it is big, so none floats off on its own.
    const reachOut = out1 * Math.min(b.height * swell, rad * 1.25);
    const ph = r();
    const ph2 = r();
    const k = r() < 0.5 ? 1 : 2;
    const rr = rad * (1 + (b.boil ?? 0.05) * t.wave(k, ph));
    out.push({ x: lerp(b.x0, b.x1, s) + dx + 5 * t.wave(1, ph2), y: b.base + dir * reachOut + 3 * t.wave(1, ph2 + 0.25), r: rr });
  }
  return out;
}

/**
 * Paint a bank of cloud: soft billows merged into one mass, dark deep inside and paler towards its free edge, each
 * billow given a shadow where it tucks under the next and a soft lit rim, so the bank reads as heaped, rolling cloud.
 */
export function paintBank(l: Ctx, t: Time, b: Bank): void {
  const puffs = bankPuffs(t, b);
  const dir = b.rise ? -1 : 1;
  const far = b.base + dir * (b.height + b.rMax);
  // The mass: soft discs, solid in the middle, merging into one shape.
  if (b.solid) {
    l.fillStyle = "#ffffff";
    l.fillRect(-1000, dir > 0 ? b.base - 2000 : b.base, 4000, 2000);
  }
  for (const p of puffs) {
    const grad = l.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.6, "rgba(255,255,255,0.97)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    l.fillStyle = grad;
    l.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
  }
  l.save();
  l.globalCompositeOperation = "source-atop";
  // Shading: deep at the base, paler out at the billows' edge.
  l.fillStyle = linear(l, 0, b.base - dir * b.rMax, 0, far, [[0, b.deep], [0.45, b.body], [1, b.edge]]);
  l.fillRect(-1000, -2000, 4000, 6000);
  // Each billow: a shadow where it tucks into the bank, then a lit rim on its free side.
  for (const p of puffs) {
    const sy = p.y - dir * p.r * 0.5;
    const sg = l.createRadialGradient(p.x, sy, 0, p.x, sy, p.r * 0.9);
    sg.addColorStop(0, rgba(b.deep, 0.5));
    sg.addColorStop(1, rgba(b.deep, 0));
    l.fillStyle = sg;
    l.fillRect(p.x - p.r, sy - p.r, p.r * 2, p.r * 2);
  }
  for (const p of puffs) {
    const cx = p.x - p.r * 0.18;
    const cy = p.y + dir * p.r * 0.32;
    const hg = l.createRadialGradient(cx, cy, 0, cx, cy, p.r * 0.75);
    hg.addColorStop(0, rgba(b.edge, 0.55));
    hg.addColorStop(1, rgba(b.edge, 0));
    l.fillStyle = hg;
    l.fillRect(cx - p.r, cy - p.r, p.r * 2, p.r * 2);
  }
  l.restore();
}

/**
 * Curtains of heavier rain hanging under a cloud: soft slanted shafts, darker than the air, fading towards the ground
 * and swaying slowly.
 */
export function rainShafts(g: Ctx, t: Time, shafts: { x: number; w: number; phase: number }[], top: number, bottom: number, slant: number, color: string, a: number): void {
  if (a <= 0) return;
  g.save();
  g.filter = "blur(14px)";
  for (const s of shafts) {
    const lean = Math.tan(slant) * (bottom - top);
    const x = s.x + 10 * t.wave(1, s.phase);
    g.beginPath();
    g.moveTo(x - s.w / 2, top);
    g.lineTo(x + s.w / 2, top);
    g.lineTo(x + s.w / 2 + lean, bottom);
    g.lineTo(x - s.w / 2 + lean, bottom);
    g.closePath();
    g.fillStyle = linear(g, 0, top, 0, bottom, [[0, rgba(color, a * (0.8 + 0.2 * t.swell(1, s.phase)))], [1, rgba(color, 0)]]);
    g.fill();
  }
  g.restore();
}

// --- Lightning -----------------------------------------------------------------------------------------------------------

/**
 * One lightning event, as a 0 → 1 → 0 envelope: it starts at `at` (a point in the idle, 0 → 1), rises over `attack`
 * seconds, holds, and dies away over `decay` seconds, every curve eased at both ends. Zero the rest of the idle.
 */
export function strike(t: Time, at: number, attack = 0.55, hold = 0.15, decay = 1.8): number {
  const s = frac(t.u - at) * t.idle;
  if (s < attack) return smoother(s / attack);
  if (s < attack + hold) return 1;
  if (s < attack + hold + decay) return 1 - smoother((s - attack - hold) / decay);
  return 0;
}

/** How far a bolt has drawn itself out at the moment of a strike: it grows over the attack, and is then whole. */
export function reach(t: Time, at: number, grow = 0.4): number {
  const s = frac(t.u - at) * t.idle;
  return smoother(s / grow);
}

export type Pt = [number, number];

/** A jagged path from `from` to `to` by repeated midpoint displacement: the same path from the same seed. */
export function boltPath(seed: number, from: Pt, to: Pt, jag = 0.22, depth = 5): Pt[] {
  const r = rng(seed);
  let pts: Pt[] = [from, to];
  let amp = jag * Math.hypot(to[0] - from[0], to[1] - from[1]);
  for (let d = 0; d < depth; d++) {
    const next: Pt[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = (r() - 0.5) * amp;
      next.push([(ax + bx) / 2 + (-(by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], pts[i]);
    }
    pts = next;
    amp *= 0.55;
  }
  return pts;
}

export interface Bolt {
  main: Pt[];
  /** Forks: each starts where it leaves the main channel, at `from` (0 → 1 along it). */
  forks: { from: number; pts: Pt[] }[];
}

/** A bolt with a few forks peeling off it. */
export function makeBolt(seed: number, from: Pt, to: Pt, forks = 3, jag = 0.22, forkLen = 1): Bolt {
  const main = boltPath(seed, from, to, jag);
  const r = rng(seed + 57);
  const dir = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const out: Bolt["forks"] = [];
  for (let i = 0; i < forks; i++) {
    const at = 0.18 + r() * 0.55;
    const start = main[Math.round(at * (main.length - 1))];
    const ang = dir + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.45);
    const fl = len * (0.16 + r() * 0.2) * forkLen;
    out.push({ from: at, pts: boltPath(seed + 11 + i * 7, start, [start[0] + Math.cos(ang) * fl, start[1] + Math.sin(ang) * fl], 0.3, 4) });
  }
  return { main, forks: out };
}

/** The part of a path from its start to `s` (0 → 1) of its length. */
function partOf(pts: Pt[], s: number): Pt[] {
  if (s >= 1) return pts;
  if (s <= 0) return [];
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const want = lens[lens.length - 1] * s;
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (lens[i] <= want) {
      out.push(pts[i]);
      continue;
    }
    const k = (want - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    out.push([lerp(pts[i - 1][0], pts[i][0], k), lerp(pts[i - 1][1], pts[i][1], k)]);
    break;
  }
  return out;
}

function strokePath(g: Ctx, pts: Pt[], color: string, a: number, width: number): void {
  if (pts.length < 2 || a <= 0.002) return;
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = rgba(color, a);
  g.lineWidth = width;
  g.stroke();
}

/**
 * Draw a bolt `s` of the way out (0 → 1) at strength `a`: a wide soft halo, a narrower glow, and a thin pale core. The
 * halo is laid down normally, so it shows on a light card as well as a dark one; the glow and core add light.
 */
export function drawBolt(g: Ctx, bolt: Bolt, s: number, a: number, halo: string, core: string, scale = 1): void {
  if (a <= 0.002 || s <= 0) return;
  const parts: [Pt[], number][] = [[partOf(bolt.main, s), 1]];
  for (const f of bolt.forks) if (s > f.from) parts.push([partOf(f.pts, (s - f.from) / (1 - f.from)), 0.6]);
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  g.filter = `blur(${6 * scale}px)`;
  for (const [pts, w] of parts) strokePath(g, pts, halo, a * 0.32 * w, 10 * scale * w);
  g.filter = "none";
  g.globalCompositeOperation = "lighter";
  g.filter = `blur(${1.6 * scale}px)`;
  for (const [pts, w] of parts) strokePath(g, pts, halo, a * 0.55 * w, 4 * scale * w);
  g.filter = "none";
  for (const [pts, w] of parts) strokePath(g, pts, core, a * 0.9 * w, Math.max(0.8, 1.6 * scale * w));
  g.restore();
}

/** Light diffusing through cloud: laid over what is already there ("source-atop"), so it lights only the cloud. */
export function cloudLight(l: Ctx, x: number, y: number, rx: number, ry: number, color: string, a: number): void {
  if (a <= 0.002) return;
  l.save();
  l.globalCompositeOperation = "source-atop";
  glowEllipse(l, x, y, rx, ry, color, a, 0.45);
  l.restore();
}

// --- Rain ----------------------------------------------------------------------------------------------------------------

export interface Rain {
  n: number;
  seed: number;
  /** Whole journeys per idle: the speed of the fall. */
  k: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  len: number;
  width: number;
  color: string;
  alpha: number;
  /** The slant of the fall from vertical, in radians (positive leans down and to the right). */
  slant: number;
  /** Strength at a point, 0 → 1 (to thin the rain over the middle of a card, say). */
  weight?: (x: number, y: number) => number;
}

/** Rain: streaks that fall along their own slant, each bright at its head and fading towards its tail. */
export function rain(g: Ctx, t: Time, o: Rain): void {
  const sx = Math.sin(o.slant);
  const sy = Math.cos(o.slant);
  const run = (o.bottom - o.top) * Math.tan(o.slant);
  g.save();
  g.lineCap = "round";
  for (let i = 0; i < o.n; i++) {
    const r = rng(o.seed * 977 + i * 31);
    const offset = r();
    const p = frac(o.k * t.u + offset);
    const f = Math.sin(Math.PI * p) ** 0.6;
    const y = lerp(o.top, o.bottom, p);
    // Start far enough upwind that the slant carries the drop across the whole span.
    const x = lerp(o.x0 - run, o.x1, r()) + (y - o.top) * Math.tan(o.slant);
    const len = o.len * (0.75 + r() * 0.5);
    const a = o.alpha * f * (0.7 + r() * 0.3) * (o.weight ? o.weight(x, y) : 1);
    if (a <= 0.004) continue;
    const tx = x - sx * len;
    const ty = y - sy * len;
    const grad = g.createLinearGradient(tx, ty, x, y);
    grad.addColorStop(0, rgba(o.color, 0));
    grad.addColorStop(1, rgba(o.color, a));
    g.strokeStyle = grad;
    g.lineWidth = o.width;
    g.beginPath();
    g.moveTo(tx, ty);
    g.lineTo(x, y);
    g.stroke();
  }
  g.restore();
}

/** Rings where rain lands: each spreads and fades. `k` rings per idle each. */
export function splashes(g: Ctx, t: Time, n: number, seed: number, k: number, x0: number, x1: number, y0: number, y1: number, color: string, alpha: number): void {
  for (let i = 0; i < n; i++) {
    const r = rng(seed * 977 + i * 31);
    const p = frac(k * t.u + r());
    const x = lerp(x0, x1, r());
    const y = lerp(y0, y1, r());
    const rad = 3 + p * (14 + r() * 10);
    const a = alpha * (1 - p) * Math.min(1, p * 8);
    if (a <= 0.004) continue;
    g.beginPath();
    g.ellipse(x, y, rad, rad * 0.28, 0, 0, TAU);
    g.strokeStyle = rgba(color, a);
    g.lineWidth = 1.2;
    g.stroke();
  }
}
