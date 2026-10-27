import { MOTION_LIMITS, MOTION_STAGES, allClips, evalProp, normalizeMotionSpec, particlesAt, sampleClips, type Clip, type Prop } from "../../convex/lib/motion";
import { COLLECTION_DECORATIONS, COLLECTION_DESIGNS, COLLECTION_EFFECTS, COLLECTION_NAMEPLATES, buildDesign, grantKindOf } from "../../convex/lib/cosmeticCollection";
import { MAX_MOTION_BYTES, canonicalJson } from "../../convex/lib/motionAddress";
import { COLLECTION_PRESETS } from "../../src/lib/avatar-decoration-collection";
import { DECORATION_PRESETS, decorationLayers, decorationSrc } from "../../src/lib/avatar-decorations";
import { refractionFilterId, refractionFilterSvg, refractionLensStyle, refractionOf } from "../../src/lib/decoration-refraction";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d)?.slice(0, 400))); };
const noUrls = (u: string) => { throw new Error(`unexpected address ${u}`); };
const keyed = (x: Prop): x is { k: { t: number; v: number }[] } => typeof x === "object";
const endOf = (c: Clip) => c.start + c.duration;
const propsOf = (c: Clip) => [c.transform.x, c.transform.y, c.transform.scaleX, c.transform.scaleY, c.transform.rotation, c.transform.opacity];

// ---- The set ------------------------------------------------------------------------------------------------------------------
ok("nine nameplates and seven profile effects", COLLECTION_NAMEPLATES.length === 9 && COLLECTION_EFFECTS.length === 7);
ok("every design is the kind its list says", COLLECTION_NAMEPLATES.every((d) => d.kind === "nameplate") && COLLECTION_EFFECTS.every((d) => d.kind === "effect"));
ok("slugs are unique and valid for a SKU", new Set(COLLECTION_DESIGNS.map((d) => d.slug)).size === COLLECTION_DESIGNS.length && COLLECTION_DESIGNS.every((d) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug) && d.slug.length <= 60));
ok("names are 2 to 80 characters and descriptions are under 600", COLLECTION_DESIGNS.every((d) => d.name.length >= 2 && d.name.length <= 80 && d.description.length > 40 && d.description.length <= 600));
ok("prices are whole cents above Stripe's minimum", COLLECTION_DESIGNS.every((d) => Number.isInteger(d.priceCents) && d.priceCents >= 50));
ok("colours are hex", COLLECTION_DESIGNS.every((d) => d.colors.length >= 3 && d.colors.every((x) => /^#[0-9a-f]{6}$/i.test(x))));
ok("grant kinds match", COLLECTION_NAMEPLATES.every((d) => grantKindOf(d) === "nameplate") && COLLECTION_EFFECTS.every((d) => grantKindOf(d) === "profileEffect"));

for (const d of COLLECTION_DESIGNS) {
  const label = `${d.slug}`;
  const spec = buildDesign(d);
  const stage = MOTION_STAGES[d.kind];
  const intro = d.intro;
  const idle = d.duration - intro;
  ok(`${label}: on the stage its kind is authored on`, spec.stage.w === stage.w && spec.stage.h === stage.h);
  ok(`${label}: an intro of at least a second, under a third of the design`, intro >= 1 && intro <= d.duration / 3 + 1e-9, intro);

  let out;
  try { out = normalizeMotionSpec(JSON.parse(JSON.stringify(spec)), noUrls); } catch (e) { ok(`${label}: accepted by the store's validator`, false, (e as Error).message); continue; }
  ok(`${label}: accepted, with no picture addresses`, allClips(out.clips).length === allClips(spec.clips).length);
  ok(`${label}: the loop point survives validation`, out.loop.from === intro && out.loop.mode === "loop", out.loop);

  // The validator clamps what is out of range without saying so. Nothing a design asks for should be.
  const asked = JSON.parse(JSON.stringify(spec.clips));
  const got = JSON.parse(JSON.stringify(out.clips));
  const diff = (() => { for (let i = 0; i < asked.length; i++) if (JSON.stringify(asked[i]) !== JSON.stringify(got[i])) { for (const k of Object.keys(asked[i])) if (JSON.stringify(asked[i][k]) !== JSON.stringify(got[i][k])) return { clip: asked[i].name, field: k, asked: asked[i][k], got: got[i][k] }; } return "length"; })();
  ok(`${label}: nothing is clamped or dropped`, JSON.stringify(asked) === JSON.stringify(got), diff);

  const all = allClips(out.clips);
  ok(`${label}: fixed, unique clip ids, so republishing gives the same address`, new Set(all.map((c) => c.id)).size === all.length && all.every((c) => c.id.startsWith(`${d.slug}-`)));
  ok(`${label}: the same design builds the same bytes`, canonicalJson(buildDesign(d)) === canonicalJson(buildDesign(d)));
  ok(`${label}: layered, but light enough to draw in a list (at most 56 clips)`, out.clips.length >= 8 && all.length <= 56, all.length);
  ok(`${label}: well inside the size limit`, canonicalJson(out).length < MAX_MOTION_BYTES / 2, canonicalJson(out).length);
  ok(`${label}: within the clip limit`, all.length <= MOTION_LIMITS.clips);
  ok(`${label}: more than one kind of source`, new Set(all.map((c) => c.source.type)).size >= 4, [...new Set(all.map((c) => c.source.type))]);

  ok(`${label}: draws something at some moment of the idle`, [intro + 0.1, intro + idle * 0.4, intro + idle * 0.9].every((t) => sampleClips(out!.clips, t, out!.stage).length >= 5));
  ok(`${label}: draws something in the intro`, [0.05, intro * 0.3, intro * 0.7].every((t) => sampleClips(out!.clips, t, out!.stage).length >= 5));
  ok(`${label}: has intro clips that play once`, out.clips.some((c) => !c.loop));

  for (const c of out.clips) {
    if (!c.loop) {
      // An intro clip plays once and is gone before the loop starts: invisible on its last key.
      ok(`${label} / ${c.name}: ends within the intro`, endOf(c) <= intro + 1e-6 && c.start >= 0, { end: endOf(c), intro });
      if (c.source.type !== "particles") ok(`${label} / ${c.name}: is invisible by the end of the intro`, evalProp(c.transform.opacity, c.duration) < 0.01, evalProp(c.transform.opacity, c.duration));
      continue;
    }
    ok(`${label} / ${c.name}: runs to the end of the design`, Math.abs(endOf(c) - d.duration) < 1e-6, { end: endOf(c) });
    ok(`${label} / ${c.name}: starts inside the intro`, c.start <= intro + 1e-6);
    const from = intro - c.start;
    for (const prop of propsOf(c)) {
      if (!keyed(prop)) continue;
      const first = prop.k[0], last = prop.k[prop.k.length - 1];
      ok(`${label} / ${c.name}: keys span the clip`, first.t === 0 && Math.abs(last.t - c.duration) < 1e-6, { first: first.t, last: last.t, dur: c.duration });
      const gap = Math.abs(evalProp(prop, from) - evalProp(prop, c.duration));
      const turns = prop === c.transform.rotation && Math.abs(gap / 360 - Math.round(gap / 360)) < 1e-6;
      const invisibleAtWrap = evalProp(c.transform.opacity, from) < 0.01 && evalProp(c.transform.opacity, c.duration) < 0.01;
      ok(`${label} / ${c.name}: ends where the loop begins`, gap < 0.05 || turns || invisibleAtWrap, { a: evalProp(prop, from), b: evalProp(prop, c.duration) });
    }
    if (c.source.type === "rays") {
      const steps = (c.source.spin * idle) / (360 / c.source.count);
      ok(`${label} / ${c.name}: rays turn a whole number of steps`, Math.abs(steps - Math.round(steps)) < 0.01, steps);
    }
    if (c.source.type === "shimmer") ok(`${label} / ${c.name}: sweeps a whole number of times`, Math.abs(idle / c.source.period - Math.round(idle / c.source.period)) < 0.01, c.source.period);
    if (c.source.type === "compound") ok(`${label} / ${c.name}: a compound turns whole turns per idle`, (() => { const r = c.transform.rotation; if (!keyed(r)) return false; const turns = (r.k[r.k.length - 1].v - evalProp(r, from)) / 360; return Math.abs(turns - Math.round(turns)) < 1e-3 && Math.round(turns) !== 0; })());
  }
  for (const c of all) if (c.source.type === "particles") {
    const s = c.source;
    if (!c.loop) { ok(`${label} / ${c.name}: an intro burst has particles`, particlesAt(s, 0.2).length > 0); continue; }
    if (s.mode === "continuous") ok(`${label} / ${c.name}: already running at t=0`, particlesAt(s, 0).length > 0);
    ok(`${label} / ${c.name}: a whole number of lives fits the idle`, Math.abs(idle / s.life - Math.round(idle / s.life)) < 0.01, { life: s.life, idle });
    ok(`${label} / ${c.name}: has particles alive at some moment`, [0.3, 1.1, 2.2, 4.4].some((t) => particlesAt(s, t).length > 0));
  }
}

// ---- Avatar decorations -------------------------------------------------------------------------------------------------------
ok("fifteen decorations", COLLECTION_PRESETS.length === 15 && COLLECTION_DECORATIONS.length === 15);
ok("the server's listing and the app's artwork name the same keys, in the same order", JSON.stringify(COLLECTION_DECORATIONS.map((d) => d.key)) === JSON.stringify(COLLECTION_PRESETS.map((x) => x.key)), { server: COLLECTION_DECORATIONS.map((d) => d.key), app: COLLECTION_PRESETS.map((x) => x.key) });
ok("keys are URL-safe and unique", new Set(COLLECTION_PRESETS.map((x) => x.key)).size === 15 && COLLECTION_PRESETS.every((x) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(x.key)));
ok("a preset's stored value is builtin:<key>", COLLECTION_PRESETS.every((x) => x.value === `builtin:${x.key}`));
ok("decoration prices are whole cents above Stripe's minimum", COLLECTION_DECORATIONS.every((d) => Number.isInteger(d.priceCents) && d.priceCents >= 50 && d.description.length > 20 && d.name.length >= 2));
ok("the app draws every one of them from its stored value", COLLECTION_PRESETS.every((x) => !!decorationSrc(x.value) && decorationSrc(x.value) === x.src));
ok("as a layer, at the size the artwork was made for", COLLECTION_PRESETS.every((x) => { const l = decorationLayers(`layers:${JSON.stringify([{ kind: "image", url: x.value, anchor: "center", x: 50, y: 0, width: 126 }])}`); return l.length === 1 && l[0].width === 126; }));
ok("they are not offered free in the picker", COLLECTION_PRESETS.every((x) => !DECORATION_PRESETS.some((q) => q.key === x.key || q.value === x.value)));
ok("each is a self-contained SVG data URI with a 100x100 canvas", COLLECTION_PRESETS.every((x) => x.src.startsWith("data:image/svg+xml,") && decodeURIComponent(x.src).includes('viewBox="0 0 100 100"')));
ok("and the in-app still is under 28 KB (URL-encoded), since it is held in the bundle", COLLECTION_PRESETS.every((x) => x.src.length < 28 * 1024), COLLECTION_PRESETS.map((x) => [x.key, x.src.length]));
ok("every decoration has a published, animated form that says what moves", COLLECTION_PRESETS.every((x) => /<animate(Transform|Motion)?\s/.test(x.animatedSvg) && x.motion.length > 20));
ok("and the still has no animation at all", COLLECTION_PRESETS.every((x) => !/<animate|<set\s/.test(decodeURIComponent(x.src))));
ok("the animated form is a whole SVG document, small enough to fetch with every avatar", COLLECTION_PRESETS.every((x) => x.animatedSvg.startsWith("<svg ") && x.animatedSvg.endsWith("</svg>") && x.animatedSvg.length < 20 * 1024), COLLECTION_PRESETS.map((x) => [x.key, x.animatedSvg.length]));
ok("animations repeat for ever and have a duration", COLLECTION_PRESETS.every((x) => (x.animatedSvg.match(/<animate[A-Za-z]*\s[^>]*>/g) ?? []).every((t) => /dur="[\d.]+s"/.test(t) && /repeatCount="indefinite"/.test(t))));
ok("the animated form is safe: no script, event handler, foreignObject or external address", COLLECTION_PRESETS.every((x) => !/<script|foreignObject|\son[a-z]+=|href=["'](?!#)|url\(["']?(?!#)|<image|@import|<style/i.test(x.animatedSvg)), COLLECTION_PRESETS.filter((x) => /<script|foreignObject|\son[a-z]+=|href=["'](?!#)|url\(["']?(?!#)|<image|@import|<style/i.test(x.animatedSvg)).map((x) => x.key));
ok("every id used by a url(#…) or xlink:href=#… exists in the document", COLLECTION_PRESETS.every((x) => { const ids = new Set([...x.animatedSvg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])); return [...x.animatedSvg.matchAll(/(?:url\(#|href="#|mask="url\(#)([^)"]+)/g)].every((m) => ids.has(m[1])); }));
ok("no script, no external references", COLLECTION_PRESETS.every((x) => { const s = decodeURIComponent(x.src); return !/<script|onload|href=["']http|url\(["']?http|<image/i.test(s); }));

// ---- Refraction -------------------------------------------------------------------------------------------------------------------
ok("an address can ask for ice refraction", refractionOf("https://cdn.test/marketplace/avatar-decorations/ice-cube-ab12.svg#refract=ice") === "ice");
ok("no fragment, no refraction", refractionOf("https://cdn.test/a.svg") === undefined && refractionOf(undefined) === undefined && refractionOf("") === undefined);
ok("a kind this build doesn't know is ignored, not drawn", refractionOf("https://cdn.test/a.svg#refract=lava") === undefined && refractionOf("https://cdn.test/a.svg#refract=") === undefined);
ok("nothing after the kind leaks through", refractionOf("https://cdn.test/a.svg#refract=ice&x=<script>") === "ice");
{
  const svg = refractionFilterSvg("ice");
  ok("the filter is a closed SVG with the id the lens refers to", svg.startsWith("<svg ") && svg.endsWith("</svg>") && svg.includes(`id="${refractionFilterId("ice")}"`));
  ok("it displaces each colour channel separately, for a fringe", (svg.match(/<feDisplacementMap /g) ?? []).length === 3);
  ok("and has no script or external reference", !/<script|\son[a-z]+=|href="https?:/i.test(svg));
  const css = refractionLensStyle("ice");
  ok("the lens filters the backdrop with that filter and keeps the avatar's corners", css.backdropFilter.includes(`url(#${refractionFilterId("ice")})`) && css.WebkitBackdropFilter === css.backdropFilter && css.borderRadius === "inherit" && css.pointerEvents === "none");
}
ok("the ice cube asks for it, and nothing else does", COLLECTION_PRESETS.filter((x) => x.refract).map((x) => x.key).join() === "ice-cube");

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
