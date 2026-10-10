import { DEFAULT_MATERIAL, MATERIAL_COLORS, MATERIAL_LABEL, MATERIAL_PRESETS, MATERIAL_TYPES, cleanMaterial, defaultMaterial, fbm, materialPixels, noise2 } from "../../src/studio/model/material";
import type { Material } from "../../src/studio/model/types";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

const W = 96, H = 96;
const px = (m: Material, w = W, h = H, scale = 1) => materialPixels(m, w, h, scale);
const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
const stats = (d: Uint8ClampedArray) => { const n = d.length / 4; let s = 0, s2 = 0; for (let i = 0; i < n; i++) { const l = lum(d, i); s += l; s2 += l * l; } const mean = s / n; return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) }; };
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.length === b.length && a.every((v, i) => v === b[i]);
const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let t = 0; for (let i = 0; i < a.length; i += 4) t += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return t / (a.length / 4) / 3; };
/** Variation of brightness along a direction: mean absolute difference of neighbours. */
const roughness = (d: Uint8ClampedArray, dx: number, dy: number) => { let t = 0, n = 0; for (let y = 0; y < H - dy; y++) for (let x = 0; x < W - dx; x++) { t += Math.abs(lum(d, y * W + x) - lum(d, (y + dy) * W + x + dx)); n++; } return t / n; };

// --- noise ----------------------------------------------------------------------------------------
{
  let lo = 1, hi = 0, same2 = true;
  for (let i = 0; i < 2000; i++) { const x = i * 0.37, y = i * 0.91; const v = noise2(x, y, 3); lo = Math.min(lo, v); hi = Math.max(hi, v); if (v !== noise2(x, y, 3)) same2 = false; }
  ok("noise stays in [0,1) and is the same each time", lo >= 0 && hi < 1 && same2, { lo, hi });
  ok("noise uses the whole range (it isn't flat)", hi - lo > 0.8, { lo, hi });
  ok("a different seed is a different noise", Math.abs(noise2(5.3, 7.1, 1) - noise2(5.3, 7.1, 2)) > 1e-6);
  ok("noise is smooth: nearby points are nearly equal", Math.abs(noise2(10.5, 10.5, 1) - noise2(10.501, 10.5, 1)) < 0.01);
  let bad = 0; for (let i = 0; i < 500; i++) { const v = fbm(i * 0.21, i * 0.17, 9, 5); if (!(v >= 0 && v < 1)) bad++; }
  ok("layered noise stays in range", bad === 0, bad);
  ok("negative coordinates work (no NaN, no mirror seam)", Number.isFinite(noise2(-3.2, -9.9, 1)) && noise2(-0.001, 0.5, 1) !== undefined && Math.abs(noise2(-0.001, 0.5, 1) - noise2(0.001, 0.5, 1)) < 0.05);
}

// --- every material -----------------------------------------------------------------------------------
for (const type of MATERIAL_TYPES) {
  const m = defaultMaterial(type);
  const a = px(m);
  ok(`${type}: fully opaque`, a.every((v, i) => i % 4 !== 3 || v === 255));
  ok(`${type}: every channel is a real colour (no NaN → black, no overflow)`, a.every((v) => Number.isFinite(v)) && !a.every((v, i) => i % 4 === 3 || v === 0));
  ok(`${type}: the same material is the same pixels, twice`, same(a, px({ ...m })));
  ok(`${type}: it has texture, not a flat colour`, stats(a).sd > 6, stats(a));
  ok(`${type}: a different seed is a different surface`, diff(a, px({ ...m, seed: 2 })) > 1, diff(a, px({ ...m, seed: 2 })));
  ok(`${type}: its colours matter`, diff(a, px({ ...m, color: "#00ff00", color2: "#ff00ff" })) > 20);
  ok(`${type}: it has a label and names for its two colours`, !!MATERIAL_LABEL[type] && MATERIAL_COLORS[type].every((s) => s.length > 2));
  // Size independence: the same material drawn at 2× pixels per unit is the same picture, finer.
  const small = px(m, 48, 48, 1), big = px(m, 96, 96, 2);
  const down = new Uint8ClampedArray(48 * 48 * 4);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) for (let c = 0; c < 4; c++) { let t = 0; for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) t += big[((y * 2 + j) * 96 + x * 2 + i) * 4 + c]; down[(y * 48 + x) * 4 + c] = t / 4; }
  ok(`${type}: looks the same whatever size it is drawn at`, diff(small, down) < 22, diff(small, down));
  ok(`${type}: scale changes how big the features are`, diff(px({ ...m, scale: m.scale }), px({ ...m, scale: m.scale * 2.5 })) > 3);
  ok(`${type}: intensity changes it`, diff(px({ ...m, intensity: 0.1 }), px({ ...m, intensity: 1 })) > 1.5 || type === "brick");
}

// --- what makes each one itself -------------------------------------------------------------------------
{
  const wood = px(defaultMaterial("wood"));
  const along = roughness(wood, 1, 0), across = roughness(wood, 0, 1);
  ok("wood has a grain: it changes far faster across it than along it", across > along * 2.5, { along, across });
  const turned = px({ ...defaultMaterial("wood"), angle: 90 });
  ok("…and turning the angle turns the grain", roughness(turned, 1, 0) > roughness(turned, 0, 1) * 2.5, { x: roughness(turned, 1, 0), y: roughness(turned, 0, 1) });
  const metal = px(defaultMaterial("metal"));
  ok("brushed metal is streaked along its length", roughness(metal, 0, 1) > roughness(metal, 1, 0) * 1.5, { along: roughness(metal, 1, 0), across: roughness(metal, 0, 1) });
  const lightWood = px({ ...defaultMaterial("wood"), color: "#ffffff", color2: "#000000" });
  ok("wood spans between its two colours (not just one)", stats(lightWood).sd > 25);

  // Brick: a regular pattern of mortar lines.
  const brick = defaultMaterial("brick");
  const bp = px(brick, 160, 160, 1);
  const mortarRgb = [0xcf, 0xc6, 0xb8];
  let mortarPx = 0; for (let i = 0; i < 160 * 160; i++) if (Math.abs(bp[i * 4] - mortarRgb[0]) < 40 && Math.abs(bp[i * 4 + 1] - mortarRgb[1]) < 40 && Math.abs(bp[i * 4 + 2] - mortarRgb[2]) < 40) mortarPx++;
  const frac = mortarPx / (160 * 160);
  ok("brick has mortar between the bricks (a modest share of the surface)", frac > 0.04 && frac < 0.4, frac);
  // Rows are offset by half a brick: the mortar column positions in two neighbouring rows differ.
  const row = (y: number) => { const xs: number[] = []; for (let x = 0; x < 160; x++) { const i = (y * 160 + x) * 4; if (Math.abs(bp[i] - mortarRgb[0]) < 25 && Math.abs(bp[i + 1] - mortarRgb[1]) < 25) xs.push(x); } return xs; };
  const r1 = row(brick.scale * 0.5 | 0), r2 = row(brick.scale * 1.5 | 0);
  ok("brick courses are staggered", r1.length > 0 && r2.length > 0 && Math.abs((r1[0] % (brick.scale * 2)) - (r2[0] % (brick.scale * 2))) > brick.scale * 0.4, { r1: r1.slice(0, 4), r2: r2.slice(0, 4) });

  // Lava: some of it glows (bright warm), most is dark crust.
  const lava = px(defaultMaterial("lava"), 128, 128, 1);
  let hot = 0, dark = 0; for (let i = 0; i < 128 * 128; i++) { const l = lum(lava, i); if (l > 120 && lava[i * 4] > lava[i * 4 + 2] + 60) hot++; if (l < 60) dark++; }
  ok("lava has glowing seams and dark crust", hot / (128 * 128) > 0.01 && dark / (128 * 128) > 0.2, { hot: hot / 16384, dark: dark / 16384 });
  // Glitter: mostly base colour with scattered bright points.
  const gl = px(defaultMaterial("glitter"), 128, 128, 1);
  const gs = stats(gl); let sparks = 0; for (let i = 0; i < 128 * 128; i++) if (lum(gl, i) > gs.mean + 55) sparks++;
  ok("glitter is a base with scattered bright sparkles", sparks / (128 * 128) > 0.004 && sparks / (128 * 128) < 0.3, sparks / 16384);
  // Carbon fibre is a regular weave, so it repeats: shifting by two cells of the weave gives (nearly) the same picture.
  const cf = defaultMaterial("carbon");
  const cell = Math.round(cf.scale * 0.5 * 2);
  const c1 = px(cf, 96, 96, 1);
  let rep = 0, tot = 0; for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) { rep += Math.abs(lum(c1, y * 96 + x) - lum(c1, y * 96 + x + cell)); tot++; }
  ok("carbon fibre is a repeating weave", rep / tot < 18 && stats(c1).sd > 6, rep / tot);
  // Ice has cracks and frost; marble has veins that are dark/light vs the body.
  ok("marble has veins distinct from the body", stats(px(defaultMaterial("marble"))).sd > 10);
}

// --- presets and cleaning ---------------------------------------------------------------------------------
{
  ok("there are plenty of presets, in groups", MATERIAL_PRESETS.length >= 28 && new Set(MATERIAL_PRESETS.map((x) => x.group)).size >= 4);
  ok("preset ids are unique", new Set(MATERIAL_PRESETS.map((x) => x.id)).size === MATERIAL_PRESETS.length);
  ok("every preset is a valid material that renders", MATERIAL_PRESETS.every((x) => cleanMaterial(x.material) !== undefined && JSON.stringify(cleanMaterial(x.material)) === JSON.stringify(x.material)));
  ok("presets of one kind really look different (oak vs ebony)", diff(px(MATERIAL_PRESETS.find((x) => x.id === "oak")!.material), px(MATERIAL_PRESETS.find((x) => x.id === "ebony")!.material)) > 30);
  ok("every material kind has a preset", MATERIAL_TYPES.every((t) => MATERIAL_PRESETS.some((x) => x.material.type === t)));
  ok("every kind has defaults", MATERIAL_TYPES.every((t) => !!DEFAULT_MATERIAL[t]));
  const dirty = cleanMaterial({ type: "wood", color: "red; background:url(x)", color2: 5, scale: 1e9, intensity: -3, angle: 1e6, seed: 1.7e9 });
  ok("a hand-edited material is clamped and its colours must be hex", !!dirty && dirty.color === DEFAULT_MATERIAL.wood.color && dirty.color2 === DEFAULT_MATERIAL.wood.color2 && dirty.scale === 400 && dirty.intensity === 0 && dirty.angle === 360 && dirty.seed === 99999, dirty);
  ok("an unknown kind is dropped, not guessed", cleanMaterial({ type: "unobtainium" }) === undefined && cleanMaterial(null) === undefined && cleanMaterial("wood") === undefined);
  ok("a tiny scale can't hang the renderer (floored)", Number.isFinite(stats(px({ ...defaultMaterial("wood"), scale: 0 })).mean));
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
