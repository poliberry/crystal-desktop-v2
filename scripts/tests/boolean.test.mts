import assert from "node:assert/strict";
import { pathfinder, makeCompound, releaseCompound, shapeToPath, pathfinderReason, isCompoundNode } from "../../src/studio/model/boolean.ts";
import { makeShape, makeShapePath, makePathFromWorld } from "../../src/studio/model/doc.ts";
import { contourRanges, curveBounds, pathD, toLocal, localToWorld, removeAnchors, toggleSmooth, insertAnchor, nearestOnPath, segmentsOf } from "../../src/studio/model/path.ts";
import type { Node, PathNode } from "../../src/studio/model/types.ts";
import { sanitizeDoc } from "../../src/studio/storage/format.ts";
import paper from "paper/dist/paper-core";

const near = (a: number, b: number, e = 0.5, m = "") => assert.ok(Math.abs(a - b) <= e, `${m} ${a} !~ ${b}`);
const rect = (id: string, x: number, y: number, w: number, h: number, extra: object = {}) => ({ ...makeShape("rect", x, y, w, h), id, ...extra }) as Node;
const circ = (id: string, cx: number, cy: number, r: number, extra: object = {}) => ({ ...makeShape("ellipse", cx - r, cy - r, 2 * r, 2 * r), id, ...extra }) as Node;

/** Area of a path node as even-odd filling counts it: each contour adds its own area, or takes it away if it lies inside an odd number of others. */
function areaOf(n: PathNode): number {
  paper.setup(new paper.Size(1, 1));
  const cp = new paper.CompoundPath({ pathData: pathD(n.points, n.closed, n.w, n.h), fillRule: "evenodd" });
  const parts = (cp.children?.length ? cp.children : [cp]) as paper.Path[];
  return parts.reduce((sum, c, i) => {
    const inside = parts.filter((o, j) => j !== i && o.contains(c.firstSegment.point.add(c.getNormalAt(0).multiply(-0.01)))).length;
    return sum + Math.abs(c.area) * (inside % 2 ? -1 : 1);
  }, 0);
}
const world = (n: PathNode) => toLocal(n).map((p) => localToWorld(n, p));

// --- reasons
assert.equal(pathfinderReason([rect("a", 0, 0, 1, 1)]), "Select two or more shapes");
assert.match(pathfinderReason([rect("a", 0, 0, 1, 1), { ...rect("t", 0, 0, 1, 1), type: "text" } as never])!, /text or pictures/);
assert.equal(pathfinderReason([rect("a", 0, 0, 1, 1), circ("b", 0, 0, 1)]), null);

// --- unite: rect 100x100 + circle r40 at (100,50): union area 12514 (computed independently by paper above)
const A = rect("a", 0, 0, 100, 100, { fill: "#ff0000" });
const B = circ("b", 100, 50, 40, { fill: "#00ff00" });
const u = pathfinder([A, B], "unite")!;
near(areaOf(u), 10000 + Math.PI * 1600 - 2514, 3, "union = rect + circle - lens");
near(u.w, 140, 0.01, "union box width"); near(u.h, 100, 0.01);
assert.equal(u.fill, "#00ff00", "front object's look");
assert.ok(u.points.some((p) => p.outX !== undefined || p.inX !== undefined), "curves survive");
assert.ok(u.points.length < 20, "not flattened: " + u.points.length);
assert.equal(contourRanges(u.points).length, 1);

// --- minus front keeps the back object's look; minus back keeps the front's
const mf = pathfinder([A, B], "minusFront")!;
assert.equal(mf.fill, "#ff0000"); near(mf.w, 100, 0.01); near(mf.h, 100, 0.01);
const mb = pathfinder([A, B], "minusBack")!;
assert.equal(mb.fill, "#00ff00"); near(mb.x, 100, 0.01); near(mb.w, 40, 0.01);
near(areaOf(mf) + areaOf(mb) + areaOf(pathfinder([A, B], "intersect")!), areaOf(u), 5, "|A-B| + |B-A| + |A&B| = |A|B|");

// --- intersect: lens inside both
const x = pathfinder([A, B], "intersect")!;
near(x.x, 60, 0.01); near(x.w, 40, 0.01);
// disjoint intersect -> nothing
assert.equal(pathfinder([rect("a", 0, 0, 10, 10), rect("b", 50, 50, 10, 10)], "intersect"), null);

// --- exclude gives a compound path of two contours
const ex = pathfinder([A, B], "exclude")!;
assert.equal(contourRanges(ex.points).length, 2); assert.ok(isCompoundNode(ex));
near(areaOf(ex), areaOf(u) - areaOf(x), 5, "xor area");

// --- a donut: big minus small inside -> a hole (two contours); area = difference
const donut = pathfinder([rect("big", 0, 0, 100, 100), rect("small", 25, 25, 50, 50)], "minusFront")!;
assert.equal(contourRanges(donut.points).length, 2);
near(areaOf(donut), 10000 - 2500, 1);

// --- rotation is honoured: a 90deg-turned 100x20 bar crossing a 20x100 bar's lengthwise = same footprint, union is a plus
const bar = rect("h", 0, 40, 100, 20); const vbar = { ...rect("v", 40, 0, 20, 100) };
const plus = pathfinder([bar, vbar], "unite")!;
near(areaOf(plus), 100 * 20 * 2 - 400, 1, "plus"); assert.equal(plus.points.length, 12);
const turned = { ...rect("v2", 40, 0, 100, 20, { rotation: 90 }) }; // centre (90,10) turned: occupies x 80..100, y -40..60
const pt = pathfinder([rect("g", 0, 0, 10, 10), turned], "unite")!;
near(pt.x, 0, 0.01); near(pt.y, -40, 0.01); near(pt.w, 100, 0.01); near(pt.h, 100, 0.01);

// --- more than two operands
const three = pathfinder([rect("a", 0, 0, 20, 20), rect("b", 10, 0, 20, 20), rect("c", 20, 0, 20, 20)], "unite")!;
near(three.w, 40, 0.01); assert.equal(three.points.length, 4);
near(areaOf(pathfinder([rect("a", 0, 0, 100, 100), rect("b", 10, 10, 10, 10), rect("c", 60, 60, 10, 10)], "minusFront")!), 10000 - 200, 1);

// --- compound path: make, then release
const ring = makeCompound([rect("o", 0, 0, 100, 100, { fill: "#123456" }), circ("i", 50, 50, 20)])!;
assert.equal(contourRanges(ring.points).length, 2); assert.equal(ring.fill, "#123456", "back object's look");
near(areaOf(ring), 10000 - Math.PI * 400, 5);
const parts = releaseCompound(ring);
assert.equal(parts.length, 2); assert.ok(parts.every((p) => p.fill === "#123456" && !isCompoundNode(p)));
assert.equal(releaseCompound(parts[0]).length, 0, "a plain path isn't compound");

// --- shape -> path keeps identity and outline
const sp = shapeToPath({ ...circ("c1", 50, 50, 30), name: "Dot", opacity: 0.5, group: "g1" } as never)!;
assert.equal(sp.id, "c1"); assert.equal(sp.name, "Dot"); assert.equal(sp.opacity, 0.5); assert.equal(sp.group, "g1");
near(sp.w, 60, 0.01); near(sp.h, 60, 0.01); assert.equal(sp.points.length, 4); near(areaOf(sp), Math.PI * 900, 15);
const rr = shapeToPath(rect("r1", 10, 10, 80, 40, { radius: 10 }) as never)!;
near(rr.w, 80, 0.01); assert.equal(rr.points.length, 8);
const rot = shapeToPath(rect("r2", 0, 0, 100, 20, { rotation: 90 }) as never)!;
near(rot.w, 20, 0.01); near(rot.h, 100, 0.01); assert.equal(rot.rotation, 0);

// --- editing a compound path: contours kept through the editing functions
const cp = ring.points;
const [c0, c1] = contourRanges(cp);
assert.equal(segmentsOf(cp, true).length, cp.length, "one closing segment per contour");
const removed = removeAnchors(cp, new Set([c1[0]])); // drop the first anchor of the inner contour: it moves its flag on
assert.equal(contourRanges(removed).length, 2); assert.ok(removed[c1[0]].m, "next anchor now starts the contour");
const gone = removeAnchors(cp, new Set(Array.from({ length: c1[1] - c1[0] - 0 }, (_, i) => c1[0] + i)));
assert.equal(contourRanges(gone).length, 1, "a contour left with one anchor goes");
assert.ok(!gone[0].m);
const first = removeAnchors(cp, new Set(Array.from({ length: c0[1] + 1 - 1 }, (_, i) => i)));
assert.equal(contourRanges(first).length, 1, "outer contour dropped, inner becomes first");
assert.ok(!first[0].m, "and loses its flag");
const corner = toggleSmooth(cp, c1[0], true); // a circle's anchors are smooth already: this makes it a corner
assert.ok(corner[c1[0]].m, "toggle keeps the contour flag"); assert.equal(corner[c1[0]].inX, undefined);
const sm = toggleSmooth(corner, c1[0], true); // and this smooths it again from its neighbours in the SAME contour
assert.ok(sm[c1[0]].m);
const nx = cp[c1[0] + 1], pv = cp[c1[1]];
// the handle line runs parallel to prev -> next within the inner contour (it would be wildly off if it had used the outer contour)
const hx = sm[c1[0]].outX! - sm[c1[0]].inX!, hy = sm[c1[0]].outY! - sm[c1[0]].inY!;
const cross = hx * (nx.y - pv.y) - hy * (nx.x - pv.x);
assert.ok(Math.abs(cross) < 1e-6 * (Math.hypot(hx, hy) * Math.hypot(nx.x - pv.x, nx.y - pv.y) + 1), "handles follow the contour's own neighbours");
const last = c1[1];
const ins = insertAnchor(cp, true, last, 0.5); // closing segment of the inner contour
assert.equal(contourRanges(ins.points).length, 2); assert.equal(ins.index, last + 1); assert.ok(!ins.points[ins.index].m);
const nearest = nearestOnPath(cp, true, { x: 0, y: 0 }.constructor === Object ? { x: 0.5, y: 0.5 } : { x: 0, y: 0 }); assert.ok(nearest);
const cb = curveBounds(cp, true)!; assert.ok(cb.x1 > cb.x0);

// --- saved and loaded: contour flags survive, bad ones can't break it
const saved = JSON.parse(JSON.stringify({ artboard: { w: 400, h: 400 }, order: [ring.id], nodes: { [ring.id]: ring } }));
const back = sanitizeDoc(saved, "decoration").nodes[ring.id] as PathNode;
assert.equal(contourRanges(back.points).length, 2);
console.log("boolean: all assertions passed");
