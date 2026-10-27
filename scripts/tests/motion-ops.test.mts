import { defaultTransform, newClip, sampleClip, type Clip, type MotionSpec, emptyMotion, evalProp } from "../../convex/lib/motion";
import {
  FPS, addClip, breakApart, canBreakApart, deleteClips, duplicateClips, fitDuration, freeTrack, freezeProp, hasKeys, keyTimes, makeCompound, mapScope, moveClips, moveKey,
  neighbourKeys, parseTimecode, pathTo, removeKeyAt, retimeConstant, rgbaToHex, scopeOf, setDuration, setKey, setKeyEase, setTransition, shiftProp, snapFrame, snapPoints, snapTime, speedRamp,
  splitAt, splitClip, timecode, trimEnd, trimStart, valueAt, endOf,
  animatedProps, clearKeys, clipQuad, getPath, keyedAt, setPath, setPropAt, toggleKeyAt, valueRange,
} from "../../src/studio/motion/ops";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;
const stage = { w: 600, h: 700 };
const solid = () => ({ type: "solid" as const, w: 100, h: 100, color: "#ff0000" });
const k = (...pairs: [number, number][]) => ({ k: pairs.map(([t, v]) => ({ t, v, e: "linear" as const })) });
const compound = (duration: number, clips: Clip[]) => ({ type: "compound" as const, duration, clips });

// --- timecode ---------------------------------------------------------------------------------------
{
  ok("timecode shows minutes:seconds:frames", timecode(0) === "0:00:00" && timecode(1) === "0:01:00" && timecode(61.5) === "1:01:15" && timecode(2 / 30) === "0:00:02");
  ok("it reads back", near(parseTimecode(timecode(12.4))!, snapFrame(12.4)) && parseTimecode("1:30")! === 90 && parseTimecode("2.5")! === 2.5 && parseTimecode("2.5s")! === 2.5 && parseTimecode("0:01:15")! === 1.5);
  ok("junk doesn't parse", parseTimecode("hello") === null && parseTimecode("") === null && parseTimecode("1:2:3:4") === null);
  ok("negative time shows as zero", timecode(-5) === "0:00:00");
  ok("frames round", snapFrame(0.0166) === 0.0333333333333333 / 2 * 0 + snapFrame(0.0166) && snapFrame(1 / 30 + 0.001) === 1 / 30);
}

// --- keyframes ----------------------------------------------------------------------------------------
{
  const c = setKey(5, 1, 50);
  ok("keying a constant starts the animation from the constant (nothing jumps before the key)", hasKeys(c) && valueAt(c, 0) === 5 && near(valueAt(c, 1), 50), c);
  ok("…and a key at 0 doesn't duplicate the start", (() => { const d = setKey(5, 0, 9); return typeof d === "object" && d.k.length === 1 && valueAt(d, 0) === 9; })());
  const two = setKey(setKey(0, 0, 0), 2, 100);
  ok("keys stay sorted", (() => { const m = setKey(two, 1, 7); return keyTimes(m).join() === "0,1,2"; })());
  ok("a key within half a frame is replaced, not added", keyTimes(setKey(two, 2 + 1 / 90, 40)).length === 2 && near(valueAt(setKey(two, 2 + 1 / 90, 40), 2), 40));
  ok("replacing keeps the easing unless one is given", (() => { const e = setKeyEase(two, 0, "out"); return (setKey(e, 0, 3) as { k: { e: unknown }[] }).k[0].e === "out" && (setKey(e, 0, 3, "in") as { k: { e: unknown }[] }).k[0].e === "in"; })());
  ok("removing a key leaves the rest", keyTimes(removeKeyAt(setKey(two, 1, 7), 1)).join() === "0,2");
  ok("removing down to one key makes a constant of it", removeKeyAt(two, 0) === 100);
  ok("removing where there's no key changes nothing", removeKeyAt(two, 1) === two);
  ok("a constant has no keys to remove", removeKeyAt(4, 0) === 4);
  ok("freezing makes the value at that moment the constant", freezeProp(two, 1) === 50 && freezeProp(8, 3) === 8);
  ok("moving a key moves it and resorts", keyTimes(moveKey(setKey(two, 1, 7), 1, 3)).join() === "0,2,3");
  ok("moving a key onto another replaces that one", (() => { const m = moveKey(setKey(two, 1, 7), 1, 2); return typeof m === "object" && m.k.length === 2 && valueAt(m, 2) === 7; })());
  ok("neighbour keys for stepping between them", (() => { const n = neighbourKeys(setKey(two, 1, 7), 1); return n.prev === 0 && n.next === 2; })() && neighbourKeys(5, 1).prev === null);
  ok("keys are limited, so a runaway can't make thousands", (() => { let q: ReturnType<typeof setKey> = 0; for (let i = 0; i < 200; i++) q = setKey(q as number, i / 30, i); return typeof q === "object" && q.k.length <= 64; })());
  ok("colours key too", (() => { const c2 = setKey("#ff0000", 1, "#0000ff"); return valueAt(c2, 0) === "#ff0000" && valueAt(c2, 1) === "#0000ff" && valueAt(c2, 0.5) === "#800080"; })());
  ok("rgba text back to hex, with alpha only when translucent", rgbaToHex("rgba(255,0,16,1)") === "#ff0010" && rgbaToHex("rgba(255,0,16,0.5)") === "#ff001080");

  // shiftProp: seen from d seconds later
  const a = k([0, 0], [2, 100], [4, 0]);
  const sh = shiftProp(a, 1);
  ok("cutting a clip's start keeps its animation where it was on the timeline", [0, 0.5, 1, 2, 3].every((t) => near(evalProp(sh, t), evalProp(a, t + 1))), [0, 0.5, 1, 2, 3].map((t) => [evalProp(sh, t), evalProp(a, t + 1)]));
  ok("…with a key at the cut so the value there doesn't jump", near(evalProp(sh, 0), 50) && keyTimes(shiftProp(a, 1))[0] === 0);
  ok("cutting past every key leaves the last value as a constant", shiftProp(a, 9) === 0);
  ok("extending earlier moves keys later", keyTimes(shiftProp(a, -1)).join() === "1,3,5" && near(evalProp(shiftProp(a, -1), 0), 0));
  ok("a constant is untouched", shiftProp(7, 3) === 7);
}

// --- split: the two halves play exactly as the one did -------------------------------------------------
function sameLook(orig: Clip[], now: Clip[], times: number[], label: string, skip: string[] = []) {
  for (const t of times) {
    const a = orig.map((c) => sampleClip(c, t, stage)).filter(Boolean);
    const b = now.map((c) => sampleClip(c, t, stage)).filter(Boolean);
    if (a.length !== b.length) return ok(`${label}: on screen at ${t}`, false, { a: a.length, b: b.length });
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!, y = b[i]!;
      const fields: (keyof typeof x)[] = ["x", "y", "sx", "sy", "rotation", "opacity", "src"];
      const bad = fields.filter((q) => !skip.includes(q as string)).find((q) => !near(x[q] as number, y[q] as number, 5e-3));
      if (bad) return ok(`${label}: ${bad} at t=${t}`, false, { was: x[bad], now: y[bad] });
    }
  }
  ok(label, true);
}
const times = (from: number, to: number, n = 40) => Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 0.37)) / n);
{
  const tf = { ...defaultTransform(), x: k([0, -100], [1, 100], [3, 0]), opacity: k([0, 0], [1, 1]), rotation: k([0, 0], [3, 90]) };
  const c = newClip({ type: "shape", shape: "star", w: 100, h: 100, fill: { k: [{ t: 0, v: "#ff0000", e: "linear" }, { t: 3, v: "#0000ff", e: "linear" }] }, stroke: "#fff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 }, { id: "a", start: 1, duration: 3, transform: tf });
  const parts = splitClip(c, 2.2)!;
  ok("a clip splits in two that meet at the cut", parts !== null && near(endOf(parts[0]), 2.2) && near(parts[1].start, 2.2) && near(endOf(parts[1]), endOf(c)));
  ok("…with different ids, the same name and track", parts[0].id !== parts[1].id && parts[0].name === parts[1].name && parts[0].track === parts[1].track);
  sameLook([c], parts, times(1, 4), "split: animation continues across the cut");

  const withSpeed = newClip(compound(2, [newClip(solid(), { start: 0, duration: 2, transform: { ...defaultTransform(), x: k([0, 0], [2, 200]) } })]), { id: "b", start: 0, duration: 5, speed: k([0, 0.5], [5, 2]), loop: true });
  const sp = splitClip(withSpeed, 2)!;
  sameLook([withSpeed], sp, times(0, 5, 50), "split: a speed ramp and loop continue across the cut");
  const rev = newClip(compound(3, [newClip(solid(), { start: 0, duration: 3, transform: { ...defaultTransform(), x: k([0, 0], [3, 300]) } })]), { id: "r", start: 0, duration: 3, reverse: true, loop: false });
  sameLook([rev], splitClip(rev, 1)!, times(0, 3, 30), "split: a reversed clip continues across the cut");
  sameLook([{ ...withSpeed, speed: 2, loop: false, duration: 1 }], splitClip({ ...withSpeed, speed: 2, loop: false, duration: 1 }, 0.4)!, times(0, 1, 20), "split: constant speed");

  const tr = newClip(solid(), { start: 0, duration: 4, transitionIn: { type: "fade", d: 1, dir: "left", e: "linear" }, transitionOut: { type: "fade", d: 1, dir: "left", e: "linear" } });
  const st = splitClip(tr, 2)!;
  ok("the first half keeps the in-transition and the second the out-transition", !!st[0].transitionIn && !st[0].transitionOut && !st[1].transitionIn && !!st[1].transitionOut);
  ok("a cut within a frame of an end isn't a split", splitClip(c, 1.001) === null && splitClip(c, 3.999) === null && splitClip(c, 0) === null && splitClip(c, 99) === null);
  ok("splitAt only blades what is under the playhead (and selected)", (() => {
    const x = newClip(solid(), { id: "x", start: 0, duration: 4 }), y = newClip(solid(), { id: "y", start: 0, duration: 4, track: 1 }), z = newClip(solid(), { id: "z", start: 5, duration: 1 });
    return splitAt([x, y, z], 2).length === 5 && splitAt([x, y, z], 2, new Set(["x"])).length === 4 && splitAt([x, y, z], 4.5).length === 3;
  })());
  ok("a switched-off clip isn't blade'd", splitAt([newClip(solid(), { start: 0, duration: 4, on: false })], 2).length === 1);
}

// --- trimming ----------------------------------------------------------------------------------------------
{
  const tf = { ...defaultTransform(), x: k([0, 0], [4, 400]) };
  const c = newClip(solid(), { id: "t", start: 1, duration: 4, transform: tf });
  const cut = trimStart(c, 2.5);
  ok("trimming the start shortens from the front", near(cut.start, 2.5) && near(endOf(cut), 5) && near(cut.duration, 2.5));
  sameLook([c], [cut], times(2.5, 5), "trim start: what remains plays as it did");
  ok("…and drops the in-transition (it was cut off)", !trimStart({ ...c, transitionIn: { type: "fade", d: 1, dir: "left", e: "linear" } }, 2).transitionIn);
  const comp = newClip(compound(10, [newClip(solid(), { duration: 10, transform: { ...defaultTransform(), x: k([0, 0], [10, 1000]) } })]), { id: "q", start: 0, duration: 10, in: 0, loop: false, speed: 2 });
  const compCut = trimStart({ ...comp, duration: 5 }, 1);
  sameLook([{ ...comp, duration: 5 }], [compCut], times(1, 5, 30), "trim start: a retimed source carries on from the same place");
  ok("the in-point moves by what the cut consumed (speed 2: 1 s cut = 2 s in)", near(compCut.in, 2), compCut.in);
  const longer = trimStart(c, 0.5);
  ok("extending earlier grows it and keeps what was there where it was", near(longer.start, 0.5) && near(endOf(longer), 5));
  // A generator's own clock has no start to run into, so it carries on from where the clip now begins; everything else is where it was.
  sameLook([c], [longer], times(1, 5), "trim start: extending earlier doesn't move what was there", ["src"]);
  const pulled = trimStart({ ...comp, start: 3, in: 1, duration: 4, speed: 1 }, 0);
  ok("a compound clip can only be pulled earlier by what is in front of its in-point (1 s here)", near(pulled.start, 2) && near(pulled.in, 0), pulled);
  ok("it can't be trimmed to nothing", trimStart(c, 99).duration >= 2 / 30 - 1e-9 && trimStart(c, 99).start <= endOf(c) - 2 / 30 + 1e-9);
  ok("it can't start before 0", trimStart(c, -5).start === 0);
  ok("a no-op returns the same clip", trimStart(c, c.start) === c);

  const e = trimEnd(c, 3, 12);
  ok("trimming the end shortens from the back", near(e.start, 1) && near(endOf(e), 3));
  ok("…and can't pass the end of the design", near(endOf(trimEnd(c, 99, 12)), 12) && near(trimEnd(c, 0, 12).duration, 2 / 30));
  ok("…and shrinks an out-transition that no longer fits", trimEnd({ ...c, transitionOut: { type: "fade", d: 3, dir: "left", e: "linear" } }, 2, 12).transitionOut!.d <= 1 + 1e-9);
  const revC = { ...comp, reverse: true, speed: 1, duration: 6 };
  sameLook([revC], [trimEnd(revC, 4, 12)], times(0, 4, 24), "trim end: a reversed clip keeps its picture put");
}

// --- moving and lanes ------------------------------------------------------------------------------------------
{
  const a = newClip(solid(), { id: "a", start: 0, duration: 2, track: 0 });
  const b = newClip(solid(), { id: "b", start: 3, duration: 2, track: 0 });
  const c = newClip(solid(), { id: "c", start: 1, duration: 2, track: 1 });
  ok("a clip moves by dt", near(moveClips([a, b], new Set(["a"]), 0.5, 0, 10).find((x) => x.id === "a")!.start, 0.5));
  ok("…and stops at the start of the design", moveClips([a], new Set(["a"]), -5, 0, 10)[0].start === 0);
  ok("…and at the end", near(endOf(moveClips([a], new Set(["a"]), 99, 0, 10)[0]), 10));
  ok("a group moves as one and keeps its spacing", (() => { const m = moveClips([a, b], new Set(["a", "b"]), 99, 0, 10); const [x, y] = [m[0], m[1]]; return near(endOf(y), 10) && near(y.start - x.start, 3); })());
  ok("moving onto another clip in its lane lifts it to a free lane", (() => { const m = moveClips([a, b], new Set(["a"]), 3, 0, 10); return m.find((x) => x.id === "a")!.track === 1; })());
  ok("…unless avoidance is off", moveClips([a, b], new Set(["a"]), 3, 0, 10, false).find((x) => x.id === "a")!.track === 0);
  ok("lanes are bounded to 0..31", moveClips([a], new Set(["a"]), 0, -5, 10)[0].track === 0 && moveClips([a], new Set(["a"]), 0, 99, 10)[0].track === 31);
  ok("freeTrack finds the first lane where it fits", freeTrack([a, c], 0.5, 1, 0) === 2 && freeTrack([a, c], 2, 1, 0) === 0 && freeTrack([a], 5, 1, 0) === 0);
  ok("adding a clip over another puts it on a free lane", addClip([a], newClip(solid(), { id: "n", start: 1, duration: 1, track: 0 })).find((x) => x.id === "n")!.track === 1);
  ok("moving nothing changes nothing", moveClips([a], new Set(["zzz"]), 1, 1, 10)[0] === a);
}

// --- snapping ----------------------------------------------------------------------------------------------------
{
  const a = newClip(solid(), { id: "a", start: 1, duration: 2 });
  const pts = snapPoints([a], { playhead: 5, duration: 8 });
  ok("snap points are the ends, the playhead and clip edges", [0, 8, 5, 1, 3].every((x) => pts.includes(x)));
  ok("a clip's own edges are excluded while it is dragged", !snapPoints([a], { playhead: 5, duration: 8, exclude: new Set(["a"]) }).includes(3));
  ok("a time near a point snaps to it", snapTime(3.04, pts, 0.1).t === 3 && snapTime(3.04, pts, 0.1).snapped === 3);
  ok("…the nearest one", snapTime(1.06, [1, 1.1], 0.2).t === 1.1);
  ok("far from everything it goes to the frame", near(snapTime(3.5, pts, 0.1).t, snapFrame(3.5)) && snapTime(3.5, pts, 0.1).snapped === null);
}

// --- deleting, duplicating ------------------------------------------------------------------------------------------
{
  const a = newClip(solid(), { id: "a", start: 0, duration: 2 });
  const b = newClip(solid(), { id: "b", start: 2, duration: 2 });
  const c = newClip(solid(), { id: "c", start: 5, duration: 1, track: 1 });
  ok("delete removes them", deleteClips([a, b, c], new Set(["b"])).map((x) => x.id).join() === "a,c");
  ok("ripple delete closes the gap in the same lane only", (() => { const r = deleteClips([a, b, c], new Set(["a"]), true); return near(r.find((x) => x.id === "b")!.start, 0) && near(r.find((x) => x.id === "c")!.start, 5); })());
  const d = duplicateClips([a, b], new Set(["a"]), 10);
  ok("a duplicate is a copy with a new id, placed after the original", d.clips.length === 3 && d.ids.length === 1 && d.ids[0] !== "a" && d.clips.find((x) => x.id === d.ids[0])!.start >= 2 - 1e-9);
  ok("…and is independent of the original (a deep copy)", (() => { const cp = d.clips.find((x) => x.id === d.ids[0])!; (cp.transform as { opacity: number }).opacity = 0.2; return a.transform.opacity === 1; })());
  ok("a duplicate stays inside the design", near(endOf(duplicateClips([newClip(solid(), { start: 8, duration: 2 })], new Set([newClip(solid()).id]), 10).clips[0]), 10));
}

// --- retime -----------------------------------------------------------------------------------------------------------
{
  const c = newClip(compound(4, [newClip(solid(), { duration: 4 })]), { id: "r", start: 1, duration: 4, speed: 1, transform: { ...defaultTransform(), x: k([0, 0], [4, 100]) }, transitionOut: { type: "fade", d: 1, dir: "left", e: "linear" } });
  const fast = retimeConstant(c, 2, 12);
  ok("doubling the speed halves the length", near(fast.duration, 2) && fast.speed === 2 && fast.start === 1);
  ok("…and stretches its animation with it", near(evalProp(fast.transform.x, 1), 50) && near(evalProp(fast.transform.x, 2), 100));
  ok("the same part of the source is shown: the end of the clip is the end of the source", near(evalProp(fast.speed, 0) * fast.duration, 4));
  ok("halving the speed doubles it", near(retimeConstant(c, 0.5, 12).duration, 8));
  ok("it doesn't grow past the end of the design", retimeConstant(c, 0.25, 6) === c);
  ok("speed is clamped", retimeConstant(c, 999, 12).speed === 16 && retimeConstant(c, 0, 99).speed === 0.05);
  ok("a transition longer than the new clip is shortened", retimeConstant(c, 8, 12).transitionOut!.d <= retimeConstant(c, 8, 12).duration + 1e-9);
  const ramp = speedRamp(c, 0.5, 4);
  ok("a speed ramp keys the speed from the first value to the second over the clip", typeof ramp.speed === "object" && near(evalProp(ramp.speed, 0), 0.5) && near(evalProp(ramp.speed, 4), 4) && ramp.duration === 4);
}

// --- transitions -----------------------------------------------------------------------------------------------------
{
  const c = newClip(solid(), { duration: 2 });
  ok("a transition longer than the clip is cut to it", setTransition(c, "in", { type: "fade", d: 9, dir: "left", e: "linear" }).transitionIn!.d === 2);
  ok("it can be removed", setTransition(setTransition(c, "out", { type: "fade", d: 1, dir: "left", e: "linear" }), "out", undefined).transitionOut === undefined);
}

// --- compound clips ---------------------------------------------------------------------------------------------------------
{
  const a = newClip({ type: "shape", shape: "star", w: 50, h: 50, fill: "#fff", stroke: "#fff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 }, { id: "a", start: 1, duration: 2, track: 1, transform: { ...defaultTransform(), x: k([0, 0], [2, 100]) } });
  const b = newClip(solid(), { id: "b", start: 2, duration: 3, track: 2 });
  const o = newClip(solid(), { id: "o", start: 0, duration: 1, track: 0 });
  const made = makeCompound([a, b, o], new Set(["a", "b"]))!;
  const comp = made.clips.find((c) => c.id === made.id)!;
  ok("grouping makes one compound clip spanning exactly the group", near(comp.start, 1) && near(comp.duration, 4) && comp.source.type === "compound" && made.clips.length === 2);
  ok("…its contents keep their timing relative to it and their lane order", comp.source.type === "compound" && comp.source.clips.find((c) => c.id === "a")!.start === 0 && comp.source.clips.find((c) => c.id === "b")!.start === 1 && comp.source.clips.find((c) => c.id === "a")!.track === 0 && comp.source.clips.find((c) => c.id === "b")!.track === 1);
  ok("…and it sits where the lowest of them was", comp.track === 1);
  ok("it plays exactly as the group did: a clip inside, at the compound's own time, is where it was on the timeline", (() => {
    if (comp.source.type !== "compound") return false;
    const inner = comp.source.clips.find((c) => c.id === "a")!;
    return times(1, 3, 30).every((t) => {
      const was = sampleClip(a, t, stage)!;
      const now = sampleClip(inner, t - comp.start, stage)!;
      return near(was.x, now.x) && near(was.opacity, now.opacity);
    });
  })());
  ok("…and the compound itself is on screen exactly while any of its contents could be", sampleClip(comp, 0.99, stage) === null && sampleClip(comp, 1.01, stage) !== null && sampleClip(comp, 4.99, stage) !== null && sampleClip(comp, 5.01, stage) === null);
  ok("grouping nothing is nothing", makeCompound([a], new Set(["zzz"])) === null);
  ok("a plain compound can be opened back out", canBreakApart(comp));
  const back = breakApart(made.clips, made.id)!;
  ok("…restoring the clips where they were", back.clips.length === 3 && near(back.clips.find((c) => c.id === "a")!.start, 1) && near(back.clips.find((c) => c.id === "b")!.start, 2));
  ok("one with its own effects can't be (it would change how it looks)", !canBreakApart({ ...comp, fx: [{ type: "blur", amount: 4 }] }) && !canBreakApart({ ...comp, speed: 2 }) && !canBreakApart({ ...comp, transform: { ...comp.transform, opacity: 0.5 } }));
  ok("a non-compound can't be", breakApart([a], "a") === null);

  const spec: MotionSpec = { ...emptyMotion("effect"), duration: 8, clips: made.clips };
  ok("scopeOf finds the clips inside a compound", scopeOf(spec, [made.id])!.clips.length === 2 && scopeOf(spec, [made.id])!.duration === 4 && scopeOf(spec, [])!.clips.length === 2 && scopeOf(spec, ["nope"]) === null);
  ok("mapScope edits only inside the compound", (() => { const m = mapScope(spec, [made.id], (cs) => cs.filter((c) => c.id !== "a")); return scopeOf(m, [made.id])!.clips.length === 1 && m.clips.length === 2 && spec.clips.find((c) => c.id === made.id) !== m.clips.find((c) => c.id === made.id); })());
  ok("…and the original is untouched", scopeOf(spec, [made.id])!.clips.length === 2);
  ok("mapScope at the top level maps the top", mapScope(spec, [], (cs) => cs.slice(0, 1)).clips.length === 1);
  ok("pathTo finds the compounds to open to reach a clip", pathTo(spec, "a")!.join() === made.id && pathTo(spec, made.id)!.length === 0 && pathTo(spec, "zzz") === null);
  const deep = makeCompound(spec.clips, new Set(spec.clips.map((c) => c.id)))!;
  const dspec = { ...spec, clips: deep.clips };
  ok("two levels deep", pathTo(dspec, "a")!.length === 2 && scopeOf(dspec, pathTo(dspec, "a")!)!.clips.length === 2);
  ok("mapScope works two levels down", scopeOf(mapScope(dspec, pathTo(dspec, "a")!, (cs) => cs.slice(0, 1)), pathTo(dspec, "a")!)!.clips.length === 1);
}

// --- design length -----------------------------------------------------------------------------------------------------------------
{
  const spec: MotionSpec = { ...emptyMotion("effect"), duration: 6, clips: [newClip(solid(), { id: "a", start: 0, duration: 6 }), newClip(solid(), { id: "b", start: 4, duration: 2 }), newClip(solid(), { id: "c", start: 5.5, duration: 0.5 })] };
  const s = setDuration(spec, 4.5);
  ok("shortening the design shortens clips that overhang and drops those that start after the end", s.duration === 4.5 && s.clips.length === 2 && near(endOf(s.clips[0]), 4.5) && near(endOf(s.clips[1]), 4.5));
  ok("length is bounded", setDuration(spec, 999).duration === 12 && setDuration(spec, -1).duration === 0.1);
  ok("fit to content", fitDuration({ ...spec, clips: [newClip(solid(), { start: 0, duration: 3 })] }).duration === 3 && fitDuration({ ...spec, clips: [] }).duration === 6);
}

// --- addressing a property -------------------------------------------------------------------------------------------
{
  const c = newClip({ type: "shape", shape: "rect", w: 100, h: 60, fill: "#ff0000", stroke: "#fff", strokeWidth: 0, radius: 0, points: 5, inner: 0.5 }, { id: "p", start: 1, duration: 4, fx: [{ type: "blur", amount: 4 }, { type: "glow", color: "#ffffff", blur: 10, strength: 1 }] });
  ok("getPath reads nested values and array entries", getPath(c, "transform.x") === 0 && getPath(c, "fx.1.blur") === 10 && getPath(c, "source.fill") === "#ff0000" && getPath(c, "nope.x") === undefined && getPath(c, "fx.9.blur") === undefined);
  const s1 = setPath(c, "fx.1.blur", 33);
  ok("setPath changes only that, and doesn't touch the original", getPath(s1, "fx.1.blur") === 33 && getPath(c, "fx.1.blur") === 10 && getPath(s1, "fx.0.amount") === 4 && s1.source === c.source && s1.transform === c.transform);
  ok("setPath on an array copies the array, not the others", s1.fx !== c.fx && s1.fx[0] === c.fx[0]);

  const a = setPropAt(c, "transform.x", 1, 50);
  ok("setting a constant property replaces it", getPath(a, "transform.x") === 50);
  const keyed = setPropAt(c, "transform.x", 1, 50, true);
  ok("with auto-key it makes a keyframe there, starting from the old value", valueAt(getPath(keyed, "transform.x") as never, 0) === 0 && near(valueAt(getPath(keyed, "transform.x") as never, 1), 50));
  const again = setPropAt(keyed, "transform.x", 2, 80);
  ok("once animated, editing at another time adds a key (and doesn't change what's at the first)", keyedAt(again, "transform.x", 2) && near(valueAt(getPath(again, "transform.x") as never, 1), 50) && keyedAt(again, "transform.x", 1));
  ok("editing on an existing key replaces that key's value", near(valueAt(getPath(setPropAt(again, "transform.x", 1, 9) as Clip, "transform.x") as never, 1), 9));
  ok("a path that isn't a property is left alone", setPropAt(c, "name", 1, 3) === c && setPropAt(c, "nope", 1, 3) === c);
  ok("colours key too", (() => { const r = setPropAt(c, "source.fill", 2, "#0000ff", true); return keyedAt(r, "source.fill", 2) && valueAt(getPath(r, "source.fill") as never, 0) === "#ff0000"; })());

  const t = toggleKeyAt(c, "transform.opacity", 2);
  ok("the diamond adds a key holding the current value (nothing moves)", keyedAt(t, "transform.opacity", 2) && near(valueAt(getPath(t, "transform.opacity") as never, 2), 1));
  ok("…and pressing it again removes it, back to a constant", getPath(toggleKeyAt(t, "transform.opacity", 2), "transform.opacity") === 1, getPath(toggleKeyAt(t, "transform.opacity", 2), "transform.opacity"));
  ok("the diamond on an animated property holds the animated value there", (() => { const r = toggleKeyAt(setPropAt(setPropAt(c, "transform.x", 0, 0, true), "transform.x", 4, 100), "transform.x", 2); return near(valueAt(getPath(r, "transform.x") as never, 2), 50) && keyedAt(r, "transform.x", 2); })());
  ok("clearing keys freezes the property at its value there", getPath(clearKeys(again, "transform.x", 1), "transform.x") === 50, getPath(clearKeys(again, "transform.x", 1), "transform.x"));
  ok("keyedAt is false for a constant", !keyedAt(c, "transform.x", 1));

  const withKeys = setPropAt(setPropAt(c, "transform.rotation", 0, 0, true), "transform.rotation", 2, 90);
  const lanes = animatedProps(withKeys);
  ok("animatedProps lists exactly what has keys, labelled", lanes.length === 1 && lanes[0].path === "transform.rotation" && lanes[0].label === "Rotation" && lanes[0].times.join() === "0,2");
  ok("…including effect parameters", animatedProps(setPropAt(setPropAt(c, "fx.1.blur", 0, 1, true), "fx.1.blur", 1, 30)).some((l) => l.path === "fx.1.blur" && l.label === "Glow size"));
  ok("…and a fill colour", animatedProps(setPropAt(c, "source.fill", 1, "#00ff00", true)).some((l) => l.path === "source.fill"));
  ok("a plain clip has none", animatedProps(c).length === 0);

  const r = valueRange(withKeys.transform.rotation);
  ok("a graph's range has a margin round the keys", r.min < 0 && r.max > 90);
  ok("a flat curve still has a range to draw in", (() => { const f = valueRange(5); return f.max > f.min; })() && (() => { const f = valueRange({ k: [{ t: 0, v: 3, e: "linear" }, { t: 1, v: 3, e: "linear" }] }); return f.max > f.min; })());

  // clipQuad: where handles go
  const q = clipQuad({ x: 0, y: 0, sx: 1, sy: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 }, { w: 100, h: 60, ox: 0, oy: 0 }, { w: 600, h: 700 });
  ok("a clip's corners are its box about the stage's centre", near(q.tl.x, 250) && near(q.tl.y, 320) && near(q.br.x, 350) && near(q.br.y, 380) && near(q.centre.x, 300) && near(q.centre.y, 350));
  const q2 = clipQuad({ x: 10, y: -20, sx: 2, sy: 1, rotation: 90, anchorX: 0.5, anchorY: 0.5 }, { w: 100, h: 60, ox: 0, oy: 0 }, { w: 600, h: 700 });
  ok("scale and rotation move the corners: 2× wide then turned 90° is 60 wide and 200 tall", near(Math.abs(q2.tr.x - q2.tl.x) + Math.abs(q2.tr.y - q2.tl.y), 200) && near(q2.centre.x, 310) && near(q2.centre.y, 330));
  ok("an anchor off-centre turns about that corner: the pivot doesn't move when rotated", (() => { const a0 = clipQuad({ x: 0, y: 0, sx: 1, sy: 1, rotation: 0, anchorX: 0, anchorY: 0 }, { w: 100, h: 60, ox: 0, oy: 0 }, { w: 600, h: 700 }); const a1 = clipQuad({ x: 0, y: 0, sx: 1, sy: 1, rotation: 45, anchorX: 0, anchorY: 0 }, { w: 100, h: 60, ox: 0, oy: 0 }, { w: 600, h: 700 }); return near(a0.tl.x, a1.tl.x) && near(a0.tl.y, a1.tl.y) && near(a0.pivot.x, 300); })());
  ok("a picture's rest offset shifts the whole thing", near(clipQuad({ x: 0, y: 0, sx: 1, sy: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 }, { w: 100, h: 60, ox: 40, oy: -10 }, { w: 600, h: 700 }).centre.x, 340));
  ok("the rotation handle stands off the top edge, away from the centre", (() => { const h = clipQuad({ x: 0, y: 0, sx: 1, sy: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5 }, { w: 100, h: 60, ox: 0, oy: 0 }, { w: 600, h: 700 }).rotationHandle; return near(h.x, 300) && h.y < 320; })());
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
