import {
  BLEND_MODES, EASE_PRESETS, MOTION_LIMITS, MOTION_STAGES, TRANSITION_KINDS, allClips, applyTransition, contentEnd, cubicBezier, defaultParticles, defaultTransform, ease,
  emptyMotion, evalColor, parseRgba, evalProp, motionImageUrls, newClip, normalizeMotionSpec, particlesAt, playbackTime, sampleClip, sampleClips, sourceElapsed, sourceTime, textChars, transitionState,
  type Clip, type Source,
} from "../../convex/lib/motion";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) <= e;
const throws = (n: string, fn: () => unknown, re: RegExp) => { try { fn(); ok(n, false, "no throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };
const cdn = (u: string) => { if (!u.startsWith("https://cdn.example/")) throw new Error("not on our CDN"); return u; };
const stage = MOTION_STAGES.effect;
const solid = (): Source => ({ type: "solid", w: 100, h: 100, color: "#ff0000" });

// --- easing ----------------------------------------------------------------------------------------
for (const e of EASE_PRESETS) {
  ok(`ease ${e}: starts at 0 and ends at 1`, near(ease(e, 0), 0) && near(ease(e, 1), 1), [ease(e, 0), ease(e, 1)]);
  ok(`ease ${e}: outside [0,1] is clamped`, near(ease(e, -5), ease(e, 0)) && near(ease(e, 7), ease(e, 1)));
  ok(`ease ${e}: finite everywhere`, Array.from({ length: 101 }, (_, i) => ease(e, i / 100)).every(Number.isFinite));
}
{
  const mono = (e: "linear" | "in" | "out" | "inOut" | "sine" | "expo") => Array.from({ length: 100 }, (_, i) => ease(e, (i + 1) / 100) >= ease(e, i / 100) - 1e-9).every(Boolean);
  ok("the plain curves never go backwards", (["linear", "in", "out", "inOut", "sine", "expo"] as const).every(mono));
  ok("ease-in is slow at first, ease-out fast", ease("in", 0.25) < 0.25 && ease("out", 0.25) > 0.25);
  ok("hold stays until the very end of the segment", ease("hold", 0.99) === 0 && ease("hold", 1) === 1);
  ok("back overshoots then settles", Math.max(...Array.from({ length: 100 }, (_, i) => ease("back", i / 99))) > 1.05);
  ok("bounce and elastic reach the end value", near(ease("bounce", 1), 1) && near(ease("elastic", 1), 1));
  ok("CSS `ease` curve matches the spec's value at 0.5", near(cubicBezier(0.25, 0.1, 0.25, 1, 0.5), 0.8024, 2e-3), cubicBezier(0.25, 0.1, 0.25, 1, 0.5));
  ok("a bezier of (0,0,1,1) is linear", near(cubicBezier(0, 0, 1, 1, 0.37), 0.37, 1e-4));
  ok("a custom bezier goes through ease()", near(ease([0.25, 0.1, 0.25, 1], 0.5), 0.8024, 2e-3));
  ok("a bezier with extreme control values stays finite", Array.from({ length: 50 }, (_, i) => cubicBezier(0, 3, 1, -2, i / 49)).every(Number.isFinite));
}

// --- keyframes -------------------------------------------------------------------------------------------
{
  const k = { k: [{ t: 0, v: 0, e: "linear" as const }, { t: 2, v: 100, e: "linear" as const }, { t: 4, v: 0, e: "linear" as const }] };
  ok("a constant is itself", evalProp(7, 3) === 7);
  ok("keyframes are linear between keys", near(evalProp(k, 1), 50) && near(evalProp(k, 3), 50) && near(evalProp(k, 2), 100));
  ok("before the first key it holds the first value, after the last the last", evalProp(k, -5) === 0 && evalProp(k, 99) === 0);
  ok("an empty key list is 0, not a crash", evalProp({ k: [] }, 1) === 0);
  ok("a segment eases out of its starting key", (() => { const q = { k: [{ t: 0, v: 0, e: "in" as const }, { t: 1, v: 1, e: "linear" as const }] }; return evalProp(q, 0.5) < 0.2; })());
  ok("hold keys step", (() => { const q = { k: [{ t: 0, v: 0, e: "hold" as const }, { t: 1, v: 10, e: "linear" as const }] }; return evalProp(q, 0.99) === 0 && evalProp(q, 1) === 10; })());
  const c = { k: [{ t: 0, v: "#ff0000", e: "linear" as const }, { t: 1, v: "#0000ff", e: "linear" as const }] };
  ok("colours blend channel by channel", evalColor(c, 0.5) === "rgba(128,0,128,1)", evalColor(c, 0.5));
  ok("a colour constant renders as rgba", evalColor("#00ff0080", 0) === "rgba(0,255,0,0.502)", evalColor("#00ff0080", 0));
  ok("an rgba string made by evalColor reads back to the same channels", JSON.stringify(parseRgba(evalColor("#9be7ff80", 0))) === JSON.stringify([155, 231, 255, 0.502]) && JSON.stringify(parseRgba("#102030")) === JSON.stringify([16, 32, 48, 1]), parseRgba(evalColor("#9be7ff80", 0)));
  ok("a malformed colour constant doesn't throw", typeof evalColor("nonsense", 0) === "string");
}

// --- retime -----------------------------------------------------------------------------------------------
{
  ok("constant speed is speed × time", near(sourceElapsed(2, 3), 6) && near(sourceElapsed(0.5, 4), 2));
  ok("speed is clamped to a sane range", near(sourceElapsed(1000, 1), 16) && near(sourceElapsed(0, 1), 0.05));
  ok("a ramp from 1× to 3× over 2 s covers (1+3)/2 × 2 = 4", near(sourceElapsed({ k: [{ t: 0, v: 1, e: "linear" }, { t: 2, v: 3, e: "linear" }] }, 2), 4), sourceElapsed({ k: [{ t: 0, v: 1, e: "linear" }, { t: 2, v: 3, e: "linear" }] }, 2));
  ok("…and holds the last speed after it: 4 + 3 × 1 = 7", near(sourceElapsed({ k: [{ t: 0, v: 1, e: "linear" }, { t: 2, v: 3, e: "linear" }] }, 3), 7));
  ok("zero or negative time travels nowhere", sourceElapsed(2, 0) === 0 && sourceElapsed(2, -1) === 0);
  const inner = newClip(solid(), { start: 0, duration: 4 });
  const comp = newClip({ type: "compound", duration: 2, clips: [inner] }, { start: 1, duration: 5, in: 0, loop: true });
  ok("a compound clip plays from its in-point", near(sourceTime(comp, 1.5), 0.5));
  ok("…loops when the clip is longer than its contents", near(sourceTime(comp, 4), 1) && near(sourceTime(comp, 3.5), 0.5), [sourceTime(comp, 4), sourceTime(comp, 3.5)]);
  ok("…or holds its last moment with loop off", near(sourceTime({ ...comp, loop: false }, 5), 2));
  ok("…and starts partway in with an in-point", near(sourceTime({ ...comp, in: 0.5 }, 1), 0.5));
  ok("reverse runs it backwards", near(sourceTime({ ...comp, reverse: true, duration: 2, loop: false }, 1), 2) && near(sourceTime({ ...comp, reverse: true, duration: 2, loop: false }, 2), 1) && near(sourceTime({ ...comp, reverse: true, duration: 2, loop: false }, 3), 0));
  ok("speed 2× gets through it twice as fast", near(sourceTime({ ...comp, speed: 2, loop: false }, 2), 2));
  ok("time outside the clip is clamped to its ends", near(sourceTime(comp, -9), 0) && Number.isFinite(sourceTime(comp, 999)));
  ok("a picture (no length of its own) just counts up", near(sourceTime(newClip(solid(), { start: 0, duration: 9 }), 5), 5));
}

// --- transitions ------------------------------------------------------------------------------------------
for (const tr of TRANSITION_KINDS) {
  const t = { type: tr, d: 1, dir: "left" as const, e: "linear" as const };
  const start = applyTransition(t, 0, stage), end = applyTransition(t, 1, stage);
  ok(`${tr}: fully shown at the end`, near(end.opacity, 1) && near(end.dx, 0) && near(end.dy, 0) && near(end.scale, 1) && near(end.rotation, 0) && near(end.blur, 0) && near(end.flash, 0) && (!end.wipe || end.wipe.p === 1), end);
  ok(`${tr}: not simply the final state at the start`, JSON.stringify(start) !== JSON.stringify(end));
  ok(`${tr}: finite throughout`, Array.from({ length: 21 }, (_, i) => applyTransition(t, i / 20, stage)).every((s) => Object.values(s).every((v) => typeof v === "object" || Number.isFinite(v))));
}
{
  const s = applyTransition({ type: "slide", d: 1, dir: "left", e: "linear" }, 0, stage);
  ok("a slide from the left starts a stage-width to the left", near(s.dx, -stage.w) && near(s.dy, 0));
  ok("…and from below starts a stage-height down", near(applyTransition({ type: "slide", d: 1, dir: "down", e: "linear" }, 0, stage).dy, stage.h));
  const clip = newClip(solid(), { start: 2, duration: 3, transitionIn: { type: "fade", d: 1, dir: "left", e: "linear" }, transitionOut: { type: "fade", d: 1, dir: "left", e: "linear" } });
  ok("a clip fades in over its first second", near(transitionState(clip, 2.5, stage).opacity, 0.5) && near(transitionState(clip, 3.5, stage).opacity, 1));
  ok("…and out over its last", near(transitionState(clip, 4.5, stage).opacity, 0.5) && near(transitionState(clip, 4.99, stage).opacity, 0.01, 1e-3));
  ok("a clip shorter than its two transitions combines them, no negatives", (() => { const c = { ...clip, duration: 1 }; return Array.from({ length: 11 }, (_, i) => transitionState(c, 2 + i / 11, stage).opacity).every((o) => o >= 0 && o <= 1); })());
}

// --- sampling -------------------------------------------------------------------------------------------------
{
  const a = newClip(solid(), { id: "a", track: 0, start: 1, duration: 2 });
  const b = newClip(solid(), { id: "b", track: 1, start: 0, duration: 5 });
  const c = newClip(solid(), { id: "c", track: 0, start: 0, duration: 1 });
  ok("a clip is on for [start, start+duration)", sampleClip(a, 0.99, stage) === null && sampleClip(a, 1, stage) !== null && sampleClip(a, 2.99, stage) !== null && sampleClip(a, 3, stage) === null);
  ok("a switched-off clip is never on", sampleClip({ ...a, on: false }, 2, stage) === null);
  ok("higher tracks are drawn over lower ones, then earlier starts first", sampleClips([b, a, c], 1.5, stage).map((r) => r.clip.id).join() === "a,b" && sampleClips([b, a, c], 0.5, stage).map((r) => r.clip.id).join() === "c,b");
  const moving = newClip(solid(), { start: 1, duration: 2, transform: { ...defaultTransform(), x: { k: [{ t: 0, v: 0, e: "linear" }, { t: 2, v: 200, e: "linear" }] }, opacity: { k: [{ t: 0, v: 0, e: "linear" }, { t: 1, v: 1, e: "linear" }] } } });
  const r = sampleClip(moving, 2, stage)!;
  ok("keyframes run on clip time, not timeline time", near(r.x, 100) && near(r.opacity, 1) && near(r.local, 1));
  ok("the same time gives the same frame, every time", JSON.stringify(sampleClip(moving, 2.37, stage)) === JSON.stringify(sampleClip(moving, 2.37, stage)));
  ok("opacity is kept in [0,1] even if a transition pushes it", sampleClip({ ...moving, transform: { ...defaultTransform(), opacity: 5 } }, 1.5, stage)!.opacity <= 1);
  ok("effects are resolved to plain numbers", (() => { const g = sampleClip(newClip(solid(), { start: 0, duration: 2, fx: [{ type: "glow", color: { k: [{ t: 0, v: "#ff0000", e: "linear" }, { t: 2, v: "#0000ff", e: "linear" }] }, blur: 10, strength: { k: [{ t: 0, v: 1, e: "linear" }, { t: 2, v: 3, e: "linear" }] } }] }), 1, stage)!; const fx = g.fx[0]; return fx.type === "glow" && near(fx.strength, 2) && fx.color === "rgba(128,0,128,1)"; })());
  ok("a mask's keyframes are resolved too", (() => { const m = sampleClip(newClip(solid(), { start: 0, duration: 2, mask: { shape: "rect", x: 0, y: 0, w: { k: [{ t: 0, v: 0, e: "linear" }, { t: 2, v: 100, e: "linear" }] }, h: 50, feather: 4, invert: false } }), 1, stage)!.mask!; return near(m.w, 50) && m.h === 50; })());
}

// --- playback clock -----------------------------------------------------------------------------------------------
{
  const loop = { duration: 4, loop: { mode: "loop" as const, rest: 0 } };
  ok("a looping design wraps", near(playbackTime(loop, 1), 1) && near(playbackTime(loop, 5), 1) && near(playbackTime(loop, 4), 0));
  const once = { duration: 4, loop: { mode: "once" as const, rest: 2 } };
  ok("a play-once design holds its last frame during the rest", playbackTime(once, 5) < 4 && playbackTime(once, 5) > 3.99 && near(playbackTime(once, 6.5), 0.5));
  ok("a time before the start (a clock that ran backwards) is the start", playbackTime(loop, -3) === 0 && playbackTime(once, -3) === 0);
  ok("an empty design doesn't divide by zero", Number.isFinite(playbackTime({ duration: 0, loop: { mode: "loop", rest: 0 } }, 3)));
}

// --- particles ---------------------------------------------------------------------------------------------------------
{
  const pr = { ...defaultParticles(), count: 50, life: 2 };
  const a = particlesAt(pr, 3.3);
  ok("a continuous emitter has about `count` particles alive", a.length === 50, a.length);
  ok("the same time is the same particles", JSON.stringify(a) === JSON.stringify(particlesAt(pr, 3.3)));
  ok("scrubbing is closed-form: the state at t doesn't depend on how we got there", (() => { particlesAt(pr, 9); particlesAt(pr, 0.1); return JSON.stringify(particlesAt(pr, 3.3)) === JSON.stringify(a); })());
  ok("they move over time", JSON.stringify(particlesAt(pr, 3.3)) !== JSON.stringify(particlesAt(pr, 3.6)));
  ok("they are periodic over a life, so a loop is seamless", (() => { const u = particlesAt({ ...pr, spread: 0, angle: -90 }, 1.0), v = particlesAt({ ...pr, spread: 0, angle: -90 }, 3.0); return u.length === v.length; })());
  ok("a different seed scatters differently", JSON.stringify(particlesAt({ ...pr, seed: 2 }, 3.3)) !== JSON.stringify(a));
  ok("alpha is within [0,1] and sizes are never negative", a.every((q) => q.alpha >= 0 && q.alpha <= 1 && q.size >= 0));
  ok("all numbers are finite", a.every((q) => [q.x, q.y, q.size, q.alpha, q.rotation].every(Number.isFinite)));
  const fall = particlesAt({ ...pr, speed: 0, gravity: 100, spread: 0, w: 0, h: 0, count: 1, mode: "burst", life: 4 }, 2);
  ok("gravity pulls down: y = ½·g·t²", fall.length === 1 && Math.abs(fall[0].y - 200) < 15, fall[0]);
  ok("a burst starts everyone nearly together; none before time 0", particlesAt({ ...pr, mode: "burst" }, -1).length === 0 && particlesAt({ ...pr, mode: "burst" }, 0.5).length === 50);
  ok("zero particles is none", particlesAt({ ...pr, count: 0 }, 1).length === 0);
  ok("count is capped, so a hostile spec can't ask for a million", particlesAt({ ...pr, count: 1e9 }, 1).length <= MOTION_LIMITS.particles);
  ok("no colours falls back to white, not a crash", particlesAt({ ...pr, colors: [] }, 1)[0].color === "#ffffff");
  ok("size shrinks over life with sizeEnd 0", (() => { const q = { ...pr, jitter: 0, sizeJitter: 0, sizeEnd: 0, count: 1, w: 0, h: 0, mode: "continuous" as const }; return particlesAt(q, 0.2)[0].size > particlesAt(q, 1.9)[0].size; })());
}

// --- titles ------------------------------------------------------------------------------------------------------------------
{
  const t = (anim: string, over = {}) => ({ type: "text" as const, text: "Hello", size: 40, weight: 700, italic: false, color: "#fff", stroke: "#000", strokeWidth: 0, anim: anim as never, stagger: 0.1, align: "center" as const, ...over });
  ok("a title without animation is fully shown from the start", textChars(t("none"), 0).every((c) => c.alpha === 1 && c.dy === 0 && c.scale === 1));
  ok("typewriter reveals one character at a time", textChars(t("typewriter"), 0.25).map((c) => c.alpha).join("") === "11100", textChars(t("typewriter"), 0.25).map((c) => c.alpha).join(""));
  ok("fade is staggered along the word", (() => { const c = textChars(t("fade"), 0.2); return c[0].alpha > c[4].alpha; })());
  ok("every animation settles to fully shown, once it has played", (["fade", "slideUp", "pop", "typewriter"] as const).every((a) => textChars(t(a), 5).every((c) => near(c.alpha, 1) && near(c.dy, 0) && near(c.scale, 1))));
  ok("emoji and wide characters are kept whole", textChars(t("none", { text: "a😀b" }), 0).length === 3);
  ok("wave moves things vertically over time", textChars(t("wave"), 1).some((c) => c.dy !== 0));
}

// --- validation: the server's rules -----------------------------------------------------------------------------------------------
{
  const img = (url = "https://cdn.example/a.png") => newClip({ type: "image", url, w: 100, h: 100, ox: 0, oy: 0 });
  const spec = { ...emptyMotion("effect", "Sparkle"), duration: 4, clips: [img(), newClip(solid(), { id: "x1" })] };
  const n = normalizeMotionSpec(JSON.parse(JSON.stringify(spec)), cdn);
  ok("a good design survives a round trip", n.clips.length === 2 && n.name === "Sparkle" && n.kind === "effect" && n.duration === 4);
  ok("normalising twice changes nothing", JSON.stringify(normalizeMotionSpec(n, cdn)) === JSON.stringify(n));
  ok("the stage is fixed by the kind, whatever was claimed", normalizeMotionSpec({ ...spec, stage: { w: 99999, h: 1 } }, cdn).stage.w === MOTION_STAGES.effect.w && normalizeMotionSpec({ ...spec, kind: "nameplate" }, cdn).stage.w === MOTION_STAGES.nameplate.w);
  ok("an unknown kind becomes an effect", normalizeMotionSpec({ ...spec, kind: "virus" }, cdn).kind === "effect");
  throws("a picture off our CDN stops the whole design", () => normalizeMotionSpec({ ...spec, clips: [img("https://evil.example/x.png")] }, cdn), /not on our CDN/);
  throws("a picture that isn't a picture is refused", () => normalizeMotionSpec({ ...spec, clips: [img("https://cdn.example/x.html")] }, cdn), /PNG, WebP, JPEG or GIF/);
  throws("a video can't be a picture here", () => normalizeMotionSpec({ ...spec, clips: [img("https://cdn.example/x.mp4")] }, cdn), /PNG, WebP, JPEG or GIF/);
  throws("a clip with an unknown source is refused", () => normalizeMotionSpec({ ...spec, clips: [{ ...img(), source: { type: "script", code: "alert(1)" } }] }, cdn), /isn't something a motion clip can be/);
  throws("a clip with no source is refused", () => normalizeMotionSpec({ ...spec, clips: [{ id: "x", source: null }] }, cdn), /no source/);
  throws("not an object", () => normalizeMotionSpec("hi", cdn), /broken/);
  throws("null", () => normalizeMotionSpec(null, cdn), /broken/);
  ok("an array of nonsense clips is ignored, not fatal", normalizeMotionSpec({ ...spec, clips: [1, "a", null, [], {}].filter(() => true).slice(0, 4).filter((x) => typeof x === "object" && x !== null && !Array.isArray(x) && Object.keys(x).length > 0) }, cdn).clips.length === 0);
  throws("too many clips", () => normalizeMotionSpec({ ...spec, clips: Array.from({ length: MOTION_LIMITS.clips + 1 }, () => newClip(solid())) }, cdn), /at most 96 clips/);
  throws("too many distinct pictures", () => normalizeMotionSpec({ ...spec, clips: Array.from({ length: 30 }, (_, i) => img(`https://cdn.example/${i}.png`)) }, cdn), /at most 24 pictures/);
  ok("the same picture used many times is one picture", normalizeMotionSpec({ ...spec, clips: Array.from({ length: 40 }, () => img()) }, cdn).clips.length === 40);
  const deep = (d: number): Clip => newClip({ type: "compound", duration: 2, clips: d > 0 ? [deep(d - 1)] : [newClip(solid())] }, { duration: 2 });
  ok("compound clips nest up to the limit", (() => { try { normalizeMotionSpec({ ...spec, clips: [deep(MOTION_LIMITS.depth - 1)] }, cdn); return true; } catch (e) { return String(e); } })() === true);
  throws("…and no deeper (a bomb of nested clips)", () => normalizeMotionSpec({ ...spec, clips: [deep(MOTION_LIMITS.depth + 2)] }, cdn), /nested at most 3 deep/);
  ok("a runaway duration is clamped", normalizeMotionSpec({ ...spec, duration: 1e9 }, cdn).duration === MOTION_LIMITS.duration && normalizeMotionSpec({ ...spec, duration: -3 }, cdn).duration === 0.1);
  ok("NaN, Infinity and strings fall back to defaults", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), start: NaN, duration: Infinity, speed: "fast", transform: { x: "left", opacity: NaN } }] }, cdn).clips[0]; return Number.isFinite(c.start) && Number.isFinite(c.duration) && c.speed === 1 && c.transform.x === 0 && c.transform.opacity === 1; })());
  ok("a clip can't run past the end of the design", (() => { const c = normalizeMotionSpec({ ...spec, duration: 4, clips: [{ ...newClip(solid()), start: 3, duration: 10 }] }, cdn).clips[0]; return near(c.start + c.duration, 4); })());
  ok("a clip can't start after the design ends", (() => { const c = normalizeMotionSpec({ ...spec, duration: 4, clips: [{ ...newClip(solid()), start: 100 }] }, cdn).clips[0]; return c.start < 4 && c.start + c.duration <= 4 + 1e-9; })());
  ok("keyframes are sorted, deduplicated and clamped", (() => {
    const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), duration: 2, transform: { opacity: { k: [{ t: 2, v: 9, e: "linear" }, { t: 0, v: -4, e: "nope" }, { t: 0, v: 0.2, e: "out" }] } } }] }, cdn).clips[0];
    const o = c.transform.opacity as { k: { t: number; v: number; e: unknown }[] };
    return o.k.length === 2 && o.k[0].t === 0 && o.k[0].v === 0.2 && o.k[0].e === "out" && o.k[1].v === 1;
  })());
  ok("a single keyframe becomes a constant", normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), transform: { x: { k: [{ t: 1, v: 40, e: "linear" }] } } }] }, cdn).clips[0].transform.x === 40);
  ok("keyframes beyond the limit are dropped", (() => { const o = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), transform: { x: { k: Array.from({ length: 500 }, (_, i) => ({ t: i / 200, v: i, e: "linear" })) } } }] }, cdn).clips[0].transform.x as { k: unknown[] }; return o.k.length <= MOTION_LIMITS.keys; })());
  ok("colours must be hex; anything else (CSS injection) is replaced", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), source: { type: "solid", w: 10, h: 10, color: "red; background:url(//evil)" } }] }, cdn).clips[0]; return (c.source as { color: string }).color === "#ffffff"; })());
  ok("short hex colours are expanded", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), source: { type: "solid", w: 10, h: 10, color: "#F0a" } }] }, cdn).clips[0]; return (c.source as { color: string }).color === "#ff00aa"; })());
  ok("blend modes and transitions are matched against the lists", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), blend: "destroy", transitionIn: { type: "explode", d: 1, dir: "sideways", e: "nope" } }] }, cdn).clips[0]; return c.blend === "normal" && c.transitionIn?.type === "fade" && c.transitionIn.dir === "left" && c.transitionIn.e === "linear"; })());
  ok("every real blend mode survives", BLEND_MODES.every((b) => normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), blend: b }] }, cdn).clips[0].blend === b));
  ok("a zero-length transition is dropped", normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), transitionIn: { type: "fade", d: 0 } }] }, cdn).clips[0].transitionIn === undefined);
  ok("effects are capped and unknown ones dropped", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), fx: [...Array.from({ length: 20 }, () => ({ type: "blur", amount: 4 })), { type: "evil" }] }] }, cdn).clips[0]; return c.fx.length === MOTION_LIMITS.fx; })());
  ok("titles lose control characters and are cut to the limit", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), source: { type: "text", text: "hi\u0000\nthere" + "x".repeat(200), size: 20 } }] }, cdn).clips[0]; const s = c.source as { text: string }; return !/[\u0000-\u001f]/.test(s.text) && [...s.text].length <= MOTION_LIMITS.text; })());
  ok("clip names are cleaned and cut", normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), name: "a\u0007" + "b".repeat(500) }] }, cdn).clips[0].name.length <= 60);
  ok("clip ids are made safe and unique", (() => { const cs = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), id: "<script>" }, { ...newClip(solid()), id: "dup" }, { ...newClip(solid()), id: "dup" }] }, cdn).clips; return new Set(cs.map((c) => c.id)).size === 3 && cs.every((c) => /^[a-zA-Z0-9_-]{1,40}$/.test(c.id)); })());
  ok("tracks are bounded", normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), track: 9999 }] }, cdn).clips[0].track === 31);
  ok("particles are bounded", (() => { const c = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), source: { ...defaultParticles(), type: "particles", count: 1e9, life: 1e9, speed: 1e12 } }] }, cdn).clips[0].source as { count: number; life: number; speed: number }; return c.count === MOTION_LIMITS.particles && c.life <= 12 && c.speed <= 2000; })());
  ok("a gradient with fewer than two stops gets a default pair", (() => { const g = normalizeMotionSpec({ ...spec, clips: [{ ...newClip(solid()), source: { type: "gradient", w: 10, h: 10, kind: "linear", angle: 0, stops: [{ o: 0, c: "#000" }] } }] }, cdn).clips[0].source as { stops: unknown[] }; return g.stops.length === 2; })());
  ok("an empty design is valid (the editor starts there)", normalizeMotionSpec(emptyMotion("nameplate"), cdn).clips.length === 0);
  ok("prototype pollution through the spec does nothing", (() => { const evil = JSON.parse('{"kind":"effect","duration":2,"clips":[],"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}'); normalizeMotionSpec(evil, cdn); return ({} as { polluted?: number }).polluted === undefined; })());

  const outS = normalizeMotionSpec({ ...spec, clips: [img("https://cdn.example/a.png"), newClip({ type: "compound", duration: 2, clips: [img("https://cdn.example/b.png"), img("https://cdn.example/a.png")] })] }, cdn);
  ok("the pictures a design uses, each once, nested ones included", motionImageUrls(outS).sort().join() === "https://cdn.example/a.png,https://cdn.example/b.png", motionImageUrls(outS));
  ok("every clip, nested included", allClips(outS.clips).length === 4);
  ok("content end is where the last clip stops", near(contentEnd([newClip(solid(), { start: 1, duration: 2 }), newClip(solid(), { start: 0, duration: 1 })]), 3));
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
