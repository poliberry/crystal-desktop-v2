import assert from "node:assert/strict";
import { applyShader, fxPadding, hash01, hasFx, linearEnds, parseColor, gradientCss, newShader, fxBox } from "../../src/studio/model/fx.ts";

const near = (a: number, b: number, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} !~ ${b}`);

// colour parsing
assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
assert.deepEqual(parseColor("#8b5cf6"), [139, 92, 246, 1]);
assert.deepEqual(parseColor("#ff000080"), [255, 0, 0, 128 / 255]);
assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), [10, 20, 30, 0.5]);
assert.deepEqual(parseColor("nonsense"), [0, 0, 0, 1]);
assert.deepEqual(parseColor("rgb(999,0,0)"), [255, 0, 0, 1]);

// linear gradient: 0deg runs left to right across the full width; 90 top to bottom
let e = linearEnds({ angle: 0 }, 200, 100);
near(e.x0, 0); near(e.x1, 200); near(e.y0, 50); near(e.y1, 50);
e = linearEnds({ angle: 90 }, 200, 100);
near(e.y0, 0); near(e.y1, 100); near(e.x0, 100);
// 45deg: corners land on the end points (projection of corner onto the line equals the half-length)
e = linearEnds({ angle: 45 }, 100, 100);
const proj = (x: number, y: number) => ((x - e.x0) * (e.x1 - e.x0) + (y - e.y0) * (e.y1 - e.y0)) / ((e.x1 - e.x0) ** 2 + (e.y1 - e.y0) ** 2);
near(proj(0, 0), 0); near(proj(100, 100), 1);

assert.match(gradientCss({ type: "linear", angle: 0, stops: [{ offset: 1, color: "#000" }, { offset: 0, color: "#fff" }] }), /^linear-gradient\(90deg, #fff 0%, #000 100%\)$/);

// padding
assert.equal(fxPadding(undefined), 0);
assert.equal(fxPadding({ shadow: { on: true, x: 4, y: 10, blur: 6, color: "#000", opacity: 1 } }), 16);
assert.equal(fxPadding({ shadow: { on: false, x: 4, y: 10, blur: 6, color: "#000", opacity: 1 } }), 0);
assert.equal(fxPadding({ blur: 5 }), 10);

// hasFx / fxBox
const base = { id: "a", name: "A", x: 10, y: 10, w: 100, h: 50, rotation: 0, opacity: 1, locked: false, hidden: false, type: "shape", shape: "rect", fill: "#f00", stroke: "#000", strokeWidth: 0, radius: 0 } as const;
assert.equal(hasFx(base as never), false);
assert.equal(hasFx({ ...base, fx: { glow: { on: true, blur: 8, color: "#fff", opacity: 1, strength: 1 } } } as never), true);
assert.deepEqual(fxBox({ ...base, fx: { glow: { on: true, blur: 8, color: "#fff", opacity: 1, strength: 1 } } } as never), { x: 2, y: 2, w: 116, h: 66 });
assert.equal(hasFx({ ...base, type: "screen" } as never), false);

// hash: deterministic, in range, roughly uniform
assert.equal(hash01(5, 1), hash01(5, 1));
assert.notEqual(hash01(5, 1), hash01(5, 2));
let sum = 0; for (let i = 0; i < 20000; i++) { const v = hash01(i, 7); assert.ok(v >= 0 && v < 1); sum += v; }
assert.ok(Math.abs(sum / 20000 - 0.5) < 0.02, `mean ${sum / 20000}`);

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
// adjust: identity leaves colour alone
let d = px(100, 150, 200); applyShader(d, 1, 1, { ...newShader("adjust") } as never, 1);
assert.ok(Math.abs(d[0] - 100) <= 1 && Math.abs(d[1] - 150) <= 1 && Math.abs(d[2] - 200) <= 1, [...d].join());
// saturation 0 -> grey
d = px(255, 0, 0); applyShader(d, 1, 1, { ...newShader("adjust"), saturation: 0 } as never, 1);
assert.ok(d[0] === d[1] && d[1] === d[2], [...d].join());
// hue 180 of pure red is cyan-ish (r drops, g/b rise)
d = px(255, 0, 0); applyShader(d, 1, 1, { ...newShader("adjust"), hue: 180 } as never, 1);
assert.ok(d[0] < 60 && d[1] > 100 && d[2] > 100, [...d].join());
// transparent stays transparent
d = px(10, 10, 10, 0); applyShader(d, 1, 1, { ...newShader("grain"), amount: 1 } as never, 1);
assert.equal(d[3], 0); assert.deepEqual([...d.slice(0, 3)], [10, 10, 10]);
// grain is deterministic
const a1 = new Uint8ClampedArray(400).fill(128); const a2 = new Uint8ClampedArray(400).fill(128);
for (let i = 3; i < 400; i += 4) { a1[i] = 255; a2[i] = 255; }
applyShader(a1, 10, 10, { ...newShader("grain"), seed: 3 } as never, 1); applyShader(a2, 10, 10, { ...newShader("grain"), seed: 3 } as never, 1);
assert.deepEqual([...a1], [...a2]);
// duotone: black -> shadow colour, white -> highlight
d = px(0, 0, 0); applyShader(d, 1, 1, { ...newShader("duotone"), shadow: "#102030", highlight: "#f0e0d0" } as never, 1);
assert.deepEqual([...d], [16, 32, 48, 255]);
d = px(255, 255, 255); applyShader(d, 1, 1, { ...newShader("duotone"), shadow: "#102030", highlight: "#f0e0d0" } as never, 1);
assert.deepEqual([...d], [240, 224, 208, 255]);
// posterize 2 levels -> only 0/255
d = px(100, 200, 130); applyShader(d, 1, 1, { ...newShader("posterize"), levels: 2 } as never, 1);
assert.deepEqual([...d], [0, 255, 255, 255]);
// pixelate: a 2x2 block of 4 colours -> one average, alpha-weighted
const p = new Uint8ClampedArray([255,0,0,255, 0,0,255,255, 0,0,0,0, 0,0,0,0]);
applyShader(p, 2, 2, { ...newShader("pixelate"), size: 2 } as never, 1);
assert.equal(p[0], p[4]); assert.equal(p[3], 128); assert.equal(p[0], 128); assert.equal(p[2], 128);
// scanlines dims odd rows only
const s = new Uint8ClampedArray(4 * 4).fill(255); applyShader(s, 1, 4, { ...newShader("scanlines"), gap: 1, strength: 1 } as never, 1);
assert.deepEqual([s[3], s[7], s[11], s[15]], [255, 0, 255, 0]);
// chromatic: a lone grey pixel: the red copy lands one pixel right, the blue copy one pixel left
const c = new Uint8ClampedArray(3 * 4); c.set([200, 200, 200, 255], 4);
applyShader(c, 3, 1, { ...newShader("chromatic"), offset: 1 } as never, 1);
assert.deepEqual([...c.slice(0, 4)], [0, 0, 200, 255], "left: only blue");
assert.deepEqual([...c.slice(4, 8)], [200, 200, 200, 255], "middle: unchanged");
assert.deepEqual([...c.slice(8, 12)], [200, 0, 0, 255], "right: only red");
console.log("fx: all assertions passed");
