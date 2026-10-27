import assert from "node:assert/strict";
import { sanitizeDoc } from "../../src/studio/storage/format.ts";
import { sanitizeEffects, sanitizeGradient, newShader } from "../../src/studio/model/fx.ts";

const node = (extra: object) => ({ id: "a", type: "shape", name: "A", x: 0, y: 0, w: 50, h: 50, shape: "rect", fill: "#fff", ...extra });
const doc = (n: object) => ({ artboard: { w: 400, h: 400 }, nodes: { a: n }, order: ["a"] });

// valid effects and gradient survive a round trip through JSON and sanitize
const fx = { shadow: { on: true, x: 2, y: 6, blur: 10, color: "#000", opacity: 0.4 }, glow: { on: true, blur: 12, color: "#0ff", opacity: 1, strength: 2 }, blur: 3, shaders: [newShader("grain"), { ...newShader("adjust"), hue: 40 }] };
const grad = { type: "radial", angle: 0, stops: [{ offset: 0, color: "#f00" }, { offset: 1, color: "#00f" }] };
const out = sanitizeDoc(JSON.parse(JSON.stringify(doc(node({ fx, fillGradient: grad })))), "decoration").nodes.a as any;
assert.deepEqual(out.fx.shadow, fx.shadow);
assert.equal(out.fx.glow.strength, 2);
assert.equal(out.fx.shaders.length, 2);
assert.equal(out.fx.shaders[1].hue, 40);
assert.equal(out.fillGradient.type, "radial");

// no fx -> the field is absent, not an empty object
assert.equal("fx" in (sanitizeDoc(doc(node({})), "decoration").nodes.a as object), false);
assert.equal("fillGradient" in (sanitizeDoc(doc(node({})), "decoration").nodes.a as object), false);

// hostile values are clamped; junk is dropped
const hostile = sanitizeEffects({ shadow: { x: 1e9, y: -1e9, blur: 1e9, opacity: 7, color: "x".repeat(500) }, blur: 1e9, shaders: [{ type: "evil", on: true }, { type: "pixelate", size: -5 }, ...Array.from({ length: 40 }, () => newShader("grain"))] })!;
assert.equal(hostile.shadow!.x, 500); assert.equal(hostile.shadow!.y, -500); assert.equal(hostile.shadow!.blur, 200); assert.equal(hostile.shadow!.opacity, 1);
assert.equal(hostile.shadow!.color, "#000000");
assert.equal(hostile.blur, 100);
assert.equal(hostile.shaders!.length, 11, "evil dropped, then capped at 12 minus the dropped one");
assert.equal((hostile.shaders![0] as any).size, 1);
assert.equal(sanitizeEffects("nope"), undefined);
assert.equal(sanitizeEffects({}), undefined);
assert.equal(sanitizeEffects({ blur: 0 }), undefined);

// gradients need two stops
assert.equal(sanitizeGradient({ type: "linear", stops: [{ offset: 0, color: "#fff" }] }), undefined);
assert.equal(sanitizeGradient({ stops: "no" }), undefined);
assert.equal(sanitizeGradient({ type: "linear", angle: 1e9, stops: Array.from({ length: 20 }, (_, i) => ({ offset: i, color: "#fff" })) })!.stops.length, 8);
assert.equal(sanitizeGradient({ type: "linear", angle: 1e9, stops: [{ offset: 0, color: "#fff" }, { offset: 1, color: "#000" }] })!.angle, 360);
console.log("fx-format: all assertions passed");
