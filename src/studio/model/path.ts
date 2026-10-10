import type { PathNode, PathPoint } from "@/studio/model/types";

/**
 * Vector paths, without a DOM: building an outline from anchors, measuring it, editing it, and
 * fitting the node's box around it. Everything here works on plain numbers so it can be tested.
 *
 * A path's anchors are stored as fractions of its node's box (0..1), so moving, resizing and turning
 * the node moves the outline with it. Editing works in "local pixels": the node's own un-turned
 * frame, with (0,0) its top-left corner and (w,h) its bottom-right.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Fewest units a path's box may be across: a straight horizontal line still has a box to select and resize. */
export const MIN_EXTENT = 1;

const hasOut = (p: PathPoint) => p.outX !== undefined && p.outY !== undefined;
const hasIn = (p: PathPoint) => p.inX !== undefined && p.inY !== undefined;
const outOf = (p: PathPoint): Pt => (hasOut(p) ? { x: p.outX!, y: p.outY! } : { x: p.x, y: p.y });
const inOf = (p: PathPoint): Pt => (hasIn(p) ? { x: p.inX!, y: p.inY! } : { x: p.x, y: p.y });

/** Whether the segment from `a` to `b` is curved (either end has a handle on that side). */
export const isCurve = (a: PathPoint, b: PathPoint) => hasOut(a) || hasIn(b);

const num = (n: number) => +n.toFixed(3);

/** Index ranges [first, last] of each contour. A plain path has one; a compound path several. */
export function contourRanges(points: PathPoint[]): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || points[i].m) {
      out.push([start, i - 1]);
      start = i;
    }
  }
  return points.length ? out : [];
}

/** Every segment as the indices of the anchors it runs between, closing segments included. */
export function segmentsOf(points: PathPoint[], closed: boolean): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of contourRanges(points)) {
    for (let i = s; i < e; i++) out.push([i, i + 1]);
    if (closed && e > s) out.push([e, s]);
  }
  return out;
}

export const isCompound = (points: PathPoint[]) => points.some((p) => p.m);

/** The SVG path data for `points` drawn in a w×h box. Used by the editor's SVG and by `Path2D` when rendering. */
export function pathD(points: PathPoint[], closed: boolean, w: number, h: number): string {
  if (points.length === 0) return "";
  const X = (v: number) => num(v * w);
  const Y = (v: number) => num(v * h);
  let d = "";
  for (const [s, e] of contourRanges(points)) {
    d += `${d ? " " : ""}M${X(points[s].x)} ${Y(points[s].y)}`;
    const seg = (a: PathPoint, b: PathPoint) => {
      if (isCurve(a, b)) {
        const o = outOf(a);
        const i = inOf(b);
        d += `C${X(o.x)} ${Y(o.y)} ${X(i.x)} ${Y(i.y)} ${X(b.x)} ${Y(b.y)}`;
      } else d += `L${X(b.x)} ${Y(b.y)}`;
    };
    for (let i = s; i < e; i++) seg(points[i], points[i + 1]);
    if (closed && e > s) {
      seg(points[e], points[s]);
      d += "Z";
    }
  }
  return d;
}

// --- Curves -------------------------------------------------------------------------------------

type Cubic = [Pt, Pt, Pt, Pt];

export function segmentCubic(a: PathPoint, b: PathPoint): Cubic {
  return [{ x: a.x, y: a.y }, outOf(a), inOf(b), { x: b.x, y: b.y }];
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function cubicAt([p0, p1, p2, p3]: Cubic, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** The t values in (0,1) where one coordinate of a cubic is at an extreme: roots of its derivative. */
function extrema(a: number, b: number, c: number, d: number): number[] {
  // B'(t)/3 = (-a+3b-3c+d)t² + (2a-4b+2c)t + (b-a)
  const qa = -a + 3 * b - 3 * c + d;
  const qb = 2 * (a - 2 * b + c);
  const qc = b - a;
  const out: number[] = [];
  if (Math.abs(qa) < 1e-12) {
    if (Math.abs(qb) > 1e-12) out.push(-qc / qb);
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-qb + s) / (2 * qa), (-qb - s) / (2 * qa));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** The tight box around a path's curves (not its anchors alone): where the outline really reaches. */
export function curveBounds(points: Pt[] | PathPoint[], closed: boolean): { x0: number; y0: number; x1: number; y1: number } | null {
  const pts = points as PathPoint[];
  if (pts.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (p: Pt) => {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  };
  for (const p of pts) take(p);
  for (const [ai, bi] of segmentsOf(pts, closed)) {
    const a = pts[ai];
    const b = pts[bi];
    if (!isCurve(a, b)) continue;
    const c = segmentCubic(a, b);
    for (const t of [...extrema(c[0].x, c[1].x, c[2].x, c[3].x), ...extrema(c[0].y, c[1].y, c[2].y, c[3].y)]) take(cubicAt(c, t));
  }
  return { x0, y0, x1, y1 };
}

/**
 * Normalise anchors given in any pixel frame into a node box: the tight bounds of the outline
 * become the box, and every anchor and handle is re-expressed as a fraction of it. A flat path
 * (a straight horizontal or vertical line) gets a box `MIN_EXTENT` across, centred on it.
 */
export function normalizePoints(points: PathPoint[], closed: boolean): { x0: number; y0: number; w: number; h: number; points: PathPoint[] } {
  const b = curveBounds(points, closed) ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
  let w = b.x1 - b.x0;
  let h = b.y1 - b.y0;
  let x0 = b.x0;
  let y0 = b.y0;
  if (w < MIN_EXTENT) {
    x0 -= (MIN_EXTENT - w) / 2;
    w = MIN_EXTENT;
  }
  if (h < MIN_EXTENT) {
    y0 -= (MIN_EXTENT - h) / 2;
    h = MIN_EXTENT;
  }
  const nx = (v: number) => (v - x0) / w;
  const ny = (v: number) => (v - y0) / h;
  const out = points.map((p): PathPoint => {
    const q: PathPoint = { x: nx(p.x), y: ny(p.y) };
    if (p.m) q.m = true;
    if (hasIn(p)) { q.inX = nx(p.inX!); q.inY = ny(p.inY!); }
    if (hasOut(p)) { q.outX = nx(p.outX!); q.outY = ny(p.outY!); }
    return q;
  });
  return { x0, y0, w, h, points: out };
}

// --- Frames -------------------------------------------------------------------------------------

const rad = (deg: number) => (deg * Math.PI) / 180;
export function turn(v: Pt, deg: number): Pt {
  const r = rad(deg);
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
}

type Box = Pick<PathNode, "x" | "y" | "w" | "h" | "rotation">;

/** An artboard point in the node's local pixels (turned back, then measured from its top-left). */
export function worldToLocal(n: Box, p: Pt): Pt {
  const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  const l = turn({ x: p.x - c.x, y: p.y - c.y }, -n.rotation);
  return { x: l.x + n.w / 2, y: l.y + n.h / 2 };
}
export function localToWorld(n: Box, p: Pt): Pt {
  const c = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  const t = turn({ x: p.x - n.w / 2, y: p.y - n.h / 2 }, n.rotation);
  return { x: c.x + t.x, y: c.y + t.y };
}

/** The node's anchors and handles in local pixels. */
export function toLocal(n: Pick<PathNode, "points" | "w" | "h">): PathPoint[] {
  return n.points.map((p): PathPoint => {
    const q: PathPoint = { x: p.x * n.w, y: p.y * n.h };
    if (p.m) q.m = true;
    if (hasIn(p)) { q.inX = p.inX! * n.w; q.inY = p.inY! * n.h; }
    if (hasOut(p)) { q.outX = p.outX! * n.w; q.outY = p.outY! * n.h; }
    return q;
  });
}

/**
 * The box and anchors a path should have after its anchors were edited, given in the node's
 * *original* local pixels. The box becomes the new tight bounds; because the box's centre moves,
 * the node's position is adjusted (through its rotation) so no anchor moves on the artboard
 * except the ones that were edited.
 */
export function refit(orig: Pick<PathNode, "x" | "y" | "w" | "h" | "rotation" | "closed">, local: PathPoint[]): Pick<PathNode, "x" | "y" | "w" | "h" | "points"> {
  const nb = normalizePoints(local, orig.closed);
  const delta = turn({ x: nb.x0 + nb.w / 2 - orig.w / 2, y: nb.y0 + nb.h / 2 - orig.h / 2 }, orig.rotation);
  const cx = orig.x + orig.w / 2 + delta.x;
  const cy = orig.y + orig.h / 2 + delta.y;
  return { x: cx - nb.w / 2, y: cy - nb.h / 2, w: nb.w, h: nb.h, points: nb.points };
}

// --- Editing ------------------------------------------------------------------------------------

/** Move some anchors (with their handles) by a vector, in local pixels. */
export function moveAnchors(points: PathPoint[], indices: Set<number>, d: Pt): PathPoint[] {
  return points.map((p, i) => {
    if (!indices.has(i)) return p;
    const q: PathPoint = { ...p, x: p.x + d.x, y: p.y + d.y };
    if (hasIn(p)) { q.inX = p.inX! + d.x; q.inY = p.inY! + d.y; }
    if (hasOut(p)) { q.outX = p.outX! + d.x; q.outY = p.outY! + d.y; }
    return q;
  });
}

/**
 * Drag one handle of an anchor to `to`. A smooth anchor (both handles, in line) keeps its other
 * handle opposite and the same length — unless `break` is set, which moves this handle alone.
 */
export function moveHandle(points: PathPoint[], index: number, which: "in" | "out", to: Pt, breakTangent = false): PathPoint[] {
  const p = points[index];
  const q: PathPoint = { ...p };
  if (which === "out") { q.outX = to.x; q.outY = to.y; } else { q.inX = to.x; q.inY = to.y; }
  const other = which === "out" ? (hasIn(p) ? inOf(p) : null) : hasOut(p) ? outOf(p) : null;
  if (other && !breakTangent) {
    const dragged = { x: to.x - p.x, y: to.y - p.y };
    const len = Math.hypot(other.x - p.x, other.y - p.y);
    const dl = Math.hypot(dragged.x, dragged.y);
    // Collinear before the drag? Then keep it that way, at its own length.
    const ox = other.x - p.x, oy = other.y - p.y;
    const was = which === "out" ? (hasOut(p) ? outOf(p) : null) : hasIn(p) ? inOf(p) : null;
    const wasV = was ? { x: was.x - p.x, y: was.y - p.y } : null;
    const collinear = wasV ? Math.abs(wasV.x * oy - wasV.y * ox) < 1e-6 * (Math.hypot(wasV.x, wasV.y) * len + 1e-9) && wasV.x * ox + wasV.y * oy <= 0 : true;
    if (collinear && dl > 1e-9) {
      const nx = p.x - (dragged.x / dl) * len;
      const ny = p.y - (dragged.y / dl) * len;
      if (which === "out") { q.inX = nx; q.inY = ny; } else { q.outX = nx; q.outY = ny; }
    }
  }
  const next = [...points];
  next[index] = q;
  return next;
}

export const isSmooth = (p: PathPoint) => hasIn(p) || hasOut(p);

/** Corner ↔ smooth. Smooth handles run along the line between the neighbours, a third of the way to each. */
export function toggleSmooth(points: PathPoint[], index: number, closed: boolean): PathPoint[] {
  const p = points[index];
  const range = contourRanges(points).find(([s, e]) => index >= s && index <= e);
  if (!p || !range) return points;
  const [first, last] = range;
  const keep = p.m ? { m: true as const } : {};
  const next = [...points];
  if (isSmooth(p)) {
    next[index] = { x: p.x, y: p.y, ...keep };
    return next;
  }
  const prev = index > first ? points[index - 1] : closed ? points[last] : null;
  const after = index < last ? points[index + 1] : closed ? points[first] : null;
  const a = prev ?? p;
  const b = after ?? p;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return points;
  const ux = dx / len;
  const uy = dy / len;
  const lin = prev ? Math.hypot(p.x - prev.x, p.y - prev.y) / 3 : 0;
  const lout = after ? Math.hypot(after.x - p.x, after.y - p.y) / 3 : 0;
  next[index] = { x: p.x, y: p.y, ...keep, inX: p.x - ux * lin, inY: p.y - uy * lin, outX: p.x + ux * lout, outY: p.y + uy * lout };
  return next;
}

/**
 * Remove anchors. A contour left with fewer than two is dropped with the rest of its anchors, and
 * the contour flag follows: if the first anchor of a contour goes, the next one of it starts it. A
 * path left with nothing is empty (the caller deletes the node).
 */
export function removeAnchors(points: PathPoint[], indices: Set<number>): PathPoint[] {
  const out: PathPoint[] = [];
  for (const [s, e] of contourRanges(points)) {
    const kept: PathPoint[] = [];
    for (let i = s; i <= e; i++) if (!indices.has(i)) kept.push(points[i]);
    if (kept.length < 2) continue;
    const [head, ...rest] = kept;
    out.push({ ...head, ...(out.length ? { m: true as const } : {}) }, ...rest);
  }
  if (out[0]?.m) delete out[0].m;
  return out;
}

/** The point on a path nearest `to`, with which segment it is on and how far along (0..1) — for adding an anchor there. */
export function nearestOnPath(points: PathPoint[], closed: boolean, to: Pt, steps = 40): { segment: number; t: number; dist: number; at: Pt } | null {
  let best: { segment: number; t: number; dist: number; at: Pt } | null = null;
  for (const [ai, bi] of segmentsOf(points, closed)) {
    const c = segmentCubic(points[ai], points[bi]);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const at = cubicAt(c, t);
      const dist = Math.hypot(at.x - to.x, at.y - to.y);
      if (!best || dist < best.dist) best = { segment: ai, t, dist, at };
    }
  }
  return best;
}

/** Split a segment at `t` (de Casteljau), inserting an anchor that leaves the outline exactly as it was. */
export function insertAnchor(points: PathPoint[], closed: boolean, segment: number, t: number): { points: PathPoint[]; index: number } {
  const a = points[segment];
  const range = contourRanges(points).find(([s, e]) => segment >= s && segment <= e);
  if (!a || !range) return { points, index: segment };
  // The closing segment of a contour runs from its last anchor back to its first.
  const bIndex = closed && segment === range[1] ? range[0] : segment + 1;
  const b = points[bIndex];
  const next = [...points];
  if (!isCurve(a, b)) {
    const m = lerp(a, b, t);
    next.splice(segment + 1, 0, { x: m.x, y: m.y });
    return { points: next, index: segment + 1 };
  }
  const [p0, p1, p2, p3] = segmentCubic(a, b);
  const p01 = lerp(p0, p1, t), p12 = lerp(p1, p2, t), p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t), p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  const flat = p23.x === b.x && p23.y === b.y && !hasIn(b);
  next[segment] = { ...a, outX: p01.x, outY: p01.y };
  next[bIndex] = { ...b, inX: flat ? undefined : p23.x, inY: flat ? undefined : p23.y };
  next.splice(segment + 1, 0, { x: m.x, y: m.y, inX: p012.x, inY: p012.y, outX: p123.x, outY: p123.y });
  return { points: next, index: segment + 1 };
}

// --- Shapes -------------------------------------------------------------------------------------

/** A regular polygon's anchors, fitted to the box 0..1. First point at the top. */
export function polygonPoints(sides: number): PathPoint[] {
  const n = Math.max(3, Math.min(60, Math.round(sides)));
  const raw: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    raw.push({ x: Math.cos(a), y: Math.sin(a) });
  }
  return normalizePoints(raw, true).points;
}

/** A star: `points` tips, with the valleys at `inner` (0..1) of the tips' radius. Fitted to the box 0..1. */
export function starPoints(points: number, inner: number): PathPoint[] {
  const n = Math.max(3, Math.min(40, Math.round(points)));
  const r = Math.min(0.95, Math.max(0.05, inner));
  const raw: PathPoint[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 === 0 ? 1 : r;
    raw.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr });
  }
  return normalizePoints(raw, true).points;
}
