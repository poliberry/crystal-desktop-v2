import assert from "node:assert/strict";
import { cubicAt, curveBounds, insertAnchor, localToWorld, moveAnchors, moveHandle, nearestOnPath, normalizePoints, pathD, polygonPoints, refit, removeAnchors, starPoints, toLocal, toggleSmooth, worldToLocal } from "../../src/studio/model/path.ts";

const near = (a: number, b: number, e = 1e-6, m = "") => assert.ok(Math.abs(a - b) <= e, `${m} ${a} !~ ${b}`);

// --- path data
assert.equal(pathD([{ x: 0, y: 0 }, { x: 1, y: 1 }], false, 100, 50), "M0 0L100 50");
assert.equal(pathD([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], true, 10, 10), "M0 0L10 0L10 10L0 10Z".replace("L0 10Z", "L0 0Z"));
assert.match(pathD([{ x: 0, y: 0, outX: 0.5, outY: 0 }, { x: 1, y: 1, inX: 1, inY: 0.5 }], false, 10, 10), /^M0 0C5 0 10 5 10 10$/);
assert.equal(pathD([], false, 1, 1), "");

// --- bounds follow the curve, not just the anchors: a bulge past both anchors
const bulge = [{ x: 0, y: 0, outX: 0, outY: -1 }, { x: 1, y: 0, inX: 1, inY: -1 }];
const b = curveBounds(bulge, false)!;
near(b.x0, 0); near(b.x1, 1); near(b.y1, 0);
near(b.y0, -0.75, 1e-9, "cubic apex of a y(-1,-1) bulge is -0.75");
// exact against dense sampling for a random-ish S curve
const s = [{ x: 0.1, y: 0.9, outX: 0.9, outY: 1.4 }, { x: 0.9, y: 0.1, inX: 0.1, inY: -0.4 }];
const sb = curveBounds(s, false)!;
let mnx = 9, mxx = -9, mny = 9, mxy = -9;
for (let i = 0; i <= 20000; i++) { const p = cubicAt([{ x: 0.1, y: 0.9 }, { x: 0.9, y: 1.4 }, { x: 0.1, y: -0.4 }, { x: 0.9, y: 0.1 }], i / 20000); mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mny = Math.min(mny, p.y); mxy = Math.max(mxy, p.y); }
near(sb.x0, mnx, 1e-4); near(sb.x1, mxx, 1e-4); near(sb.y0, mny, 1e-4); near(sb.y1, mxy, 1e-4);

// --- normalise: a flat line still gets a box; fractions land in 0..1
const flat = normalizePoints([{ x: 10, y: 50 }, { x: 110, y: 50 }], false);
assert.equal(flat.w, 100); assert.equal(flat.h, 1); near(flat.y0, 49.5);
near(flat.points[0].y, 0.5); near(flat.points[1].x, 1);
const tri = normalizePoints([{ x: 5, y: 5 }, { x: 25, y: 5 }, { x: 15, y: 25 }], true);
assert.deepEqual([tri.w, tri.h], [20, 20]);
for (const p of tri.points) assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);

// --- frames round trip, with rotation
const node = { x: 100, y: 50, w: 80, h: 40, rotation: 30 };
for (const p of [{ x: 0, y: 0 }, { x: 80, y: 40 }, { x: 13, y: 7 }]) {
  const back = worldToLocal(node, localToWorld(node, p));
  near(back.x, p.x, 1e-9); near(back.y, p.y, 1e-9);
}

// --- refit keeps un-edited anchors where they were on the artboard, even when turned
const pn = { ...node, closed: true, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
const local = toLocal(pn);
const worldBefore = local.map((p) => localToWorld(pn, p));
const edited = moveAnchors(local, new Set([2]), { x: 50, y: 30 }); // push one corner out: the box grows
const fit = refit(pn, edited);
assert.ok(fit.w > pn.w && fit.h > pn.h, "box grew");
const after = toLocal({ points: fit.points, w: fit.w, h: fit.h }).map((p) => localToWorld({ ...fit, rotation: pn.rotation }, p));
for (const i of [0, 1, 3]) { near(after[i].x, worldBefore[i].x, 1e-6, `anchor ${i} x`); near(after[i].y, worldBefore[i].y, 1e-6, `anchor ${i} y`); }
const moved = localToWorld(pn, { x: 80 + 50, y: 40 + 30 });
near(after[2].x, moved.x, 1e-6); near(after[2].y, moved.y, 1e-6);

// --- handles: dragging a smooth anchor's handle mirrors the other; alt breaks it
const sm = [{ x: 50, y: 50, inX: 30, inY: 50, outX: 70, outY: 50 }];
let h = moveHandle(sm, 0, "out", { x: 50, y: 90 })[0];
near(h.inX!, 50); near(h.inY!, 30, 1e-9, "mirrored, same length (20)");
h = moveHandle(sm, 0, "out", { x: 50, y: 90 }, true)[0];
near(h.inX!, 30); near(h.inY!, 50);
// a corner anchor with one handle: dragging it doesn't invent the other
h = moveHandle([{ x: 0, y: 0, outX: 5, outY: 0 }], 0, "out", { x: 9, y: 9 })[0];
assert.equal(h.inX, undefined);

// --- toggle smooth: corner -> handles along neighbours; smooth -> corner
const three = [{ x: 0, y: 0 }, { x: 30, y: 30 }, { x: 60, y: 0 }];
const t = toggleSmooth(three, 1, false)[1];
near(t.inY!, 30); near(t.outY!, 30); assert.ok(t.inX! < 30 && t.outX! > 30);
const back = toggleSmooth(toggleSmooth(three, 1, false), 1, false)[1];
assert.equal(back.inX, undefined); assert.equal(back.outX, undefined);

// --- inserting an anchor leaves a straight line a straight line, and a curve exactly the same curve
let ins = insertAnchor([{ x: 0, y: 0 }, { x: 10, y: 0 }], false, 0, 0.5);
assert.deepEqual(ins.points, [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]); assert.equal(ins.index, 1);
const curve = [{ x: 0, y: 0, outX: 0, outY: -10 }, { x: 10, y: 0, inX: 10, inY: -10 }];
const split = insertAnchor(curve, false, 0, 0.3);
assert.equal(split.points.length, 3);
const orig = [{ x: 0, y: 0 }, { x: 0, y: -10 }, { x: 10, y: -10 }, { x: 10, y: 0 }] as const;
const A = split.points[0], M = split.points[1], B = split.points[2];
for (let i = 0; i <= 10; i++) {
  const u = i / 10;
  const first = cubicAt([{ x: A.x, y: A.y }, { x: A.outX!, y: A.outY! }, { x: M.inX!, y: M.inY! }, { x: M.x, y: M.y }], u);
  const o1 = cubicAt([...orig] as never, u * 0.3);
  near(first.x, o1.x, 1e-9); near(first.y, o1.y, 1e-9);
  const second = cubicAt([{ x: M.x, y: M.y }, { x: M.outX!, y: M.outY! }, { x: B.inX!, y: B.inY! }, { x: B.x, y: B.y }], u);
  const o2 = cubicAt([...orig] as never, 0.3 + u * 0.7);
  near(second.x, o2.x, 1e-9); near(second.y, o2.y, 1e-9);
}
// closing segment split appends the new anchor at the end
const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
const closing = insertAnchor(sq, true, 3, 0.5);
assert.equal(closing.points.length, 5); assert.equal(closing.index, 4); assert.deepEqual([closing.points[4].x, closing.points[4].y], [0, 5]);

// --- nearest point
const n1 = nearestOnPath(sq, true, { x: 5, y: -3 })!;
assert.equal(n1.segment, 0); near(n1.at.x, 5, 0.3); near(n1.at.y, 0, 1e-9);
const n2 = nearestOnPath(sq, true, { x: -3, y: 5 })!;
assert.equal(n2.segment, 3);
assert.equal(nearestOnPath([], false, { x: 0, y: 0 }), null);

// --- removing anchors
assert.equal(removeAnchors(sq, new Set([1, 2])).length, 2);

// --- shapes: tight to the box, right count, symmetric
const hex = polygonPoints(6);
assert.equal(hex.length, 6);
for (const p of hex) { assert.ok(p.x >= -1e-9 && p.x <= 1 + 1e-9 && p.y >= -1e-9 && p.y <= 1 + 1e-9); }
assert.ok(hex.some((p) => Math.abs(p.y) < 1e-9) && hex.some((p) => Math.abs(p.y - 1) < 1e-9), "touches top and bottom");
near(polygonPoints(3)[0].x, 0.5, 1e-9, "triangle apex centred");
const star = starPoints(5, 0.4);
assert.equal(star.length, 10);
near(star[0].x, 0.5, 1e-9); near(star[0].y, 0, 1e-9);
assert.equal(polygonPoints(1).length, 3, "never fewer than 3 sides");
assert.equal(polygonPoints(500).length, 60);
console.log("path: all assertions passed");
