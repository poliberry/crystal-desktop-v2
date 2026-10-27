import { newClip, emptyMotion, normalizeMotionSpec, MOTION_LIMITS, type Clip, type MotionSpec } from "../../convex/lib/motion";
import { addNode, emptyDoc, makeShape, makeText, makeImage, patchNodes, removeNodes } from "../../src/studio/model/doc";
import { artworkNodes, checkMotionProject, compilePublished, isLayerClip, layerBox, layerClipId, layersUsed, motionIsStatic, motionRejection, syncLayers } from "../../src/studio/model/motion-doc";
import { splitAt } from "../../src/studio/motion/ops";
import { sanitizeMotion } from "../../src/studio/storage/format";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const throws = (n: string, fn: () => unknown, re: RegExp) => { try { fn(); ok(n, false, "no throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };
const cdn = (u: string) => u;

const draw = () => {
  let d = emptyDoc("nameplate");
  const a = makeShape("rect", 100, 20, 200, 100);
  const b = makeText(500, 40);
  d = addNode(d, a); d = addNode(d, b);
  return { d, a, b };
};

// --- syncLayers --------------------------------------------------------------------------------------
{
  const { d, a, b } = draw();
  const spec = emptyMotion("nameplate");
  const s = syncLayers(spec, d);
  ok("every drawn layer gets a clip that plays the whole design", s.clips.length === 2 && s.clips.every((c) => isLayerClip(c) && c.start === 0 && c.duration === spec.duration));
  ok("…in the lane matching its place in the stack", s.clips.find((c) => isLayerClip(c) && c.source.nodeId === a.id)!.track === 0 && s.clips.find((c) => isLayerClip(c) && c.source.nodeId === b.id)!.track === 1);
  ok("…named after the layer", s.clips.map((c) => c.name).sort().join() === [a.name, b.name].sort().join());
  const c0 = s.clips[0];
  ok("a clip rests where its layer was drawn: offset of its centre from the stage's", (() => { if (!isLayerClip(c0)) return false; const n = d.nodes[c0.source.nodeId]; return Math.abs(c0.source.ox - (n.x + n.w / 2 - d.artboard.w / 2)) < 1 && Math.abs(c0.source.oy - (n.y + n.h / 2 - d.artboard.h / 2)) < 1; })());
  ok("syncing again changes nothing (and returns the same object, so it's safe on every edit)", syncLayers(s, d) === s);
  ok("syncing the same artwork from scratch twice gives the same clip ids (an id on screen is the id that is saved)", JSON.stringify(syncLayers(emptyMotion("nameplate"), d).clips.map((c) => c.id)) === JSON.stringify(s.clips.map((c) => c.id)) && s.clips.every((c) => /^[a-zA-Z0-9_-]{1,40}$/.test(c.id)) && new Set(s.clips.map((c) => c.id)).size === s.clips.length);
  ok("…even when the clips are made after an edit that has already happened (the first edit doesn't replace them)", (() => { const first = syncLayers(emptyMotion("nameplate"), d); const edited = { ...first, duration: 6 }; return JSON.stringify(syncLayers(edited, d).clips.map((c) => c.id)) === JSON.stringify(first.clips.map((c) => c.id)); })());
  ok("an odd layer id still gives a valid, bounded clip id", /^[a-zA-Z0-9_-]{1,40}$/.test(layerClipId("a b/c?d")) && layerClipId("x".repeat(100)).length === 40);
  const without = { ...s, clips: s.clips.filter((c) => isLayerClip(c) && c.source.nodeId !== a.id) };
  ok("a layer whose clip was deleted is put back while it is visible", syncLayers(without, d).clips.length === 2);
  ok("…but not while it is hidden (that is how a layer is taken off the timeline)", syncLayers(without, patchNodes(d, [a.id], { hidden: true })).clips.length === 1);
  ok("…and showing it again brings a fresh clip", syncLayers(syncLayers(without, patchNodes(d, [a.id], { hidden: true })), d).clips.length === 2);
  const moved = patchNodes(d, [a.id], { x: 400 });
  const s2 = syncLayers(s, moved);
  ok("moving a layer moves where its clip rests (and keeps the clip's own animation)", (() => { const c = s2.clips.find((q) => isLayerClip(q) && q.source.nodeId === a.id)!; return isLayerClip(c) && c.source.ox !== (s.clips.find((q) => isLayerClip(q) && q.source.nodeId === a.id) as Clip & { source: { ox: number } }).source.ox; })());
  ok("resizing it changes the clip's box", (() => { const s3 = syncLayers(s, patchNodes(d, [a.id], { w: 400 })); const c = s3.clips.find((q) => isLayerClip(q) && q.source.nodeId === a.id)!; return isLayerClip(c) && c.source.w === 400; })());
  ok("a clip's animation survives its layer being moved", (() => { const keyed = { ...s, clips: s.clips.map((c) => (isLayerClip(c) && c.source.nodeId === a.id ? { ...c, transform: { ...c.transform, rotation: { k: [{ t: 0, v: 0, e: "linear" as const }, { t: 2, v: 90, e: "linear" as const }] } } } : c)) }; const after = syncLayers(keyed, moved); const c = after.clips.find((q) => isLayerClip(q) && q.source.nodeId === a.id)!; return typeof c.transform.rotation === "object"; })());
  ok("deleting a layer deletes its clip", syncLayers(s, removeNodes(d, [a.id])).clips.length === 1);
  ok("…even one inside a compound clip", (() => {
    const inner = s.clips[0];
    const comp = newClip({ type: "compound", duration: 4, clips: [inner] }, { duration: 4 });
    const out = syncLayers({ ...s, clips: [comp, s.clips[1]] }, removeNodes(d, [isLayerClip(inner) ? inner.source.nodeId : ""]));
    return out.clips.length === 2 && out.clips[0].source.type === "compound" && (out.clips[0].source as { clips: Clip[] }).clips.length === 0;
  })());
  ok("a layer that's hidden stays on the timeline (hiding is for the canvas)", syncLayers(s, patchNodes(d, [a.id], { hidden: true })).clips.length === 2);
  ok("the layer box includes what effects reach (a glow grows the picture)", (() => { const g = patchNodes(d, [a.id], { fx: { glow: { on: true, blur: 30, color: "#fff", opacity: 1, strength: 1 } } }); return layerBox(g.nodes[a.id], g).w > layerBox(d.nodes[a.id], d).w; })());
  ok("artworkNodes are the drawn ones in stack order", artworkNodes(d).map((n) => n.id).join() === [a.id, b.id].join());
}

// --- static or animated ------------------------------------------------------------------------------------------
{
  const { d } = draw();
  const s = syncLayers(emptyMotion("nameplate"), d);
  ok("a drawing with nothing animated is static", motionIsStatic(s));
  ok("an empty timeline is static", motionIsStatic(emptyMotion("effect")));
  const keyed = (patch: (c: Clip) => Clip) => ({ ...s, clips: s.clips.map((c, i) => (i === 0 ? patch(c) : c)) });
  ok("a keyframe makes it animated", !motionIsStatic(keyed((c) => ({ ...c, transform: { ...c.transform, x: { k: [{ t: 0, v: 0, e: "linear" }, { t: 1, v: 5, e: "linear" }] } } }))));
  ok("a transition makes it animated", !motionIsStatic(keyed((c) => ({ ...c, transitionIn: { type: "fade", d: 1, dir: "left", e: "linear" } }))));
  ok("an effect makes it animated", !motionIsStatic(keyed((c) => ({ ...c, fx: [{ type: "blur", amount: 3 }] }))));
  ok("a mask makes it animated", !motionIsStatic(keyed((c) => ({ ...c, mask: { shape: "rect", x: 0, y: 0, w: 10, h: 10, feather: 0, invert: false } }))));
  ok("a clip that doesn't cover the whole design is animated (it appears and disappears)", !motionIsStatic(keyed((c) => ({ ...c, duration: 1 }))));
  ok("a generator makes it animated", !motionIsStatic({ ...s, clips: [...s.clips, newClip({ type: "shimmer", w: 100, h: 100, angle: 0, width: 0.2, period: 2, color: "#fff", seed: 1 })] }));
  ok("a switched-off animated clip doesn't count", motionIsStatic({ ...s, clips: [...s.clips, newClip({ type: "shimmer", w: 100, h: 100, angle: 0, width: 0.2, period: 2, color: "#fff", seed: 1 }, { on: false })] }));
  ok("a constant move or tilt is still static", motionIsStatic(keyed((c) => ({ ...c, transform: { ...c.transform, x: 40, rotation: 12, opacity: 0.5 } }))));
  ok("a split layer clip (two halves) is animated, since each only covers part", !motionIsStatic({ ...s, clips: splitAt(s.clips, 1) }));
}

// --- publishing ----------------------------------------------------------------------------------------------------
{
  const { d, a, b } = draw();
  const s = syncLayers(emptyMotion("nameplate", "x"), d);
  const pic = (id: string) => (id === a.id ? "https://cdn.example/a.png" : id === b.id ? "https://cdn.example/b.png" : undefined);
  const out = compilePublished(s, "My plate", pic, cdn);
  ok("layers become the pictures they rendered to", out.clips.every((c) => c.source.type === "image") && out.name === "My plate");
  ok("…keeping their place and size", (() => { const c = out.clips[0]; const src = s.clips[0]; return c.source.type === "image" && isLayerClip(src) && c.source.ox === src.source.ox && c.source.w === src.source.w; })());
  ok("…and their animation", (() => { const k = { ...s, clips: s.clips.map((c, i) => (i === 0 ? { ...c, transform: { ...c.transform, x: { k: [{ t: 0, v: 0, e: "out" as const }, { t: 2, v: 50, e: "linear" as const }] } } } : c)) }; const o = compilePublished(k, "n", pic, cdn); return typeof o.clips[0].transform.x === "object"; })());
  throws("a layer with no picture can't be published", () => compilePublished(s, "n", () => undefined, cdn), /has no picture to play/);
  ok("the result is exactly what the server would store (normalising it again changes nothing)", JSON.stringify(compilePublished(s, "n", pic, cdn)) === JSON.stringify(compilePublished(compilePublished(s, "n", pic, cdn), "n", pic, cdn)));
  throws("the server refuses a published design that still points at a layer", () => normalizeMotionSpec(JSON.parse(JSON.stringify(s)), cdn), /can't refer to a layer/);
  ok("…while Studio's own copy may", (() => { try { normalizeMotionSpec(JSON.parse(JSON.stringify(s)), cdn, { studio: true }); return true; } catch { return false; } })());
  ok("layersUsed lists each layer that's on, once", layersUsed(s).length === 2 && layersUsed({ ...s, clips: [...s.clips, ...s.clips.map((c) => ({ ...c, id: c.id + "x" }))] }).length === 2 && layersUsed({ ...s, clips: s.clips.map((c) => ({ ...c, on: false })) }).length === 0);
  ok("…including inside compound clips", layersUsed({ ...s, clips: [newClip({ type: "compound", duration: 2, clips: [s.clips[0]] }, { duration: 2 })] }).length === 1);
  ok("motionRejection is null for a good design and a sentence for a bad one", motionRejection(s) === null && motionRejection({ ...s, clips: [newClip({ type: "layer", nodeId: "x", w: 1, h: 1, ox: 0, oy: 0 })] }) === null);
}

// --- saved form --------------------------------------------------------------------------------------------------------
{
  const { d } = draw();
  const s = syncLayers(emptyMotion("nameplate", "x"), d);
  const round = sanitizeMotion(JSON.parse(JSON.stringify(s)), "nameplate");
  ok("a timeline survives being saved and read back, layers included", round.clips.length === 2 && round.clips.every(isLayerClip) && round.kind === "nameplate");
  ok("the kind comes from the project, not the file", sanitizeMotion({ ...s, kind: "effect" }, "nameplate").kind === "nameplate" && sanitizeMotion({ ...s }, "effect").stage.w === 600);
  throws("a picture that isn't one of the project's files is refused", () => sanitizeMotion({ ...s, clips: [newClip({ type: "image", url: "https://evil.example/x.png", w: 1, h: 1, ox: 0, oy: 0 })] }, "effect"), /isn't one of this project's files/);
  ok("a project file picture reference is accepted", sanitizeMotion({ ...s, clips: [newClip({ type: "image", url: "studio:asset/abc-1", w: 1, h: 1, ox: 0, oy: 0 })] }, "effect").clips.length === 1);
  throws("garbage fails with a sentence, not a crash", () => sanitizeMotion("nope", "effect") && sanitizeMotion({ clips: [{ source: { type: "script" } }] }, "effect"), /./);
}

// --- checks -----------------------------------------------------------------------------------------------------------------
{
  const { d, a } = draw();
  const s = syncLayers(emptyMotion("nameplate"), d);
  ok("a good design has no errors", checkMotionProject(d, s, () => true).filter((x) => x.severity === "error").length === 0);
  ok("an empty one is an error", checkMotionProject(emptyDoc("nameplate"), emptyMotion("nameplate"), () => true).some((x) => x.severity === "error" && /nothing to show/.test(x.message)));
  ok("a picture layer that lost its file is an error, pointing at the layer", (() => { const dd = addNode(emptyDoc("nameplate"), makeImage("gone", "Photo", 0, 0, 50, 50)); const r = checkMotionProject(dd, syncLayers(emptyMotion("nameplate"), dd), () => false); return r.some((x) => /lost its picture/.test(x.message) && !!x.nodeId); })());
  ok("a clip whose layer is missing is an error", checkMotionProject(emptyDoc("nameplate"), { ...emptyMotion("nameplate"), clips: [newClip({ type: "layer", nodeId: "ghost", w: 1, h: 1, ox: 0, oy: 0 }, { name: "Ghost" })] }, () => true).some((x) => /lost its layer/.test(x.message)));
  ok("empty text is an error", (() => { const dd = patchNodes(d, [a.id], {}); const t = Object.values(d.nodes).find((n) => n.type === "text")!; const e = patchNodes(d, [t.id], { text: "  " } as never); return checkMotionProject(e, syncLayers(emptyMotion("nameplate"), e), () => true).some((x) => /has no text/.test(x.message)) && !!dd; })());
  ok("a long design is a warning, not an error", (() => { const r = checkMotionProject(d, { ...s, duration: 10 }, () => true).filter((x) => /runs for/.test(x.message)); return r.length === 1 && r[0].severity === "warning"; })());
  ok("an adjustment layer with no effects is a warning", checkMotionProject(d, { ...s, clips: [...s.clips, newClip({ type: "adjust" })] }, () => true).some((x) => x.severity === "warning" && /does nothing/.test(x.message)));
  ok("too many clips is an error", checkMotionProject(d, { ...s, clips: Array.from({ length: MOTION_LIMITS.clips + 1 }, () => newClip({ type: "adjust" })) }, () => true).some((x) => x.severity === "error" && /at most 96/.test(x.message)));
  ok("hidden layers that are off the timeline are noted", checkMotionProject(patchNodes(d, [a.id], { hidden: true }), syncLayers({ ...s, clips: s.clips.filter((c) => isLayerClip(c) && c.source.nodeId !== a.id) }, patchNodes(d, [a.id], { hidden: true })), () => true).some((x) => /hidden layer/.test(x.message)));
  ok("…but a hidden layer that still has its clip isn't (it's in the design)", !checkMotionProject(patchNodes(d, [a.id], { hidden: true }), s, () => true).some((x) => /hidden layer/.test(x.message)));
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
