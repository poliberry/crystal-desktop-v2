import { newClip, emptyMotion, normalizeMotionSpec, MOTION_STAGES, TEXT_ANIMS, TRANSITION_KINDS, particlesAt, sampleClip } from "../../convex/lib/motion";
import { CLIP_COLOUR, EFFECTS, GENERATORS, GENERATOR_GROUPS, TITLES, TRANSITIONS, clipFromGenerator, clipFromTitle, newTransition } from "../../src/studio/motion/library";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const cdn = (u: string) => u;

for (const stage of [MOTION_STAGES.effect, MOTION_STAGES.nameplate]) {
  const label = stage.w === 600 ? "effect" : "nameplate";
  for (const g of GENERATORS) {
    const clip = clipFromGenerator(g, stage, 0, 3, 0);
    const spec = { ...emptyMotion(label === "effect" ? "effect" : "nameplate"), duration: 4, clips: [clip] };
    let out;
    try { out = normalizeMotionSpec(JSON.parse(JSON.stringify(spec)), cdn); } catch (e) { ok(`${g.id} on a ${label}: accepted by the server`, false, (e as Error).message); continue; }
    ok(`${g.id} on a ${label}: accepted, and normalising changes nothing about what it is`, out.clips.length === 1 && out.clips[0].source.type === clip.source.type);
    ok(`${g.id} on a ${label}: nothing was clamped away from the defaults I chose`, JSON.stringify(out.clips[0].source) === JSON.stringify(clip.source), { want: clip.source, got: out.clips[0].source });
    ok(`${g.id} on a ${label}: it draws something at some moment (is on screen)`, [0.2, 1, 2.5].some((t) => sampleClip(out!.clips[0], t, stage) !== null));
  }
}
ok("there are plenty of generators, in several groups", GENERATORS.length >= 20 && GENERATOR_GROUPS.length >= 4);
ok("ids are unique", new Set(GENERATORS.map((g) => g.id)).size === GENERATORS.length && new Set(TITLES.map((t) => t.id)).size === TITLES.length && new Set(EFFECTS.map((e) => e.id)).size === EFFECTS.length);
ok("every particle preset really emits particles", GENERATORS.filter((g) => g.group === "Particles").every((g) => { const c = clipFromGenerator(g, MOTION_STAGES.effect, 0, 3); return c.source.type === "particles" && particlesAt(c.source, 1.3).length > 5; }));
ok("a generator preset is a new clip each time (no shared state)", (() => { const g = GENERATORS[0]; const a = clipFromGenerator(g, MOTION_STAGES.effect, 0, 2), b = clipFromGenerator(g, MOTION_STAGES.effect, 0, 2); return a.id !== b.id && a.source !== b.source && a.transform !== b.transform; })());
ok("start, duration and lane are applied", (() => { const c = clipFromGenerator(GENERATORS[0], MOTION_STAGES.effect, 1.5, 2.5, 3); return c.start === 1.5 && c.duration === 2.5 && c.track === 3; })());
ok("a zero duration is raised to something visible", clipFromGenerator(GENERATORS[0], MOTION_STAGES.effect, 0, 0).duration >= 0.1);

for (const t of TITLES) {
  const c = clipFromTitle(t, 0, 3);
  let ok1 = true; try { normalizeMotionSpec({ ...emptyMotion("effect"), duration: 4, clips: [c] }, cdn); } catch { ok1 = false; }
  ok(`title ${t.id}: accepted by the server`, ok1);
  ok(`title ${t.id}: its animation is one the player knows`, TEXT_ANIMS.includes(c.source.type === "text" ? c.source.anim : "none"));
}
ok("every text animation has a title preset", TEXT_ANIMS.filter((a) => a !== "none" || true).every((a) => TITLES.some((t) => t.anim === a)));

for (const e of EFFECTS) {
  const c = newClip({ type: "solid", w: 100, h: 100, color: "#fff" }, { duration: 2, fx: [e.make()] });
  let out; try { out = normalizeMotionSpec({ ...emptyMotion("effect"), duration: 4, clips: [c] }, cdn); } catch { out = null; }
  ok(`effect ${e.id}: accepted, kept as the kind it says`, !!out && out.clips[0].fx.length === 1 && out.clips[0].fx[0].type === e.type);
  ok(`effect ${e.id}: unchanged by normalising`, !!out && JSON.stringify(out.clips[0].fx[0]) === JSON.stringify(c.fx[0]), { want: c.fx[0], got: out?.clips[0].fx[0] });
}
ok("every kind of effect the player supports has a preset", ["blur", "glow", "shadow", "adjust", "tint"].every((t) => EFFECTS.some((e) => e.type === t)));
ok("every transition kind has an entry", TRANSITION_KINDS.every((k) => TRANSITIONS.some((t) => t.id === k)) && TRANSITIONS.length === TRANSITION_KINDS.length);
ok("a new transition is valid to the server", TRANSITIONS.every((t) => { try { const c = newClip({ type: "solid", w: 1, h: 1, color: "#fff" }, { duration: 2, transitionIn: newTransition(t.id), transitionOut: newTransition(t.id, 0.4, "up", "inOut") }); const o = normalizeMotionSpec({ ...emptyMotion("effect"), duration: 4, clips: [c] }, cdn).clips[0]; return o.transitionIn?.type === t.id && o.transitionOut?.dir === "up"; } catch { return false; } }));
ok("every source has a timeline colour", ["image", "layer", "shape", "text", "solid", "gradient", "noise", "shimmer", "rays", "particles", "compound", "adjust"].every((t) => /^#[0-9a-f]{6}$/.test((CLIP_COLOUR as Record<string, string>)[t])));

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
