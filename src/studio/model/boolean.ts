import paper from "paper/dist/paper-core";

import { makePathFromWorld } from "./doc";
import { contourRanges, normalizePoints } from "./path";
import type { Node, PathNode, PathPoint, ShapeNode } from "./types";

/**
 * Pathfinder: combining shapes into new outlines, and compound paths.
 *
 * The geometry (where two Bézier outlines cross, which side is inside) is Paper.js's; this file
 * turns nodes into its curves in artboard coordinates, runs the operation, and turns the result
 * back into a path node. Curves stay curves: uniting two circles gives a path of arcs, not
 * hundreds of straight pieces.
 *
 * Only shapes and paths take part. Text and pictures have no outline to combine.
 */

export type PathfinderOp = "unite" | "minusFront" | "intersect" | "exclude" | "minusBack";

let ready = false;
function init() {
  if (ready) return;
  // A scope of its own, with items not added to any scene: operands are made and thrown away.
  paper.setup(new paper.Size(1, 1));
  paper.settings.insertItems = false;
  ready = true;
}

type Outline = Node & { type: "shape" | "path" };
export const canCombine = (n: Node): n is Outline => n.type === "shape" || n.type === "path";

const pt = (x: number, y: number) => new paper.Point(x, y);

/** A node's outline as Paper.js curves, turned and placed on the artboard. Always closed: an open path is filled as though closed. */
function toPaper(n: Outline): paper.PathItem {
  init();
  let item: paper.PathItem;
  if (n.type === "shape") {
    item =
      n.shape === "ellipse"
        ? new paper.Path.Ellipse({ center: pt(n.x + n.w / 2, n.y + n.h / 2), radius: [n.w / 2, n.h / 2] })
        : new paper.Path.Rectangle({ point: pt(n.x, n.y), size: [n.w, n.h], radius: Math.max(0, Math.min(n.radius, n.w / 2, n.h / 2)) });
  } else {
    const make = (from: number, to: number) => {
      const path = new paper.Path({ closed: true });
      for (let i = from; i <= to; i++) {
        const p = n.points[i];
        const X = (v: number) => v * n.w + n.x;
        const Y = (v: number) => v * n.h + n.y;
        const x = X(p.x);
        const y = Y(p.y);
        path.add(
          new paper.Segment(
            pt(x, y),
            p.inX !== undefined ? pt(X(p.inX) - x, Y(p.inY!) - y) : undefined,
            p.outX !== undefined ? pt(X(p.outX) - x, Y(p.outY!) - y) : undefined,
          ),
        );
      }
      return path;
    };
    const ranges = contourRanges(n.points);
    item = ranges.length === 1 ? make(ranges[0][0], ranges[0][1]) : new paper.CompoundPath({ children: ranges.map(([s, e]) => make(s, e)), fillRule: "evenodd" });
  }
  if (n.rotation) item.rotate(n.rotation, pt(n.x + n.w / 2, n.y + n.h / 2));
  return item;
}

/** The outlines in a Paper.js item as lists of anchors in artboard coordinates, handles as absolute positions. */
function contoursOf(item: paper.PathItem): PathPoint[][] {
  const parts = (item instanceof paper.CompoundPath ? (item.children as paper.Path[]) : [item as paper.Path]).filter((p) => p.segments.length >= 2);
  return parts.map((path) =>
    path.segments.map((s): PathPoint => {
      const q: PathPoint = { x: s.point.x, y: s.point.y };
      if (s.handleIn.length > 1e-9) { q.inX = s.point.x + s.handleIn.x; q.inY = s.point.y + s.handleIn.y; }
      if (s.handleOut.length > 1e-9) { q.outX = s.point.x + s.handleOut.x; q.outY = s.point.y + s.handleOut.y; }
      return q;
    }),
  );
}

/** Contours joined into one flat list, each after the first marked as starting a new one. */
function flatten(contours: PathPoint[][]): PathPoint[] {
  return contours.flatMap((c, i) => c.map((p, j) => (i > 0 && j === 0 ? { ...p, m: true as const } : p)));
}

type Look = Partial<Pick<PathNode, "fill" | "fillGradient" | "fillMaterial" | "stroke" | "strokeWidth" | "strokeGradient" | "strokeMaterial" | "cap" | "join" | "opacity" | "fx" | "brush">>;

/** The paint and stroke of a node, as a path would have it. */
function lookOf(n: Outline): Look {
  const look: Look = { fill: n.fill, stroke: n.stroke, strokeWidth: n.strokeWidth, opacity: n.opacity };
  if (n.fillGradient) look.fillGradient = n.fillGradient;
  if (n.strokeGradient) look.strokeGradient = n.strokeGradient;
  if (n.fillMaterial) look.fillMaterial = n.fillMaterial;
  if (n.strokeMaterial) look.strokeMaterial = n.strokeMaterial;
  if (n.type === "path" && n.brush) look.brush = n.brush;
  if (n.fx) look.fx = n.fx;
  if (n.type === "path") { look.cap = n.cap; look.join = n.join; } else { look.cap = "round"; look.join = "miter"; }
  return look;
}

const topLevelGroup = (nodes: Node[]): string | undefined => {
  const g = nodes[0]?.group;
  return g && nodes.every((n) => n.group === g) ? g : undefined;
};

function finish(contours: PathPoint[][], donor: Outline, sources: Node[], name: string): PathNode | null {
  if (contours.length === 0) return null;
  const node = makePathFromWorld(flatten(contours), true, lookOf(donor), name);
  if (!node) return null;
  const group = topLevelGroup(sources);
  return group ? { ...node, group } : node;
}

// --- Pathfinder ---------------------------------------------------------------------------------

export const OP_LABEL: Record<PathfinderOp, string> = {
  unite: "Unite",
  minusFront: "Minus Front",
  intersect: "Intersect",
  exclude: "Exclude Overlap",
  minusBack: "Minus Back",
};

/** Why `op` can't be done to these nodes, or null if it can. */
export function pathfinderReason(nodes: Node[]): string | null {
  if (nodes.length < 2) return "Select two or more shapes";
  if (!nodes.every(canCombine)) return "Only shapes and paths can be combined — not text or pictures";
  return null;
}

/**
 * Combine nodes (given bottom first, as the stack has them). The result takes the look of the front
 * object — except Minus Front, which keeps what remains of the back one. Returns null when nothing
 * is left (for example, two shapes that don't overlap, intersected).
 */
export function pathfinder(nodes: Node[], op: PathfinderOp): PathNode | null {
  if (pathfinderReason(nodes)) return null;
  const outlines = nodes as Outline[];
  const items = outlines.map(toPaper);
  const opts = { insert: false };
  let result: paper.PathItem;
  switch (op) {
    case "unite":
      result = items.reduce((a, b) => a.unite(b, opts));
      break;
    case "intersect":
      result = items.reduce((a, b) => a.intersect(b, opts));
      break;
    case "exclude":
      result = items.reduce((a, b) => a.exclude(b, opts));
      break;
    case "minusFront":
      result = items.slice(1).reduce((a, b) => a.subtract(b, opts), items[0]);
      break;
    case "minusBack":
      result = items.slice(0, -1).reduce((rest, behind) => rest.subtract(behind, opts), items[items.length - 1]);
      break;
  }
  const donor = op === "minusFront" ? outlines[0] : outlines[outlines.length - 1];
  return finish(contoursOf(result), donor, nodes, OP_LABEL[op] === "Exclude Overlap" ? "Exclude" : OP_LABEL[op]);
}

// --- Compound paths -----------------------------------------------------------------------------

/**
 * Make several outlines one path, as the letter O is a ring and a hole: no boolean work, the
 * contours are kept as they are and filled even-odd, so wherever one lies over another there is a
 * hole. It takes the look of the back object. Open paths are closed.
 */
export function makeCompound(nodes: Node[]): PathNode | null {
  if (pathfinderReason(nodes)) return null;
  const outlines = nodes as Outline[];
  const contours = outlines.flatMap((n) => contoursOf(toPaper(n)));
  return finish(contours, outlines[0], nodes, "Compound Path");
}

export const isCompoundNode = (n: Node): n is PathNode => n.type === "path" && n.points.some((p) => p.m);

/** A compound path as separate paths, one per contour, each with its look. */
export function releaseCompound(n: PathNode): PathNode[] {
  if (!isCompoundNode(n)) return [];
  const look = lookOf(n);
  return contoursOf(toPaper(n))
    .map((c) => makePathFromWorld(c, true, look, "Path"))
    .filter((p): p is PathNode => !!p)
    .map((p) => (n.group ? { ...p, group: n.group } : p));
}

// --- Shapes to paths ----------------------------------------------------------------------------

/** A rectangle or ellipse as the path it is, keeping its identity (id, name, place in the stack, group, effects) so its anchors can be edited. */
export function shapeToPath(n: ShapeNode): PathNode | null {
  const contours = contoursOf(toPaper(n));
  if (contours.length !== 1) return null;
  const nb = normalizePoints(contours[0], true);
  return {
    id: n.id,
    name: n.name,
    type: "path",
    x: nb.x0,
    y: nb.y0,
    w: nb.w,
    h: nb.h,
    rotation: 0,
    opacity: n.opacity,
    locked: n.locked,
    hidden: n.hidden,
    ...(n.group ? { group: n.group } : {}),
    ...(n.fx ? { fx: n.fx } : {}),
    points: nb.points,
    closed: true,
    fill: n.fill,
    stroke: n.stroke,
    strokeWidth: n.strokeWidth,
    cap: "round",
    join: "miter",
    ...(n.fillGradient ? { fillGradient: n.fillGradient } : {}),
    ...(n.strokeGradient ? { strokeGradient: n.strokeGradient } : {}),
    ...(n.fillMaterial ? { fillMaterial: n.fillMaterial } : {}),
    ...(n.strokeMaterial ? { strokeMaterial: n.strokeMaterial } : {}),
  };
}
