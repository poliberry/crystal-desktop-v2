import type { Node, TextNode } from "@/studio/model/types";

/**
 * Transforming several objects as one — what a group, or any multiple selection, does when its box
 * is resized or turned. Pure functions from nodes to patches, so each drag is "the original nodes
 * and how far the pointer has gone", never an accumulation of small changes.
 */

export interface Pt {
  x: number;
  y: number;
}

const turn = (v: Pt, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
};

const centreOf = (n: Pick<Node, "x" | "y" | "w" | "h">): Pt => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });

/** A turn of a multiple of 90° — where a box's edges are still on the axes. */
const squareOn = (deg: number) => Math.abs(((deg % 90) + 90) % 90) < 1e-6 || Math.abs((((deg % 90) + 90) % 90) - 90) < 1e-6;

export type Patch = Partial<Node>;

/**
 * Scale nodes by (sx, sy) about `anchor`. A node's centre moves proportionally; its size scales with it.
 *
 * A turned node can't be stretched unevenly without shearing — a rotated box has no such shape — so
 * if any node is turned off the axes, the scale is made uniform (the larger of the two, as a
 * proportional drag would be) for all of them. Text scales its type with the height. Strokes and
 * effects keep their size, which is Illustrator's default ("Scale Strokes & Effects" off).
 */
export function scaleNodes(nodes: Node[], anchor: Pt, sx: number, sy: number): { id: string; patch: Patch }[] {
  const awkward = nodes.some((n) => !squareOn(n.rotation));
  let kx = sx;
  let ky = sy;
  if (awkward) {
    const u = Math.abs(sx) >= Math.abs(sy) ? sx : sy;
    kx = u;
    ky = u;
  }
  // A drag past the opposite edge would flip everything; hold at a sliver instead.
  const floor = 0.001;
  kx = Math.max(floor, kx);
  ky = Math.max(floor, ky);
  return nodes.map((n) => {
    const c = centreOf(n);
    const nc = { x: anchor.x + (c.x - anchor.x) * kx, y: anchor.y + (c.y - anchor.y) * ky };
    // A quarter-turned box has its width along the vertical: the factors swap.
    const quarter = Math.round(n.rotation / 90) % 2 !== 0;
    const w = n.w * (quarter ? ky : kx);
    const h = n.h * (quarter ? kx : ky);
    const patch: Patch = { x: nc.x - w / 2, y: nc.y - h / 2, w, h };
    if (n.type === "floor") {
      // A floor line is only ever a height.
      return { id: n.id, patch: { y: nc.y - n.h / 2, x: n.x, w: n.w } };
    }
    if (n.type === "text") (patch as Partial<TextNode>).fontSize = Math.max(1, (n as TextNode).fontSize * ky);
    return { id: n.id, patch };
  });
}

/** Turn nodes by `deg` about `pivot`: each centre swings round it and each node turns by the same angle. */
export function rotateNodes(nodes: Node[], pivot: Pt, deg: number): { id: string; patch: Patch }[] {
  return nodes.map((n) => {
    const c = centreOf(n);
    const v = turn({ x: c.x - pivot.x, y: c.y - pivot.y }, deg);
    const nc = { x: pivot.x + v.x, y: pivot.y + v.y };
    let rotation = n.rotation + deg;
    rotation = ((rotation + 180) % 360 + 360) % 360 - 180;
    if (Object.is(rotation, -0)) rotation = 0;
    return { id: n.id, patch: { x: nc.x - n.w / 2, y: nc.y - n.h / 2, rotation: Math.round(rotation * 100) / 100 } };
  });
}

/** The point opposite a handle on a box — what stays put while scaling by dragging that handle. */
export function oppositeAnchor(box: { x: number; y: number; w: number; h: number }, hx: -1 | 0 | 1, hy: -1 | 0 | 1): Pt {
  return { x: hx === 1 ? box.x : hx === -1 ? box.x + box.w : box.x + box.w / 2, y: hy === 1 ? box.y : hy === -1 ? box.y + box.h : box.y + box.h / 2 };
}

/**
 * The scale factors a pointer drag asks for: how far the dragged handle's edge is from the anchor now,
 * against how far it was. An edge handle changes one axis only; `lock` makes the corner proportional.
 */
export function dragScale(box: { w: number; h: number }, hx: -1 | 0 | 1, hy: -1 | 0 | 1, anchor: Pt, pointer: Pt, lock: boolean): { sx: number; sy: number } {
  let sx = hx === 0 ? 1 : ((pointer.x - anchor.x) * hx) / Math.max(box.w, 1e-6);
  let sy = hy === 0 ? 1 : ((pointer.y - anchor.y) * hy) / Math.max(box.h, 1e-6);
  if (lock && hx !== 0 && hy !== 0) {
    const u = Math.max(Math.abs(sx), Math.abs(sy));
    sx = u;
    sy = u;
  }
  return { sx, sy };
}
