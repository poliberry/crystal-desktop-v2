import assert from "node:assert/strict";
import { expandGroups, groupNodes, ungroupNodes, duplicateNodes, emptyDoc, addNode, makeShape, makePathFromWorld, makeShapePath, makeLine, groupAt, removeNodes, replaceNodes, groupExists } from "../../src/studio/model/doc.ts";
import { dragScale, oppositeAnchor, rotateNodes, scaleNodes } from "../../src/studio/model/transform.ts";
import { sanitizeDoc } from "../../src/studio/storage/format.ts";
import { hasFx, fxBox } from "../../src/studio/model/fx.ts";
import { compileLayers, checkCosmetic } from "../../src/studio/model/compile.ts";

const near = (a: number, b: number, e = 1e-9, m = "") => assert.ok(Math.abs(a - b) <= e, `${m} ${a} !~ ${b}`);
const rect = (id: string, x: number, y: number, w = 20, h = 20, rotation = 0) => ({ ...makeShape("rect", x, y, w, h), id, rotation });
let doc = emptyDoc("decoration");
for (const [id, x] of [["a", 0], ["b", 50], ["c", 100], ["d", 150]] as const) doc = addNode(doc, rect(id, x, 0));

// --- grouping: needs two; brings members together at the topmost one's place, in order
assert.equal(groupNodes(doc, ["a"]), null);
const g = groupNodes(doc, ["a", "c"])!;
assert.deepEqual(g.doc.order, ["b", "a", "c", "d"], "a joins c's place; b stays below, d above");
assert.equal(g.doc.nodes.a.group, g.tag); assert.equal(g.doc.nodes.c.group, g.tag); assert.equal(g.doc.nodes.b.group, undefined);
assert.deepEqual(expandGroups(g.doc, ["a"]), ["a", "c"], "clicking one selects the group");
assert.deepEqual(expandGroups(g.doc, ["b"]), ["b"]);
// locked members aren't grouped
const locked = { ...doc, nodes: { ...doc.nodes, a: { ...doc.nodes.a, locked: true } } };
assert.equal(groupNodes(locked, ["a", "b"]), null, "one unlocked is not enough");
// grouping a group with another object NESTS it: a, c stay a group inside the new one
const g2 = groupNodes(g.doc, ["a", "d"])!;
assert.equal(g2.doc.nodes.a.group, `${g2.tag}/${g.tag}`); assert.equal(g2.doc.nodes.c.group, `${g2.tag}/${g.tag}`); assert.equal(g2.doc.nodes.d.group, g2.tag);
assert.deepEqual(expandGroups(g2.doc, ["d"]).sort(), ["a", "c", "d"], "clicking selects the outermost group");
// working inside the outer group, clicking a selects only the inner group (a, c); d stands alone
assert.deepEqual(expandGroups(g2.doc, ["a"], g2.tag).sort(), ["a", "c"]);
assert.deepEqual(expandGroups(g2.doc, ["d"], g2.tag), ["d"]);
assert.deepEqual(groupAt(g2.doc, "a", ""), [g2.tag]); assert.deepEqual(groupAt(g2.doc, "a", g2.tag), [g2.tag, g.tag]); assert.equal(groupAt(g2.doc, "d", g2.tag), null);
// a scope that doesn't contain the object doesn't apply to it
assert.deepEqual(groupAt(g2.doc, "b", g2.tag), null);
assert.equal(groupAt(g2.doc, "a", "nonsense"), null, "a scope the object is not in does not apply (the editor drops stale scopes)");
// grouping inside the outer group makes the new group inside it
const inner = groupNodes(g2.doc, ["a", "d"], g2.tag)!;
assert.equal(inner.doc.nodes.d.group, `${g2.tag}/${inner.tag}`); assert.equal(inner.doc.nodes.a.group, `${g2.tag}/${inner.tag}/${g.tag}`);
// grouping a lone group (one unit) does nothing
assert.equal(groupNodes(g.doc, ["a", "c"]), null, "a, c are one group already");
// ungroup removes one level: the outer group goes, the inner stays
const un1 = ungroupNodes(g2.doc, ["d"]);
assert.equal(un1.nodes.d.group, undefined); assert.equal(un1.nodes.a.group, g.tag); assert.equal(un1.nodes.c.group, g.tag);
// ungroup inside the outer group removes just the inner one
const un2 = ungroupNodes(g2.doc, ["a"], g2.tag);
assert.equal(un2.nodes.a.group, g2.tag); assert.equal(un2.nodes.d.group, g2.tag);
// ungroup dissolves the whole group even if only one is selected
const u = ungroupNodes(g.doc, ["c"]);
assert.equal(u.nodes.a.group, undefined); assert.equal(u.nodes.c.group, undefined);
assert.equal(ungroupNodes(doc, ["a"]), doc, "nothing to do returns the same doc");
assert.equal(ungroupNodes(g2.doc, ["d"], g2.tag), g2.doc, "d is alone at that level: nothing to ungroup");

// --- deleting down to one member dissolves the group; nested levels tidy too
const left = removeNodes(g.doc, ["c"]);
assert.equal(left.nodes.a.group, undefined, "a group of one is no group");
const left2 = removeNodes(g2.doc, ["d"]);
assert.equal(left2.nodes.a.group, `${g2.tag}/${g.tag}`, "outer still has two members (a, c): it stays");
const left3 = removeNodes(g2.doc, ["c"]);
assert.equal(left3.nodes.a.group, g2.tag, "inner group of one dissolves; a stays in the outer with d");
assert.equal(groupExists(g2.doc, g2.tag), true); assert.equal(groupExists(left, g.tag), false); assert.equal(groupExists(g2.doc, ""), true);
// replacing nodes takes the topmost one's place
const rep = replaceNodes(doc, ["a", "c"], { ...doc.nodes.a, id: "z" } as never);
assert.deepEqual(rep.order, ["b", "z", "d"]); assert.equal(rep.nodes.a, undefined);

// --- duplicating a group makes a new group of the copies
const dup = duplicateNodes(g.doc, ["a", "c"], 0);
const tags = new Set(dup.ids.map((i) => dup.doc.nodes[i].group));
assert.equal(tags.size, 1); assert.ok(!tags.has(g.tag), "copy has its own group");
assert.equal(g.doc.nodes.a.group, g.tag);
// a nested group copies with every level renewed, still nested in the same shape
const dup2 = duplicateNodes(g2.doc, ["a", "c", "d"], 0);
const [ca, cc, cd] = dup2.ids.map((i) => dup2.doc.nodes[i].group!);
assert.ok(ca === cc && ca.includes("/") && ca.startsWith(cd + "/"), "inner stays inside outer");
assert.ok(![g2.tag, g.tag].some((t) => ca.includes(t)), "no tag shared with the originals");

// --- scale: about an anchor
const s2 = scaleNodes([rect("a", 0, 0, 20, 20), rect("b", 40, 0, 20, 20)] as never, { x: 0, y: 0 }, 2, 3);
assert.deepEqual(s2.map((p) => [p.patch.x, p.patch.y, p.patch.w, p.patch.h]), [[0, 0, 40, 60], [80, 0, 40, 60]]);
// text scales type with height
const tx = { ...doc.nodes.a, type: "text", text: "x", fontSize: 10, fontWeight: 400, italic: false, align: "left", color: "#fff", stroke: "#000", strokeWidth: 0 } as never;
assert.equal((scaleNodes([tx], { x: 0, y: 0 }, 2, 2)[0].patch as { fontSize: number }).fontSize, 20);
// a rotated member forces uniform scaling for everyone
const mixed = scaleNodes([rect("a", 0, 0, 20, 20), rect("b", 40, 0, 20, 20, 30)] as never, { x: 0, y: 0 }, 2, 3);
near(mixed[0].patch.w!, mixed[0].patch.h!, 1e-9, "uniform"); near(mixed[0].patch.w!, 60, 1e-9, "larger factor wins");
// quarter turns may be stretched unevenly, with the axes swapped
const q = scaleNodes([rect("a", 0, 0, 20, 10, 90)] as never, { x: 0, y: 0 }, 2, 3)[0].patch;
near(q.w!, 60); near(q.h!, 20);
// no flipping
assert.ok(scaleNodes([rect("a", 0, 0, 20, 20)] as never, { x: 0, y: 0 }, -1, -1)[0].patch.w! > 0);
// scaling a floor line only moves it
const floor = { ...doc.nodes.a, type: "floor", y: 50, w: 400, h: 4 } as never;
const fp = scaleNodes([floor], { x: 0, y: 0 }, 2, 2)[0].patch;
assert.equal(fp.w, 400); assert.equal(fp.x, 0);

// --- rotate about a pivot
const r = rotateNodes([rect("a", 10, -10, 20, 20)] as never, { x: 0, y: 0 }, 90)[0].patch;
// centre (20,0) swings to (0,20): box origin (-10,10)
near(r.x!, -10, 1e-9); near(r.y!, 10, 1e-9); assert.equal(r.rotation, 90);
const wrap = rotateNodes([rect("a", 0, 0, 20, 20, 170)] as never, { x: 10, y: 10 }, 30)[0].patch;
assert.equal(wrap.rotation, -160, "wraps into (-180,180]");
// a full turn round the middle of a pair leaves it where it was
const pair = [rect("a", 0, 0, 20, 20), rect("b", 40, 0, 20, 20)] as never[];
const back = rotateNodes(pair, { x: 30, y: 10 }, 360);
near(back[0].patch.x!, 0, 1e-9); near(back[1].patch.x!, 40, 1e-9);

// --- drag scale
const anchor = oppositeAnchor({ x: 0, y: 0, w: 100, h: 50 }, 1, 1);
assert.deepEqual(anchor, { x: 0, y: 0 });
let ds = dragScale({ w: 100, h: 50 }, 1, 1, anchor, { x: 200, y: 50 }, false);
near(ds.sx, 2); near(ds.sy, 1);
ds = dragScale({ w: 100, h: 50 }, 1, 1, anchor, { x: 200, y: 50 }, true);
near(ds.sx, 2); near(ds.sy, 2);
ds = dragScale({ w: 100, h: 50 }, 1, 0, anchor, { x: 150, y: 999 }, true);
near(ds.sx, 1.5); near(ds.sy, 1, 1e-9, "an edge handle leaves the other axis");
assert.deepEqual(oppositeAnchor({ x: 0, y: 0, w: 100, h: 50 }, -1, 0), { x: 100, y: 25 });

// --- paths are always baked, and counted against the layer limit
const line = makeLine({ x: 10, y: 10 }, { x: 110, y: 10 })!;
assert.equal(hasFx(line), true);
assert.equal(line.h, 1, "a flat line has a box"); 
const star = makeShapePath({ kind: "star", points: 5, inner: 0.5 }, { x: 0, y: 0, w: 100, h: 100 });
assert.equal(star.points.length, 10); assert.equal(star.live?.kind, "star");
assert.equal(makePathFromWorld([{ x: 0, y: 0 }], false), null, "one point is not a path");
let pd = emptyDoc("decoration");
pd = addNode(pd, line); pd = addNode(pd, star);
const layers = compileLayers(pd, undefined, (id) => `https://cdn/${id}.png`);
assert.equal(layers.length, 2); assert.ok(layers.every((l) => l.kind === "image" && l.url.startsWith("https://cdn/")), "sent as picture layers");
const box = fxBox({ ...line, strokeWidth: 8 } as never);
assert.ok(box.h >= 8, "box grows to hold the stroke: " + box.h);
assert.equal(checkCosmetic(pd, () => true).filter((p) => p.severity === "error").length, 0, "two baked paths pass the cosmetic checks");

// --- a path survives save and load; hostile paths don't
const saved = JSON.parse(JSON.stringify(pd));
saved.nodes[line.id].group = "g1abc/g2def";
const loaded = sanitizeDoc(saved, "decoration");
assert.equal((loaded.nodes[line.id] as any).type, "path"); assert.equal(loaded.nodes[line.id].group, "g1abc/g2def");
assert.equal((loaded.nodes[star.id] as any).live.kind, "star");
assert.equal((loaded.nodes[star.id] as any).points.length, 10);
const evil = sanitizeDoc({ artboard: { w: 100, h: 100 }, order: ["p", "q", "r"], nodes: {
  p: { id: "p", type: "path", name: "p", x: 0, y: 0, w: 10, h: 10, points: [{ x: 0, y: 0 }] },
  q: { id: "q", type: "path", name: "q", x: 0, y: 0, w: 10, h: 10, points: [{ x: 0, y: 0 }, { x: 1e12, y: NaN }, { x: 1, y: 1, inX: "x" }], strokeWidth: 1e9, cap: "evil", group: "bad group!!" },
  r: { id: "r", type: "path", name: "r", x: 0, y: 0, w: 10, h: 10, points: Array.from({ length: 5000 }, (_, i) => ({ x: i, y: i })) },
} }, "decoration");
assert.equal(loaded.nodes[line.id].type, "path");
assert.equal(evil.nodes.p, undefined, "one point: dropped");
const qn = evil.nodes.q as any;
assert.equal(qn.points.length, 2, "NaN dropped, 1e12 clamped in"); assert.equal(qn.points[1].inX, undefined);
assert.equal(qn.strokeWidth, 400); assert.equal(qn.cap, "round"); assert.equal(qn.group, undefined);
assert.equal((evil.nodes.r as any).points.length, 500);
console.log("group/path: all assertions passed");
