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

/**
 * Nudge a moving box so its edges and centre meet the artboard's and the other
 * nodes', within a few screen pixels, and say which lines it met so they can be
 * drawn. `threshold` is in document units — the caller divides pixels by zoom.
 */
export function snapMove(moving: Rect, doc: Doc, ignore: Set<string>, threshold: number): { dx: number; dy: number; guides: Guides } {
  const xs: number[] = [0, doc.artboard.w / 2, doc.artboard.w];
  const ys: number[] = [0, doc.artboard.h / 2, doc.artboard.h];
  for (const id of doc.order) {
    if (ignore.has(id)) continue;
    const n = doc.nodes[id];
    if (!n || n.hidden || n.type === "floor") continue;
    const b = boundsOf(n);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
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
  return { dx: bx.delta, dy: by.delta, guides: { x: bx.hit, y: by.hit } };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalisedRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
