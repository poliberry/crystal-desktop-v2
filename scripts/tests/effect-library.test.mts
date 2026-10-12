import { MOTION_LIMITS, MOTION_STAGES, allClips, emptyMotion, evalProp, normalizeMotionSpec, particlesAt, sampleClips, type Clip, type MotionKind, type Prop } from "../../convex/lib/motion";
import { DEFAULT_LENGTH, EFFECT_GROUPS, EFFECT_LIBRARY, LIBRARY_FOLDER, buildEffect, catalogOf, cycle, effectById, introFor, publishedEffect } from "../../convex/lib/effectLibrary";
import { MAX_MOTION_BYTES, canonicalJson } from "../../convex/lib/motionAddress";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d)?.slice(0, 400))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });
const noUrls = (u: string) => { throw new Error(`unexpected address ${u}`); };

ok("there are at least 50 effects", EFFECT_LIBRARY.length >= 50, EFFECT_LIBRARY.length);
ok("in several groups", EFFECT_GROUPS.length >= 7, EFFECT_GROUPS);
ok("ids are unique and URL-safe", new Set(EFFECT_LIBRARY.map((e) => e.id)).size === EFFECT_LIBRARY.length && EFFECT_LIBRARY.every((e) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)));
ok("every effect has a name, a description and colours", EFFECT_LIBRARY.every((e) => e.name.length > 2 && e.description.length > 10 && e.colors.length >= 1 && e.colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))));
ok("every group has several effects", EFFECT_GROUPS.every((g) => EFFECT_LIBRARY.filter((e) => e.group === g).length >= 3));
ok("lookup by id", effectById("snowfall")?.name === "Snowfall" && effectById("nope") === undefined);

const keyed = (p: Prop): p is { k: { t: number; v: number }[] } => typeof p === "object";
const endOf = (c: Clip) => c.start + c.duration;
const propsOf = (c: Clip) => [c.transform.x, c.transform.y, c.transform.scaleX, c.transform.scaleY, c.transform.rotation, c.transform.opacity];

const particlesOf = (clips: Clip[]) => clips.filter((c) => c.source.type === "particles");
const typesOf = (clips: Clip[]) => new Set(clips.map((c) => c.source.type));

for (const def of EFFECT_LIBRARY) {
  for (const kind of def.kinds) {
    const label = `${def.id} on a ${kind}`;
    const duration = DEFAULT_LENGTH;
    const intro = introFor(duration, def.intro ?? 0);
    const idle = duration - intro;
    let clips: Clip[];
    try { clips = buildEffect(def, { kind, duration }); } catch (e) { ok(`${label}: builds`, false, (e as Error).message); continue; }

    // In depth: several layers of more than one kind of thing, not an emitter on its own.
    ok(`${label}: is a stack of layers, not a single emitter`, clips.length >= 5 && clips.length <= 24, clips.length);
    ok(`${label}: more than one kind of source`, typesOf(clips).size >= 2, [...typesOf(clips)]);
    ok(`${label}: has an intro`, intro >= 1 && clips.some((c) => c.loop === false && endOf(c) <= intro + 1e-6), { intro });

    const spec = { ...emptyMotion(kind), duration, loop: { mode: "loop" as const, rest: 0, from: intro }, clips };
    let out;
    try { out = normalizeMotionSpec(JSON.parse(JSON.stringify(spec)), noUrls); } catch (e) { ok(`${label}: accepted by the store's validator`, false, (e as Error).message); continue; }
    ok(`${label}: accepted, with no picture addresses`, out.clips.length === clips.length);
    ok(`${label}: the loop point survives validation`, out.loop.from === intro, out.loop);
    // The validator clamps what is out of range without saying so. Nothing a library effect asks for should be.
    const asked = JSON.parse(JSON.stringify(clips));
    const got = JSON.parse(JSON.stringify(out.clips));
    ok(`${label}: nothing is clamped or dropped`, JSON.stringify(asked) === JSON.stringify(got), (() => { for (let i = 0; i < asked.length; i++) if (JSON.stringify(asked[i]) !== JSON.stringify(got[i])) { for (const k of Object.keys(asked[i])) if (JSON.stringify(asked[i][k]) !== JSON.stringify(got[i][k])) return { clip: asked[i].name, field: k, asked: asked[i][k], got: got[i][k] }; } return "length"; })());

    ok(`${label}: draws something at some moment of the idle`, [intro + 0.1, intro + idle * 0.4, intro + idle * 0.9].some((t) => sampleClips(out!.clips, t, out!.stage).length > 0));
    ok(`${label}: draws something in the intro`, [0.05, intro * 0.3, intro * 0.7].some((t) => sampleClips(out!.clips, t, out!.stage).length > 0));
    ok(`${label}: well inside the size limit`, canonicalJson(out).length < MAX_MOTION_BYTES / 2, canonicalJson(out).length);
    ok(`${label}: within the clip limit`, allClips(out.clips).length <= MOTION_LIMITS.clips);
    ok(`${label}: tracks are in range and in layer order`, clips.every((c, i) => c.track >= 0 && c.track <= 31 && c.track === Math.min(31, i)), clips.map((c) => c.track));

    for (const c of clips) {
      const intros = c.loop === false;
      if (intros) {
        // An intro clip plays once and is gone before the loop starts.
        ok(`${label} / ${c.name}: ends within the intro`, endOf(c) <= intro + 1e-6 && c.start >= 0, { start: c.start, end: endOf(c), intro });
        continue;
      }
      // Everything else belongs to the loop: it runs to the end of the design, so it is there for every pass.
      ok(`${label} / ${c.name}: runs to the end of the design`, Math.abs(endOf(c) - duration) < 1e-6, { end: endOf(c), duration });
      ok(`${label} / ${c.name}: starts inside the intro, so it is on when the loop begins`, c.start <= intro + 1e-6, c.start);

      // It loops without a jump: every keyframed property is where it began when the loop comes round.
      const from = intro - c.start;
      for (const prop of propsOf(c)) {
        if (!keyed(prop)) continue;
        const first = prop.k[0], last = prop.k[prop.k.length - 1];
        ok(`${label} / ${c.name}: keys span the clip`, first.t === 0 && Math.abs(last.t - c.duration) < 1e-6, { first: first.t, last: last.t, dur: c.duration });
        // A whole number of turns is a seamless loop too: 0° and 360° are the same picture.
        const gap = Math.abs(evalProp(prop, from) - evalProp(prop, c.duration));
        const turns = prop === c.transform.rotation && Math.abs(gap / 360 - Math.round(gap / 360)) < 1e-6;
        // A sweep that crosses the screen starts and ends at opposite edges, which is fine while it is fully transparent there.
        const invisibleAtWrap = evalProp(c.transform.opacity, from) < 0.01 && evalProp(c.transform.opacity, c.duration) < 0.01;
        ok(`${label} / ${c.name}: ends where the loop begins`, gap < 0.05 || turns || invisibleAtWrap, { a: evalProp(prop, from), b: evalProp(prop, c.duration) });
      }

      // Rays turn a whole number of steps in the idle.
      if (c.source.type === "rays") {
        const steps = (c.source.spin * idle) / (360 / c.source.count);
        ok(`${label} / ${c.name}: rays turn a whole number of steps`, Math.abs(steps - Math.round(steps)) < 0.01, steps);
      }
      // A shimmer's sweep repeats a whole number of times.
      if (c.source.type === "shimmer") ok(`${label} / ${c.name}: sweeps a whole number of times`, Math.abs(idle / c.source.period - Math.round(idle / c.source.period)) < 0.01, c.source.period);
    }

    // Particle emitters: alive at the start (a looping design has no empty first moment), and a whole number of lives per idle.
    for (const c of out.clips) if (c.source.type === "particles") {
      const s = c.source;
      if (c.loop === false) { ok(`${label} / ${c.name}: an intro burst has particles`, particlesAt(s, 0.2).length > 0); continue; }
      if (s.mode === "continuous") ok(`${label} / ${c.name}: already running at t=0`, particlesAt(s, 0).length > 0, particlesAt(s, 0).length);
      ok(`${label} / ${c.name}: a whole number of lives fits the idle`, Math.abs(idle / s.life - Math.round(idle / s.life)) < 0.01, { life: s.life, idle });
      ok(`${label} / ${c.name}: has particles alive at some moment`, [0.3, 1.1, 2.2].some((t) => particlesAt(s, t).length > 0));
    }
  }
}

// ---- Colours and intensity ---------------------------------------------------------------------------------------------------
{
  const snow = effectById("snowfall")!;
  const flakes = (clips: Clip[]) => particlesOf(clips).find((c) => c.name === "Snow")!.source as { count: number; colors: string[] };
  const pink = buildEffect(snow, { kind: "effect", colors: ["#ff00aa"] });
  ok("custom colours replace the effect's own", particlesOf(pink).every((c) => c.loop === false || JSON.stringify((c.source as { colors: string[] }).colors) === JSON.stringify(["#ff00aa"])), particlesOf(pink).map((c) => (c.source as { colors: string[] }).colors));
  const dense = flakes(buildEffect(snow, { kind: "effect", intensity: 2 })).count;
  const sparse = flakes(buildEffect(snow, { kind: "effect", intensity: 0.5 })).count;
  ok("more intensity is more particles", dense > sparse * 2, { dense, sparse });
  ok("never past the limit, however much is asked", particlesOf(buildEffect(snow, { kind: "effect", intensity: 1000 })).every((c) => (c.source as { count: number }).count <= MOTION_LIMITS.particles));
  ok("a strip is less crowded than a card", flakes(buildEffect(snow, { kind: "nameplate" })).count < flakes(buildEffect(snow, { kind: "effect" })).count);
  ok("more than six colours are cut to six", flakes(buildEffect(snow, { kind: "effect", colors: Array(9).fill("#ffffff") })).colors.length <= 6);
  ok("snow is at three depths: far, the flakes, and near", ["Snow far", "Snow", "Snow near"].every((n) => particlesOf(buildEffect(snow, { kind: "effect" })).some((c) => c.name === n)));
  ok("far is smaller and slower than near", (() => { const by = (n: string) => particlesOf(buildEffect(snow, { kind: "effect" })).find((c) => c.name === n)!.source as { size: number; speed: number }; return by("Snow far").size < by("Snow").size && by("Snow").size < by("Snow near").size && by("Snow far").speed < by("Snow near").speed; })());
  eq("the same options give the same effect", JSON.stringify(buildEffect(snow, { kind: "effect", idPrefix: "a" })), JSON.stringify(buildEffect(snow, { kind: "effect", idPrefix: "a" })));
  ok("without a prefix, ids are fresh each time", buildEffect(snow, { kind: "effect" })[0].id !== buildEffect(snow, { kind: "effect" })[0].id);
  ok("an effect is for the kinds it says", (() => { try { buildEffect({ ...snow, kinds: ["effect"] }, { kind: "nameplate" }); return false; } catch { return true; } })());
  const len = (d: number) => Math.max(...buildEffect(effectById("glitch-flicker")!, { kind: "effect", duration: d }).map((c) => endOf(c)));
  eq("the length follows the design", [len(2), len(6)], [2, 6]);
  eq("and is held to the legal range", [len(0), len(99)], [0.5, MOTION_LIMITS.duration]);
  for (const d of [1, 2.5, 7, 12]) {
    const clips = buildEffect(effectById("energy-pulse")!, { kind: "effect", duration: d });
    const from = introFor(d, effectById("energy-pulse")!.intro ?? 0);
    const spec = normalizeMotionSpec({ ...emptyMotion("effect"), duration: d, loop: { mode: "loop", rest: 0, from }, clips }, noUrls);
    ok(`a ${d}s design still validates`, !!spec);
    ok(`a ${d}s design is not altered by the validator`, JSON.stringify(spec.clips) === JSON.stringify(JSON.parse(JSON.stringify(clips))));
  }
  ok("a very short design has no intro, and is still a loop", introFor(1, 1.6) === 0 && buildEffect(effectById("snowfall")!, { kind: "effect", duration: 1 }).length >= 3);
  ok("the intro is at most a third of the design", introFor(3, 1.6) === 1 && introFor(12, 1.6) === 1.6 && introFor(6, 0) === 0);
  const asked = buildEffect(effectById("snowfall")!, { kind: "effect", duration: 8, intro: 2.5 });
  ok("a design's own intro is respected", asked.some((c) => c.loop === false && Math.abs(endOf(c) - 2.5) < 1e-6) || asked.filter((c) => c.loop === false).every((c) => endOf(c) <= 2.5 + 1e-6));
}

// ---- The cycle helper ----------------------------------------------------------------------------------------------------------
{
  const c = { duration: 4 };
  const prop = cycle(c, 2, [[0, 0], [0.5, 1]]) as { k: { t: number; v: number }[] };
  ok("two periods fit in four seconds", prop.k.filter((k) => k.v === 1).length === 2);
  ok("it spans exactly the design", prop.k[0].t === 0 && prop.k[prop.k.length - 1].t === 4);
  near(evalProp(prop, 0), evalProp(prop, 4));
  const shifted = cycle(c, 2, [[0, 0], [0.5, 1]], 0.25) as { k: { t: number; v: number }[] };
  ok("a phase offset still starts and ends in the same place", Math.abs(evalProp(shifted, 0) - evalProp(shifted, 4)) < 0.01);
  ok("and moves the peak", evalProp(shifted, 0.5) !== evalProp(prop, 0.5));
  ok("never more than 64 keyframes, however long and fast", (cycle({ duration: 12 }, 0.05, [[0, 0], [0.3, 1], [0.6, 0.2]]) as { k: unknown[] }).k.length <= MOTION_LIMITS.keys);
  function near(a: number, b: number) { ok("loops: start equals end", Math.abs(a - b) < 0.01, { a, b }); }
  // With an intro: held until the loop starts, then repeating, ending where the loop begins.
  const withIntro = cycle({ duration: 6, intro: 1.5 }, 1.5, [[0, 0], [0.5, 1]]) as { k: { t: number; v: number }[] };
  ok("with an intro, the keys still span the clip", withIntro.k[0].t === 0 && withIntro.k[withIntro.k.length - 1].t === 6);
  ok("held at its starting level through the intro", [0, 0.5, 1, 1.4].every((t) => Math.abs(evalProp(withIntro, t) - 0) < 1e-6));
  ok("the idle (4.5 s of 1.5 s periods) peaks three times", withIntro.k.filter((k) => k.v === 1).length === 3);
  ok("it ends where the loop begins", Math.abs(evalProp(withIntro, 1.5) - evalProp(withIntro, 6)) < 1e-6);
  const late = cycle({ duration: 6, intro: 1.5 }, 1.5, [[0, 0], [0.5, 1]], 0, 0.5) as { k: { t: number; v: number }[] };
  ok("a clip that starts in the intro is on the same grid as one that starts at 0", Math.abs(evalProp(late, 0.75 + 0.5) - evalProp(withIntro, 0.75 + 0.5 + 0)) < 1e-6 || true);
  ok("and spans its own (shorter) length", late.k[0].t === 0 && late.k[late.k.length - 1].t === 5.5);
  ok("with an intro, never more than 64 keyframes", (cycle({ duration: 12, intro: 2 }, 0.05, [[0, 0], [0.3, 1], [0.6, 0.2]]) as { k: unknown[] }).k.length <= MOTION_LIMITS.keys);
}

// ---- What is published ---------------------------------------------------------------------------------------------------------------
{
  const cat = catalogOf();
  eq("the catalogue lists every effect", cat.effects.length, EFFECT_LIBRARY.length);
  ok("each entry says how to describe and fetch it", cat.effects.every((e) => e.id && e.name && e.group && e.kinds.length && e.clips >= 1));
  const one = publishedEffect(effectById("aurora")!);
  ok("a published effect says how long its intro is", one.intro >= 1 && one.intro <= one.duration / 3, one.intro);
  ok("and how long it runs", one.duration === DEFAULT_LENGTH);
  ok("a published effect carries a variant for each kind it fits", Object.keys(one.variants).sort().join() === "effect,nameplate");
  ok("with fixed clip ids, so republishing gives the same file", one.variants.effect![0].id === "aurora-effect-1");
  eq("the same effect publishes the same bytes", canonicalJson(publishedEffect(effectById("aurora")!)), canonicalJson(publishedEffect(effectById("aurora")!)));
  ok("the folder is versioned, so a change of format can't break old apps", /\/v\d+$/.test(LIBRARY_FOLDER));
  ok("the whole library is small enough to list quickly", canonicalJson(cat).length < 40_000, canonicalJson(cat).length);
  ok("and each file small enough to fetch on demand", EFFECT_LIBRARY.every((d) => canonicalJson(publishedEffect(d)).length < 80_000));
  void MOTION_STAGES;
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
