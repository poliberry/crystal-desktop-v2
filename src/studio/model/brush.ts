import { hash01 } from "@/studio/model/fx";
import { cubicAt, contourRanges, isCurve, segmentCubic, type Pt } from "@/studio/model/path";
import type { Brush, BrushType, PathPoint } from "@/studio/model/types";

/**
 * Brushes: a stroke that isn't a constant-width line. Tapered and calligraphic strokes are ribbons whose
 * width follows the path; chalk, spray and the shape brushes (dots, stars, hearts, sparkles) are many
 * small stamps laid along it.
 *
 * Everything here is plain geometry on arrays, in the path's own units, with no canvas: a brush turns a
 * flattened outline into polygons, and `fx-render.ts` fills them with the stroke's paint — a colour, a
 * gradient or a material — so a brush is simply another way of drawing the stroke. The same brush and the
 * same `seed` always give the same marks, so a design renders identically every time.
 *
 * Also here: turning a freehand drag into a clean Bézier path (`fitFreehand`).
 */

export const BRUSH_LABEL: Record<BrushType, string> = {
  taper: "Tapered",
  calligraphy: "Calligraphy",
  ink: "Ink",
  chalk: "Chalk",
  spray: "Spray",
  dots: "Dots",
  stars: "Stars",
  hearts: "Hearts",
  sparkles: "Sparkles",
};
export const BRUSH_TYPES = Object.keys(BRUSH_LABEL) as BrushType[];

/** What each brush's settings do, so the panel shows only those that matter. */
export const BRUSH_USES: Record<BrushType, { taper: boolean; angle: boolean; spacing: boolean; jitter: boolean }> = {
  taper: { taper: true, angle: false, spacing: false, jitter: false },
  calligraphy: { taper: false, angle: true, spacing: false, jitter: false },
  ink: { taper: true, angle: false, spacing: false, jitter: true },
  chalk: { taper: false, angle: false, spacing: false, jitter: true },
  spray: { taper: false, angle: false, spacing: false, jitter: true },
  dots: { taper: false, angle: false, spacing: true, jitter: true },
  stars: { taper: false, angle: false, spacing: true, jitter: true },
  hearts: { taper: false, angle: false, spacing: true, jitter: true },
  sparkles: { taper: false, angle: false, spacing: true, jitter: true },
};

export const DEFAULT_BRUSH: Record<BrushType, Omit<Brush, "type">> = {
  taper: { taper: 0.6, angle: 45, spacing: 1, jitter: 0.3, seed: 1 },
  calligraphy: { taper: 0.6, angle: 40, spacing: 1, jitter: 0.3, seed: 1 },
  ink: { taper: 0.35, angle: 45, spacing: 1, jitter: 0.5, seed: 1 },
  chalk: { taper: 0.6, angle: 45, spacing: 1, jitter: 0.6, seed: 1 },
  spray: { taper: 0.6, angle: 45, spacing: 1, jitter: 0.6, seed: 1 },
  dots: { taper: 0.6, angle: 45, spacing: 1.4, jitter: 0.3, seed: 1 },
  stars: { taper: 0.6, angle: 45, spacing: 1.6, jitter: 0.4, seed: 1 },
  hearts: { taper: 0.6, angle: 45, spacing: 1.7, jitter: 0.3, seed: 1 },
  sparkles: { taper: 0.6, angle: 45, spacing: 1.8, jitter: 0.5, seed: 1 },
};
export const defaultBrush = (type: BrushType): Brush => ({ type, ...DEFAULT_BRUSH[type] });

/** A brush from a file or a hand-edited value: clamped, and `undefined` if it isn't a brush we know. */
export function cleanBrush(raw: unknown): Brush | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (!BRUSH_TYPES.includes(r.type as BrushType)) return undefined;
  const d = DEFAULT_BRUSH[r.type as BrushType];
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
  return {
    type: r.type as BrushType,
    taper: num(r.taper, 0, 1, d.taper),
    angle: num(r.angle, -360, 360, d.angle),
    spacing: num(r.spacing, 0.3, 6, d.spacing),
    jitter: num(r.jitter, 0, 1, d.jitter),
    seed: Math.round(num(r.seed, 0, 99999, 1)),
  };
}

/** The most marks one stroke may have: a long chalk line must not become a million dots. */
export const MAX_STAMPS = 12000;
/** The most points one line is walked in. */
export const MAX_SAMPLES = 6000;

// --- Flattening -------------------------------------------------------------------------------

/** One outline as lines: every contour of the path, curves cut into short straight pieces. `w`,`h` are the node's box. */
export function flattenPath(points: PathPoint[], closed: boolean, w: number, h: number, step = 2): Pt[][] {
  const out: Pt[][] = [];
  const P = (p: Pt): Pt => ({ x: p.x * w, y: p.y * h });
  for (const [s, e] of contourRanges(points)) {
    const line: Pt[] = [P(points[s])];
    const seg = (a: PathPoint, b: PathPoint) => {
      if (isCurve(a, b)) {
        const c = segmentCubic(a, b);
        const chord = Math.hypot((c[3].x - c[0].x) * w, (c[3].y - c[0].y) * h);
        const hull = Math.hypot((c[1].x - c[0].x) * w, (c[1].y - c[0].y) * h) + Math.hypot((c[2].x - c[1].x) * w, (c[2].y - c[1].y) * h) + Math.hypot((c[3].x - c[2].x) * w, (c[3].y - c[2].y) * h);
        const n = Math.max(2, Math.min(400, Math.ceil(((chord + hull) / 2) / Math.max(0.25, step))));
        for (let i = 1; i <= n; i++) line.push(P(cubicAt(c, i / n)));
      } else line.push(P(b));
    };
    for (let i = s; i < e; i++) seg(points[i], points[i + 1]);
    if (closed && e > s) seg(points[e], points[s]);
    out.push(line);
  }
  return out;
}

export interface Sample extends Pt {
  /** Distance along the line from its start. */
  s: number;
  /** Unit direction of travel here. */
  tx: number;
  ty: number;
}

/** A line as evenly spaced samples `step` apart (the last is the true end), each with its direction. */
export function resample(line: Pt[], step: number): { samples: Sample[]; length: number } {
  const pts: Pt[] = [];
  for (const p of line) if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 1e-9) pts.push(p);
  if (pts.length < 2) return { samples: [], length: 0 };
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const length = cum[cum.length - 1];
  // A very long line is sampled more coarsely rather than into hundreds of thousands of points.
  const n = Math.max(1, Math.min(MAX_SAMPLES, Math.ceil(length / Math.max(1e-3, step))));
  const raw: Pt[] = [];
  const ss: number[] = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const s = (length * i) / n;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const span = cum[k + 1] - cum[k] || 1;
    const t = (s - cum[k]) / span;
    raw.push({ x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t });
    ss.push(s);
  }
  const samples = raw.map((p, i): Sample => {
    // Direction over a few neighbours, so a small kink in the line doesn't flip the ribbon.
    const a = raw[Math.max(0, i - 2)];
    const b = raw[Math.min(raw.length - 1, i + 2)];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x, y: p.y, s: ss[i], tx: (b.x - a.x) / d, ty: (b.y - a.y) / d };
  });
  return { samples, length };
}

// --- Marks --------------------------------------------------------------------------------------

const rnd = (i: number, seed: number) => hash01(i, seed);
const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function circle(cx: number, cy: number, r: number, n = 12): Pt[] {
  return Array.from({ length: n }, (_, i) => ({ x: cx + Math.cos((i / n) * Math.PI * 2) * r, y: cy + Math.sin((i / n) * Math.PI * 2) * r }));
}

/** The outline of one stamp of a shape brush, centred on (cx,cy) and `size` across, turned `rot` radians. */
export function stampShape(type: BrushType, cx: number, cy: number, size: number, rot: number): Pt[] {
  const r = size / 2;
  const turn = (x: number, y: number): Pt => ({ x: cx + (x * Math.cos(rot) - y * Math.sin(rot)) * r, y: cy + (x * Math.sin(rot) + y * Math.cos(rot)) * r });
  switch (type) {
    case "stars": {
      const out: Pt[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 ? 0.45 : 1;
        out.push(turn(Math.cos(a) * k, Math.sin(a) * k));
      }
      return out;
    }
    case "hearts": {
      const out: Pt[] = [];
      for (let i = 0; i < 24; i++) {
        const t = (i / 24) * Math.PI * 2;
        // The classic heart curve, scaled to fit a unit box and flipped so the point is down.
        const x = (16 * Math.sin(t) ** 3) / 16;
        const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16;
        out.push(turn(x, y));
      }
      return out;
    }
    case "sparkles": {
      const out: Pt[] = [];
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 4;
        const k = i % 2 ? 0.2 : 1;
        out.push(turn(Math.cos(a) * k, Math.sin(a) * k));
      }
      return out;
    }
    default:
      return Array.from({ length: 12 }, (_, i) => turn(Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)));
  }
}

/** Width multiplier at distance `s` along a line of `length`: 0 at the very ends, 1 past the taper. */
export function taperAt(s: number, length: number, taper: number): number {
  if (taper <= 0 || length <= 0) return 1;
  const span = Math.max(1e-6, Math.min(length / 2, length * 0.5 * taper));
  return smoothstep(Math.min(s, length - s) / span);
}

/** Fraction of the rounded cap a ribbon's ends keep: a tapered stroke ends in a point, the others stay blunt. */
function ribbon(samples: Sample[], widthAt: (i: number, s: Sample) => number): Pt[] {
  const left: Pt[] = [];
  const right: Pt[] = [];
  samples.forEach((p, i) => {
    const half = Math.max(0, widthAt(i, p)) / 2;
    left.push({ x: p.x - p.ty * half, y: p.y + p.tx * half });
    right.push({ x: p.x + p.ty * half, y: p.y - p.tx * half });
  });
  return [...left, ...right.reverse()];
}

/**
 * The marks of a brush along one flattened line, as polygons to fill (nonzero) in the stroke's paint.
 * `width` is the stroke weight. Pure and repeatable: `seed` is all the randomness there is.
 */
export function brushMarks(line: Pt[], brush: Brush, width: number): Pt[][] {
  const W = Math.max(0.5, width);
  const seed = brush.seed | 0;
  const polys: Pt[][] = [];

  if (brush.type === "taper" || brush.type === "ink" || brush.type === "calligraphy") {
    const { samples, length } = resample(line, Math.max(0.5, Math.min(4, W / 4)));
    if (samples.length < 2) return [];
    if (brush.type === "calligraphy") {
      // A flat nib held at a fixed angle: each step sweeps the nib's edge, so thickness follows direction.
      const a = (brush.angle * Math.PI) / 180;
      const nx = (Math.cos(a) * W) / 2;
      const ny = (Math.sin(a) * W) / 2;
      for (let i = 1; i < samples.length; i++) {
        const p = samples[i - 1];
        const q = samples[i];
        polys.push([
          { x: p.x - nx, y: p.y - ny },
          { x: p.x + nx, y: p.y + ny },
          { x: q.x + nx, y: q.y + ny },
          { x: q.x - nx, y: q.y - ny },
        ]);
      }
      return polys;
    }
    const ink = brush.type === "ink";
    const wob = (s: number) => {
      // Slow variation in pressure, as a real pen has: value noise along the line.
      const t = s / (W * 3);
      const i = Math.floor(t);
      const f = smoothstep(t - i);
      return rnd(i, seed) * (1 - f) + rnd(i + 1, seed) * f;
    };
    const width1 = (s: number) => {
      const body = ink ? 1 - brush.jitter * 0.7 * (1 - wob(s)) : 1;
      // An inked line keeps a little width at its ends; a tapered one ends in a point.
      const end = taperAt(s, length, brush.taper);
      return W * body * (ink ? 0.18 + 0.82 * end : end);
    };
    polys.push(ribbon(samples, (_, p) => width1(p.s)));
    for (const end of [samples[0], samples[samples.length - 1]]) {
      const r = width1(end.s) / 2;
      if (r > 0.25) polys.push(circle(end.x, end.y, r));
    }
    return polys;
  }

  // Stamped brushes.
  const gap = brush.type === "chalk" ? W * 0.1 : brush.type === "spray" ? W * 0.12 : Math.max(0.4, brush.spacing) * W;
  const { samples } = resample(line, Math.max(0.4, gap));
  let count = 0;
  const push = (poly: Pt[]) => {
    if (count++ < MAX_STAMPS) polys.push(poly);
  };
  samples.forEach((p, i) => {
    const r = (k: number) => rnd(i * 7 + k, seed + k * 101);
    if (brush.type === "chalk") {
      // Dry, grainy: a few specks across the stroke's width, some skipped, so the surface shows through.
      const specks = 4;
      for (let k = 0; k < specks; k++) {
        if (r(k + 10) < 0.25 + 0.5 * brush.jitter) continue;
        const across = (r(k) - 0.5) * W;
        const along = (r(k + 20) - 0.5) * gap;
        push(circle(p.x - p.ty * across + p.tx * along, p.y + p.tx * across + p.ty * along, W * (0.03 + 0.07 * r(k + 30)), 6));
      }
    } else if (brush.type === "spray") {
      const specks = 5;
      for (let k = 0; k < specks; k++) {
        // Denser in the middle: the product of two random numbers crowds towards the centre.
        const rad = (W / 2) * r(k) * r(k + 40) * (0.4 + brush.jitter);
        const ang = r(k + 50) * Math.PI * 2;
        push(circle(p.x + Math.cos(ang) * rad * 2.2, p.y + Math.sin(ang) * rad * 2.2, W * (0.015 + 0.03 * r(k + 60)), 5));
      }
    } else {
      const size = W * (1 - brush.jitter * 0.6 * r(1));
      // A little turn per mark, more with more jitter; dots are round so turning them shows nothing.
      const rot = brush.type === "dots" ? 0 : (r(2) - 0.5) * brush.jitter * Math.PI * 1.2;
      const ox = (r(3) - 0.5) * brush.jitter * W * 0.3;
      const oy = (r(4) - 0.5) * brush.jitter * W * 0.3;
      push(stampShape(brush.type, p.x + ox, p.y + oy, size, rot));
    }
  });
  return polys;
}

/** A polygon wound the same way as every other (positive area), so many of them filled together never cancel where they overlap. */
export function orient(poly: Pt[]): Pt[] {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    a += poly[i].x * q.y - q.x * poly[i].y;
  }
  return a < 0 ? poly.slice().reverse() : poly;
}

/** Everything a brush draws for a path: every contour's marks, flattened at a step that suits the width. */
export function brushPolygons(points: PathPoint[], closed: boolean, w: number, h: number, brush: Brush, width: number): Pt[][] {
  const lines = flattenPath(points, closed, w, h, Math.max(0.75, Math.min(6, width / 4)));
  return lines.flatMap((l) => brushMarks(l, brush, width));
}

/** How far a brush's marks can reach from the line, per unit of width: the slack the picture needs round the box. */
export function brushReach(brush: Brush): number {
  switch (brush.type) {
    case "calligraphy":
      return 0.75;
    case "spray":
      // Specks fall up to 1.1·(0.4 + jitter) widths from the line, plus the speck itself.
      return 1.1 * (0.4 + brush.jitter) + 0.06;
    case "stars":
    case "hearts":
    case "sparkles":
    case "dots":
      return 0.65;
    default:
      return 0.6;
  }
}

// --- Freehand ---------------------------------------------------------------------------------

/** Ramer–Douglas–Peucker: the fewest of the points that stay within `tol` of the line. */
export function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    const A = pts[a];
    const B = pts[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    for (let i = a + 1; i < b; i++) {
      const d = len < 1e-9 ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y) : Math.abs((pts[i].x - A.x) * dy - (pts[i].y - A.y) * dx) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol && at > 0) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * A rough drag of the pointer as a clean path: near-duplicate points dropped, the rest simplified to within
 * `tol`, then joined by smooth curves — except at sharp turns, which stay corners as the person drew them.
 * Points are in the frame of the drag; the result is ready for `makePathFromWorld`.
 */
export function fitFreehand(raw: Pt[], tol: number): PathPoint[] {
  const pts: Pt[] = [];
  for (const p of raw) if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 1e-6) pts.push(p);
  if (pts.length < 2) return [];
  const s = simplify(pts, Math.max(0.01, tol));
  if (s.length === 2) return s.map((p): PathPoint => ({ x: p.x, y: p.y }));
  const out: PathPoint[] = s.map((p): PathPoint => ({ x: p.x, y: p.y }));
  for (let i = 1; i < s.length - 1; i++) {
    const a = s[i - 1], p = s[i], b = s[i + 1];
    const d1 = Math.hypot(p.x - a.x, p.y - a.y);
    const d2 = Math.hypot(b.x - p.x, b.y - p.y);
    const ux = (p.x - a.x) / d1, uy = (p.y - a.y) / d1;
    const vx = (b.x - p.x) / d2, vy = (b.y - p.y) / d2;
    // A turn of more than ~70° is a corner the person meant.
    if (ux * vx + uy * vy < 0.34) continue;
    let tx = b.x - a.x, ty = b.y - a.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    out[i].inX = p.x - tx * (d1 / 3);
    out[i].inY = p.y - ty * (d1 / 3);
    out[i].outX = p.x + tx * (d2 / 3);
    out[i].outY = p.y + ty * (d2 / 3);
  }
  // The ends lean into the curve they join, so a stroke doesn't start with a kink. Where the neighbour is a
  // corner the segment stays a plain straight line.
  if (out[1].inX !== undefined) {
    out[0].outX = out[0].x + (out[1].inX - out[0].x) * 0.66;
    out[0].outY = out[0].y + (out[1].inY! - out[0].y) * 0.66;
  }
  const n = out.length - 1;
  if (out[n - 1].outX !== undefined) {
    out[n].inX = out[n].x + (out[n - 1].outX! - out[n].x) * 0.66;
    out[n].inY = out[n].y + (out[n - 1].outY! - out[n].y) * 0.66;
  }
  return out;
}
