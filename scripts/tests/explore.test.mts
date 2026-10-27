import assert from "node:assert/strict";
import { TOPICS, search } from "../../src/studio/explore/content.ts";
import { keyLabel } from "../../src/studio/editor/keys.ts";
import { BRUSH_LABEL } from "../../src/studio/model/brush.ts";
import { MATERIAL_PRESETS } from "../../src/studio/model/material.ts";
import { EASE_PRESETS, MOTION_LIMITS } from "../../convex/lib/motion.ts";
import { SCENE_LIMITS } from "../../convex/lib/creationSpecs.ts";
import { MOTION_KEYS, MOTION_TOOLS } from "../../src/studio/motion/tools.ts";

const ids = TOPICS.map((t) => t.id);
assert.equal(new Set(ids).size, ids.length, "unique ids");
// the topics the editors' Help menus open
for (const id of ["start", "code"]) assert.ok(ids.includes(id), `topic ${id} exists`);
for (const t of TOPICS) { assert.ok(t.title && t.summary && t.blocks.length, t.id); }

// every shortcut renders to something non-empty and never "undefined"
for (const t of TOPICS) for (const b of t.blocks) if (b.t === "keys") for (const [label, combo] of b.rows) {
  const l = keyLabel(combo);
  assert.ok(l && !/undefined/.test(l) && (!l.endsWith("+") || combo.endsWith("++")), `${t.id}: ${label} -> "${l}"`);
}
assert.equal(keyLabel("mod++").includes("+"), true);
assert.ok(keyLabel("mod+shift+p").toLowerCase().includes("p"));

// facts come from the code that enforces them
const deco = TOPICS.find((t) => t.id === "decorations")!;
assert.ok(JSON.stringify(deco.blocks).includes("30%"), "decoration margin");
const scenes = JSON.stringify(TOPICS.find((t) => t.id === "scenes")!.blocks);
assert.ok(scenes.includes("24") && scenes.includes("fireflies"), "scene limits and props");
assert.ok(JSON.stringify(TOPICS.find((t) => t.id === "appearance")!.blocks).includes("Film grain"), "shaders listed");

// search
assert.equal(search("").length, TOPICS.length);
assert.ok(search("guide").some((t) => t.id === "view"));
assert.ok(search("minimap").some((t) => t.id === "code"));
assert.ok(search("zoom tool").some((t) => t.id === "tools"), "tool text is searchable");
assert.ok(search("anchor").some((t) => t.id === "paths"), "path guide searchable");
assert.ok(search("pathfinder").some((t) => t.id === "paths"), "pathfinder guide");
assert.ok(search("compound").some((t) => t.id === "paths"));
assert.ok(search("nest").some((t) => t.id === "groups"));
assert.ok(search("ungroup").some((t) => t.id === "groups"));
assert.ok(search("SHADOW").some((t) => t.id === "appearance"), "case-insensitive");
assert.deepEqual(search("zzzznotaword"), []);

// the newer topics exist, and say things that are true of the code
for (const id of ["materials", "brushes", "nameplates", "effects", "animation", "keyframes", "animation-limits"]) assert.ok(ids.includes(id), `topic ${id} exists`);
const text = (id: string) => JSON.stringify(TOPICS.find((t) => t.id === id)!.blocks);
for (const m of ["Oak", "Gold", "White marble", "Lava"]) assert.ok(text("materials").includes(m), `materials lists ${m}`);
assert.ok(text("materials").includes(String(MATERIAL_PRESETS.length)), "materials says how many presets there are");
for (const label of Object.values(BRUSH_LABEL)) assert.ok(text("brushes").includes(label), `brushes lists ${label}`);
assert.ok(text("nameplates").includes("960") && text("nameplates").includes("176"), "nameplate stage size");
assert.ok(text("effects").includes("600") && text("effects").includes("700"), "effect stage size");
assert.ok(text("animation-limits").includes(String(MOTION_LIMITS.clips)) && text("animation-limits").includes(String(MOTION_LIMITS.duration)), "animation limits come from the code");
for (const t of MOTION_TOOLS) assert.ok(text("animation").includes(t.label) && text("animation").includes(`(${t.key})`), `animation lists the ${t.label} tool and its key`);
for (const e of EASE_PRESETS) assert.ok(text("keyframes").includes(e), `keyframes lists ${e} easing`);
for (const g of MOTION_KEYS) for (const [label, combo] of g.rows) {
  const l = keyLabel(combo);
  assert.ok(label && l && !/undefined/.test(l), `${label} -> ${l}`);
  assert.ok(text("animation").includes(label), `the animation guide lists the shortcut “${label}”`);
}
// no guide still says what stopped being true
const everything = JSON.stringify(TOPICS);
assert.ok(!/autosave is always on/i.test(everything), "no claim that autosave is always on");
assert.ok(!/save themselves/i.test(everything), "no claim that files save themselves");
assert.ok(!/Not yet: brushes/.test(everything), "brushes are no longer 'not yet'");
assert.ok(!/has no path tools/.test(everything), "scenes have path tools");
assert.ok(text("scenes").includes(String(SCENE_LIMITS.overlay)), "the scene drawing limit is stated");
assert.ok(text("paths").includes("Paintbrush"), "paths mentions the Paintbrush");
assert.ok(/Nothing is saved until/.test(everything), "says when things are saved");
// the "try it" buttons make a kind that exists
for (const t of TOPICS) for (const b of t.blocks) if (b.t === "try") assert.ok(["decoration", "sticker", "scene", "nameplate", "effect"].includes(b.kind), `${t.id}: try ${b.kind}`);
// search
assert.ok(search("keyframe").some((t) => t.id === "keyframes"));
assert.ok(search("wood").some((t) => t.id === "materials"));
assert.ok(search("chalk").some((t) => t.id === "brushes"));
assert.ok(search("blade").some((t) => t.id === "animation"), "the timeline tools are searchable");
assert.ok(search("auto-key").some((t) => t.id === "keyframes"));
assert.ok(search("nameplate").some((t) => t.id === "nameplates"));
console.log("explore: all assertions passed");
