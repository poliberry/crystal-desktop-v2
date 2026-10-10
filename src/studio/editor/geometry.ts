import { boundsOf } from "@/studio/model/doc";
import type { Doc, Node } from "@/studio/model/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export const HANDLES: { id: Handle; hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string }[] = [
  { id: "nw", hx: -1, hy: -1, cursor: "nwse-resize" },
  { id: "n", hx: 0, hy: -1, cursor: "ns-resize" },
  { id: "ne", hx: 1, hy: -1, cursor: "nesw-resize" },
  { id: "e", hx: 1, hy: 0, cursor: "ew-resize" },
  { id: "se", hx: 1, hy: 1, cursor: "nwse-resize" },
  { id: "s", hx: 0, hy: 1, cursor: "ns-resize" },
  { id: "sw", hx: -1, hy: 1, cursor: "nesw-resize" },
  { id: "w", hx: -1, hy: 0, cursor: "ew-resize" },
];

export const MIN_SIZE = 4;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Rotate a vector by `deg` degrees. */
export function rotate(v: { x: number; y: number }, deg: number): { x: number; y: number } {
  const r = rad(deg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * A node resized by dragging one handle to `pointer`, in the document's units.
 *
 * Worked in the node's own (unrotated) frame, so a rotated node's edges follow
 * the pointer along *its* axes; the opposite edge or corner stays where it was.
 * `lockAspect` keeps the proportions, which only makes sense from a corner.
 */
export function resizeNode(
  orig: Pick<Node, "x" | "y" | "w" | "h" | "rotation">,
  handle: Handle,
  pointer: { x: number; y: number },
  lockAspect: boolean,
): Rect {
  const def = HANDLES.find((h) => h.id === handle)!;
  const c = { x: orig.x + orig.w / 2, y: orig.y + orig.h / 2 };
  const local = rotate({ x: pointer.x - c.x, y: pointer.y - c.y }, -orig.rotation);

  let left = -orig.w / 2;
  let right = orig.w / 2;
  let top = -orig.h / 2;
  let bottom = orig.h / 2;
  if (def.hx === 1) right = local.x;
  if (def.hx === -1) left = local.x;
  if (def.hy === 1) bottom = local.y;
  if (def.hy === -1) top = local.y;

  if (lockAspect && def.hx !== 0 && def.hy !== 0) {
    const fixedX = def.hx === 1 ? -orig.w / 2 : orig.w / 2;
    const fixedY = def.hy === 1 ? -orig.h / 2 : orig.h / 2;
    const scale = Math.max(Math.abs(local.x - fixedX) / orig.w, Math.abs(local.y - fixedY) / orig.h);
    const w = Math.max(MIN_SIZE, orig.w * scale);
    const h = Math.max(MIN_SIZE, orig.h * scale);
    left = def.hx === 1 ? fixedX : fixedX - w;
    right = def.hx === 1 ? fixedX + w : fixedX;
    top = def.hy === 1 ? fixedY : fixedY - h;
    bottom = def.hy === 1 ? fixedY + h : fixedY;
  }

  // Dragged past the opposite edge: stop at the minimum rather than flipping.
  if (right - left < MIN_SIZE) {
    if (def.hx === 1) right = left + MIN_SIZE;
    else if (def.hx === -1) left = right - MIN_SIZE;
  }
  if (bottom - top < MIN_SIZE) {
    if (def.hy === 1) bottom = top + MIN_SIZE;
    else if (def.hy === -1) top = bottom - MIN_SIZE;
  }

  const w = right - left;
  const h = bottom - top;
  const localCentre = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const worldCentre = rotate(localCentre, orig.rotation);
  return { x: c.x + worldCentre.x - w / 2, y: c.y + worldCentre.y - h / 2, w, h };
}

/** The angle from a node's centre to the pointer, in degrees, with "up" as zero. */
export function angleTo(centre: { x: number; y: number }, pointer: { x: number; y: number }): number {
  return (Math.atan2(pointer.y - centre.y, pointer.x - centre.x) * 180) / Math.PI + 90;
}

export function normaliseAngle(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (Object.is(a, -0)) a = 0;
  return Math.round(a * 100) / 100;
}

// --- Snapping ---------------------------------------------------------------------------------

export interface Guides {
  x: number[];
  y: number[];
}

/** What a moving box may snap to. */
export interface SnapOptions {
  /** Smart guides: the artboard's edges and middle, and the other objects'. */
  smart: boolean;
  /** The document's ruler guides. */
  guides: boolean;
  /** Grid spacing in document units, or null for no grid snapping. */
  grid: number | null;
}

export const DEFAULT_SNAP: SnapOptions = { smart: true, guides: true, grid: null };

/** The lines a single edge may snap to: the artboard's (and any ruler guides) on one axis. */
export function snapLines(doc: Doc, axis: "x" | "y", opts: SnapOptions = DEFAULT_SNAP): number[] {
  const size = axis === "x" ? doc.artboard.w : doc.artboard.h;
  const lines: number[] = opts.smart ? [0, size / 2, size] : [];
  if (opts.guides && doc.guides) lines.push(...doc.guides[axis]);
  return lines;
}

/**
 * One value pulled onto the nearest of `lines`, or failing that onto the grid, when
 * within `threshold`; otherwise unchanged.
 */
export function snapScalar(v: number, lines: number[], threshold: number, grid: number | null = null): number {
  let best = v;
  let dist = threshold;
  let found = false;
  for (const l of lines) {
    const d = Math.abs(l - v);
    if (d <= dist) {
      dist = d;
      best = l;
      found = true;
    }
  }
  if (found) return best;
  if (grid && grid > 0) {
    const g = Math.round(v / grid) * grid;
    if (Math.abs(g - v) <= threshold) return g;
  }
  return v;
}

/**
 * Nudge a moving box so its edges and centre meet the artboard's, the other
 * nodes' and any ruler guides, within a few screen pixels (or the grid, if there
 * is one and nothing else is close), and say which lines it met so they can be
 * drawn. `threshold` is in document units — the caller divides pixels by zoom.
 */
export function snapMove(
  moving: Rect,
  doc: Doc,
  ignore: Set<string>,
  threshold: number,
  opts: SnapOptions = DEFAULT_SNAP,
): { dx: number; dy: number; guides: Guides } {
  const xs: number[] = snapLines(doc, "x", opts);
  const ys: number[] = snapLines(doc, "y", opts);
  if (opts.smart) {
    for (const id of doc.order) {
      if (ignore.has(id)) continue;
      const n = doc.nodes[id];
      if (!n || n.hidden || n.type === "floor") continue;
      const b = boundsOf(n);
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
  }
  const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];

  const best = (mine: number[], lines: number[]) => {
    let delta = 0;
    let dist = threshold + 1;
    const hit: number[] = [];
    for (const m of mine) {
      for (const l of lines) {
        const d = l - m;
        if (Math.abs(d) < dist - 1e-9) {
          dist = Math.abs(d);
          delta = d;
        }
      }
    }
    if (dist <= threshold) {
      for (const m of mine) for (const l of lines) if (Math.abs(l - (m + delta)) < 0.01 && !hit.includes(l)) hit.push(l);
      return { delta, hit };
    }
    return { delta: 0, hit };
  };
  const bx = best(mx, xs);
  const by = best(my, ys);
  let dx = bx.delta;
  let dy = by.delta;
  // Nothing else was close on an axis: the grid, by whichever edge is nearest a line of it.
  if (opts.grid && opts.grid > 0) {
    const toGrid = (mine: number[]) => {
      let delta = 0;
      let dist = threshold + 1;
      for (const m of mine) {
        const d = Math.round(m / opts.grid!) * opts.grid! - m;
        if (Math.abs(d) < dist) {
          dist = Math.abs(d);
          delta = d;
        }
      }
      return dist <= threshold ? delta : 0;
    };
    if (bx.hit.length === 0) dx = toGrid(mx);
    if (by.hit.length === 0) dy = toGrid(my);
  }
  return { dx, dy, guides: { x: bx.hit, y: by.hit } };
}

/** The pan and zoom that fit `rect` (document units) into a viewport of `size`, centred. */
export function viewForRect(rect: Rect, size: { w: number; h: number }, pad = 24, min = 0.05, max = 8): { zoom: number; x: number; y: number } {
  const zoom = Math.max(min, Math.min(max, (size.w - pad * 2) / Math.max(rect.w, 1e-6), (size.h - pad * 2) / Math.max(rect.h, 1e-6)));
  return { zoom, x: size.w / 2 - (rect.x + rect.w / 2) * zoom, y: size.h / 2 - (rect.y + rect.h / 2) * zoom };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalisedRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
