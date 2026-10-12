/**
 * The MCP server's editing tools, used the way an agent uses them: the generated server is started in a real project folder and
 * called over stdio, and what it leaves on disk is read back with Studio's own loader. Run: bun scripts/tests/agent-tools.test.mts
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { buildAgentKit } from "../build-agent-kit.mjs";
import { ensureAgentKit, loadKitBundle, type KitFs } from "../../src/studio/agents/agent-kit";
import { allClips, sampleClips, particlesAt } from "../../convex/lib/motion";
import { decodeDocument, decodeProjectFile, encodeProject } from "../../src/studio/storage/format";
import { newProject } from "../../src/studio/storage/use-projects";
import type { Project, ProjectKind } from "../../src/studio/model/types";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : String(d).slice(0, 700))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ got, want }));

const root = join(import.meta.dir, "../..");
await buildAgentKit();
const bundle = await loadKitBundle(pathToFileURL(join(root, "public/studio-sdk/agent")).href);
const made: string[] = [];

const kitFs = (base: string): KitFs => ({
  exists: async (r) => existsSync(join(base, r)),
  readText: async (r) => readFileSync(join(base, r), "utf8"),
  writeText: async (r, t) => { mkdirSync(dirname(join(base, r)), { recursive: true }); writeFileSync(join(base, r), t); },
});

async function folder(kind: ProjectKind, mutate?: (p: Project) => void) {
  const dir = mkdtempSync(join(tmpdir(), `crystal-tools-${kind}-`));
  made.push(dir);
  const project = newProject(kind, "My Thing");
  mutate?.(project);
  const enc = encodeProject(project, "My Thing", []);
  writeFileSync(join(dir, enc.projectFile), enc.proj);
  if (enc.docFile) writeFileSync(join(dir, enc.docFile), enc.doc!);
  await ensureAgentKit(kitFs(dir), "", project, bundle);
  return { dir, project, docFile: enc.docFile ? join(dir, enc.docFile) : "" };
}

class Server {
  private proc;
  private buf = "";
  private waiting = new Map<number, (m: any) => void>();
  private n = 0;
  constructor(dir: string) {
    this.proc = spawn("node", [join(dir, ".crystal/mcp/server.mjs")], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (c: string) => {
      this.buf += c;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 1);
        this.waiting.get(m.id)?.(m);
      }
    });
  }
  rpc(method: string, params?: unknown): Promise<any> {
    const id = ++this.n;
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`no answer to ${method}`)), 10000);
      this.waiting.set(id, (m) => (clearTimeout(t), res(m)));
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  async tool(name: string, args: unknown = {}): Promise<{ text: string; isError: boolean }> {
    const r = (await this.rpc("tools/call", { name, arguments: args })).result;
    return { text: r.content[0].text, isError: r.isError === true };
  }
  async names(): Promise<string[]> {
    return ((await this.rpc("tools/list")).result.tools as { name: string }[]).map((t) => t.name);
  }
  close() { this.proc.kill(); }
}

/** The design file as Studio would load it. */
const load = (dir: string, project: Project): Project => {
  void project;
  const file = readdirSync(dir).find((n) => n.endsWith(".crysproj"))!;
  const decoded = decodeProjectFile(readFileSync(join(dir, file), "utf8"));
  return decodeDocument(decoded.project, readFileSync(join(dir, decoded.docFile!), "utf8"));
};
const idIn = (text: string, re: RegExp) => re.exec(text)?.[1] ?? "";

// ---- Which tools each kind of project is offered ---------------------------------------------------------------------------
{
  const expect: Record<string, { has: string[]; lacks: string[] }> = {
    nameplate: { has: ["add_effect", "animate", "move_clip", "add_node", "undo_last_change", "sample_design"], lacks: ["set_theme_colors", "add_scene_object"] },
    effect: { has: ["add_effect", "set_transition"], lacks: ["set_theme_colors"] },
    decoration: { has: ["add_node", "set_node", "describe_design"], lacks: ["add_effect", "animate", "add_scene_object"] },
    sticker: { has: ["add_node"], lacks: ["add_effect"] },
    scene: { has: ["add_scene_object", "set_scene_dim", "add_node"], lacks: ["add_effect", "animate"] },
    themePack: { has: ["set_theme_colors", "describe_theme", "remove_theme_variant"], lacks: ["add_node", "add_effect"] },
    bot: { has: ["project_info", "check_project"], lacks: ["add_node", "add_effect", "set_theme_colors", "undo_last_change"] },
    pack: { has: ["project_info"], lacks: ["add_node", "add_effect"] },
  };
  for (const [kind, want] of Object.entries(expect)) {
    const { dir } = await folder(kind as ProjectKind);
    const s = new Server(dir);
    try {
      await s.rpc("initialize", {});
      const names = await s.names();
      ok(`${kind}: offered ${want.has.join(", ")}`, want.has.every((n) => names.includes(n)), names.join());
      ok(`${kind}: not offered ${want.lacks.join(", ")}`, want.lacks.every((n) => !names.includes(n)), names.join());
      ok(`${kind}: tool names are unique`, new Set(names).size === names.length);
    } finally { s.close(); }
  }
}

// ---- A nameplate: draw, generate effects, move, animate -----------------------------------------------------------------------
{
  const { dir, project, docFile } = await folder("nameplate");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    const before = readFileSync(docFile, "utf8");

    const empty = await s.tool("describe_design");
    ok("describe: says what it is", empty.text.includes("nameplate") && empty.text.includes("960 × 176") && empty.text.includes("(none)"), empty.text);

    // A shape on the canvas appears on the timeline too.
    const rect = await s.tool("add_node", { type: "rect", x: 40, y: 30, w: 200, h: 60, fill: "#ff3366", radius: 12, name: "Badge" });
    ok("add_node: reports the new layer", !rect.isError && /layer (\w+)/.test(rect.text), rect.text);
    const nodeId = idIn(rect.text, /layer (\w+)/);
    let loaded = load(dir, project);
    ok("add_node: Studio reads it back, with its settings", loaded.doc!.nodes[nodeId]?.type === "shape" && (loaded.doc!.nodes[nodeId] as any).fill === "#ff3366" && loaded.doc!.nodes[nodeId].x === 40);
    ok("add_node: it is on the timeline as a layer clip", allClips(loaded.motion!.clips).some((c) => c.source.type === "layer" && (c.source as any).nodeId === nodeId));

    // Move it.
    const mv = await s.tool("set_node", { nodeId, patch: { x: 500, y: 60, rotation: 15, opacity: 0.8 } });
    ok("set_node: moves and turns it", !mv.isError, mv.text);
    loaded = load(dir, project);
    const moved = loaded.doc!.nodes[nodeId];
    ok("set_node: new position is on disk", moved.x === 500 && moved.y === 60 && moved.rotation === 15 && moved.opacity === 0.8);
    const layer = allClips(loaded.motion!.clips).find((c) => c.source.type === "layer")!;
    ok("set_node: the timeline's layer clip followed it", (layer.source as any).ox !== 0 || (layer.source as any).oy !== 0);

    // A gradient and a glow-free text.
    const grad = await s.tool("add_node", { type: "text", text: "Hello", color: "#ffffff", fontSize: 40, x: 300, y: 50, fillGradient: undefined });
    ok("add_node: text", !grad.isError && grad.text.includes("Added text"), grad.text);
    const star = await s.tool("add_node", { type: "star", points: 6, inner: 0.4, fill: "#ffd166", w: 60, h: 60, x: 800, y: 20, fillGradient: { type: "linear", angle: 45, stops: [{ offset: 0, color: "#ffd166" }, { offset: 1, color: "#ef476f" }] } });
    ok("add_node: a star with a gradient", !star.isError, star.text);
    ok("add_node: the gradient was kept", JSON.stringify(load(dir, project).doc!.nodes[idIn(star.text, /layer (\w+)/)]).includes("ef476f"));

    // Generate an effect.
    const fx = await s.tool("add_effect", { preset: "sparkles", colors: ["#ff99cc", "#99ccff"], amount: 0.5, blend: "add" });
    ok("add_effect: adds a clip", !fx.isError && /clip (\S+)/.test(fx.text), fx.text);
    const fxId = idIn(fx.text, /as clip (\S+?)[:\s]/);
    loaded = load(dir, project);
    const fxClip = allClips(loaded.motion!.clips).find((c) => c.id === fxId)!;
    ok("add_effect: particles, with the colours asked for", fxClip?.source.type === "particles" && JSON.stringify((fxClip.source as any).colors) === JSON.stringify(["#ff99cc", "#99ccff"]), JSON.stringify(fxClip));
    ok("add_effect: it really emits particles", fxClip.source.type === "particles" && particlesAt(fxClip.source, 1).length > 5);
    ok("add_effect: on top of what was there", fxClip.track >= Math.max(...loaded.motion!.clips.filter((c) => c.id !== fxId).map((c) => c.track)));

    // Move and animate a clip.
    const across = await s.tool("move_clip", { clipId: fxId, from: { x: -300, y: 0 }, to: { x: 300, y: 0 }, over: 3 });
    ok("move_clip: moves across the screen", !across.isError, across.text);
    const s0 = await s.tool("sample_design", { t: 0 });
    const s3 = await s.tool("sample_design", { t: 3 });
    const xAt = (txt: string) => Number(new RegExp(`${fxId}[^\\n]*? at \\((-?[\\d.]+),`).exec(txt)?.[1]);
    ok("sample_design: it starts left and ends right", xAt(s0.text) === -300 && xAt(s3.text) === 300, `${s0.text}\n${s3.text}`);
    const mid = await s.tool("sample_design", { t: 1.5 });
    ok("sample_design: and is in between halfway", Math.abs(xAt(mid.text)) < 50, mid.text);

    const pulse = await s.tool("animate", { clipId: fxId, property: "opacity", keys: [{ t: 0, v: 0.2 }, { t: 1.5, v: 1, e: "out" }, { t: 3, v: 0.2 }] });
    ok("animate: keyframes opacity", !pulse.isError, pulse.text);
    const t15 = await s.tool("sample_design", { t: 1.5 });
    ok("animate: peak opacity at 1.5s", new RegExp(`${fxId}[^\\n]*opacity 1\\b`).test(t15.text), t15.text);
    loaded = load(dir, project);
    const live = sampleClips(loaded.motion!.clips, 1.5, loaded.motion!.stage).find((r) => r.clip.id === fxId)!;
    ok("animate: Studio's own sampler agrees with what the tool reported", Math.abs(live.opacity - 1) < 0.01);

    ok("set_transition: fade in", !(await s.tool("set_transition", { clipId: fxId, which: "in", kind: "fade", duration: 0.4 })).isError);
    ok("add_clip_fx: glow", !(await s.tool("add_clip_fx", { clipId: fxId, effect: "glow" })).isError);
    ok("set_clip: renames and re-times", !(await s.tool("set_clip", { clipId: fxId, patch: { name: "Pink sparkles", start: 0.5, duration: 3 } })).isError);
    loaded = load(dir, project);
    const edited = allClips(loaded.motion!.clips).find((c) => c.id === fxId)!;
    ok("the edits are all on disk", edited.name === "Pink sparkles" && edited.start === 0.5 && edited.transitionIn?.type === "fade" && edited.fx[0]?.type === "glow");

    // A title, a raw clip, a timeline setting.
    ok("add_title", !(await s.tool("add_title", { text: "LIVE", preset: "pop", y: -20 })).isError);
    const raw = await s.tool("add_clip", { source: { type: "shape", shape: "ring", w: 120, h: 120, fill: "#ffffff00", stroke: "#66ffee", strokeWidth: 6 }, duration: 2, name: "Ring" });
    ok("add_clip: a hand-made ring", !raw.isError, raw.text);
    ok("set_timeline", !(await s.tool("set_timeline", { duration: 5, loopMode: "once", rest: 1 })).isError && load(dir, project).motion!.duration === 5);

    // Removing a canvas layer's clip hides the layer so it doesn't come straight back.
    const layerClip = allClips(load(dir, project).motion!.clips).find((c) => c.source.type === "layer" && (c.source as any).nodeId === nodeId)!;
    const rm = await s.tool("remove_clip", { clipId: layerClip.id });
    ok("remove_clip: says it hid the layer", rm.text.includes("hidden"), rm.text);
    loaded = load(dir, project);
    ok("remove_clip: the clip stays gone", !allClips(loaded.motion!.clips).some((c) => c.id === layerClip.id) && loaded.doc!.nodes[nodeId].hidden === true);
    ok("remove_node: deletes the layer and its clip", !(await s.tool("remove_node", { nodeId })).isError && !load(dir, project).doc!.nodes[nodeId]);

    // Undo steps back through the changes.
    const afterAll = readFileSync(docFile, "utf8");
    const undo = await s.tool("undo_last_change");
    ok("undo: restores the previous file", !undo.isError && readFileSync(docFile, "utf8") !== afterAll, undo.text);
    ok("undo: the layer is back", !!load(dir, project).doc!.nodes[nodeId]);
    for (let i = 0; i < 40; i++) { const u = await s.tool("undo_last_change"); if (u.isError) break; }
    eq("undo all the way: the file is exactly how it began", readFileSync(docFile, "utf8"), before);
    ok("undo with nothing left says so", (await s.tool("undo_last_change")).isError);
  } finally { s.close(); }
}

// ---- Everything the tools write is valid by the store's own rules ------------------------------------------------------------------
{
  const { dir, project } = await folder("effect");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    const list = (await s.tool("list_presets")).text;
    const presets = [...list.matchAll(/(\w+) \(/g)].map((m) => m[1]);
    ok("list_presets names the generators", list.includes("sparkles") && list.includes("snow") && list.includes("Limits:"), list);
    let added = 0;
    for (const id of ["sparkles", "hearts", "snow", "embers", "confetti", "bubbles", "fireflies", "stars", "shimmer", "rays", "aurora", "smoke"]) {
      const r = await s.tool("add_effect", { preset: id });
      if (!r.isError) added++;
      else console.log("  add_effect failed:", id, r.text.slice(0, 120));
    }
    eq("every generator can be added", added, 12);
    void presets;
    const loaded = load(dir, project);
    ok("all of them survive a save and a reload", allClips(loaded.motion!.clips).length === 12);
    ok("every one is something Studio will draw at some moment", loaded.motion!.clips.every((c) => [0.2, 1, 2, 3.5].some((t) => sampleClips([c], t, loaded.motion!.stage).length > 0)));
  } finally { s.close(); }
}

// ---- The effect library, through the tools ---------------------------------------------------------------------------------------------------
{
  const { EFFECT_LIBRARY } = await import("../../convex/lib/effectLibrary");
  for (const kind of ["effect", "nameplate"] as const) {
    const { dir, project } = await folder(kind);
    const s = new Server(dir);
    try {
      await s.rpc("initialize", {});
      const list = (await s.tool("list_presets")).text;
      ok(`${kind}: list_presets names the library effects`, ["snowfall", "aurora", "lightning", "neon-frame", "cherry-blossoms"].every((id) => list.includes(id)), list.slice(0, 300));
      let added = 0;
      const failures: string[] = [];
      for (const def of EFFECT_LIBRARY) {
        // A fresh design for each, so the clip limit isn't what is being tested.
        const r = await s.tool("add_effect", { preset: def.id });
        if (r.isError) failures.push(`${def.id}: ${r.text.slice(0, 100)}`);
        else added++;
        await s.tool("undo_last_change");
      }
      eq(`${kind}: every library effect can be added (and undone)`, [added, failures], [EFFECT_LIBRARY.length, []]);
      ok(`${kind}: undo left the design empty again`, allClips(load(dir, project).motion!.clips).length === 0);
    } finally { s.close(); }
  }
  const { dir, project } = await folder("effect");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    const r = await s.tool("add_effect", { preset: "energy-pulse", colors: ["#ff0066", "#00ffcc"], amount: 1.5, x: 40, y: -30, scale: 0.8, blend: "screen", duration: 3, start: 0.5 });
    const said = /Energy pulse \((\d+) clips/.exec(r.text);
    ok("a library effect takes colours, offset, scale and blend", !r.isError && !!said, r.text);
    const clips = allClips(load(dir, project).motion!.clips);
    eq("it is a stack of layers, one lane each, bottom first", clips.map((c) => c.track), clips.map((_, i) => i));
    ok("with many layers, not a single emitter", clips.length >= 5 && clips.length === Number(said?.[1]), clips.length);
    const rings = clips.filter((c) => c.name.startsWith("Pulse"));
    const intro = clips.filter((c) => c.loop === false);
    const loops = clips.filter((c) => c.loop !== false);
    ok("its rings are in the colours asked for", rings.map((c) => (c.source as any).stroke).join() === "#ff0066,#00ffcc", rings.map((c) => (c.source as any).stroke));
    ok("the loop layers start and last as asked", loops.every((c) => c.start <= 0.5 + 1e-6 + 1.0 && Math.abs(c.start + c.duration - 3.5) < 0.01), loops.map((c) => [c.start, c.duration]));
    ok("and the layers that play once do so at the start of it", intro.length > 0 && intro.every((c) => c.start >= 0.5 - 1e-6 && c.start + c.duration <= 0.5 + 1 + 1e-6), intro.map((c) => [c.start, c.duration]));
    ok("with the blend asked for", clips.every((c) => c.blend === "screen"));
    ok("offset by x and y", rings.every((c) => c.transform.x === 40 && c.transform.y === -30));
    ok("and scaled (the keyframed scale was multiplied, not replaced)", rings.every((c) => typeof c.transform.scaleX === "object" && c.transform.scaleX.k.every((k) => k.v <= 2.8 * 0.8 + 0.01)));
    ok("every other layer is moved too, keyed or not", clips.every((c) => (typeof c.transform.x === "number" ? c.transform.x : c.transform.x.k[0].v) !== undefined));
    const before = clips.length;
    const dup = await s.tool("add_effect", { preset: "energy-pulse" });
    ok("adding it again works (ids stay unique)", !dup.isError && new Set(allClips(load(dir, project).motion!.clips).map((c) => c.id)).size === before * 2, dup.text);
    ok("an unknown effect lists the library in the error", (await s.tool("add_effect", { preset: "nope" })).text.includes("aurora"));
    ok("a nameplate-only check: effects for both kinds work on an effect", !(await s.tool("add_effect", { preset: "neon-frame" })).isError);
    // Particles keep running under the tool's own duration.
    const sn = await s.tool("add_effect", { preset: "snowfall", duration: 6 });
    ok("a longer duration is honoured, within the timeline", !sn.isError, sn.text);
  } finally { s.close(); }
}

// ---- The tools refuse what the store would, and say why ---------------------------------------------------------------------------------
{
  const { dir, project, docFile } = await folder("nameplate");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    const clean = readFileSync(docFile, "utf8");
    const bad = async (n: string, name: string, args: unknown, mention: string) => {
      const r = await s.tool(name, args);
      ok(`${n}: refused`, r.isError, r.text);
      ok(`${n}: says why`, r.text.toLowerCase().includes(mention.toLowerCase()), r.text);
      ok(`${n}: and the file is untouched`, readFileSync(docFile, "utf8") === clean);
    };
    await bad("a colour that isn't one", "add_node", { type: "rect", fill: "red" }, "hex colour");
    await bad("javascript in a colour", "add_node", { type: "rect", fill: "url(javascript:1)" }, "hex colour");
    await bad("an unknown generator", "add_effect", { preset: "nope" }, "no generator");
    await bad("an unknown clip", "animate", { clipId: "ghost", property: "x", keys: [{ t: 0, v: 1 }] }, "no clip");
    await bad("an unknown property", "animate", { clipId: "x", property: "colour", keys: [{ t: 0, v: 1 }] }, "must be one of");
    await bad("a picture that isn't the project's", "add_node", { type: "image", assetId: "../../etc/passwd" }, "isn't one of this project's files");
    await bad("a picture clip from outside", "add_clip", { source: { type: "image", assetId: "nope" } }, "isn't one of this project's files");
    await bad("a layer clip by hand", "add_clip", { source: { type: "layer", nodeId: "x" } }, "automatically");
    await bad("a missing layer", "set_node", { nodeId: "ghost", patch: { x: 1 } }, "no layer");
    await bad("a field a rect doesn't have", "set_node", { nodeId: "x", patch: {} }, "no layer");
    await bad("a clip source whose type is wrong", "add_clip", { source: { type: "teleporter" } }, "isn't something a motion clip can be");
    await bad("a bad blend mode", "add_effect", { preset: "snow", blend: "sparkle" }, "must be one of");
    await bad("a bad transition", "set_transition", { clipId: "x", which: "in", kind: "warp" }, "no transition");

    // Out-of-range values are clamped, and the agent is told.
    const e = await s.tool("add_effect", { preset: "snow" });
    const id = idIn(e.text, /as clip (\S+?)[:\s]/);
    const t = await s.tool("add_clip", { source: { type: "particles", count: 99999, size: 5000, life: 1 }, duration: 1, name: "Too much" });
    ok("clamping: accepted", !t.isError, t.text);
    ok("clamping: the agent is told what changed", /rules changed/i.test(t.text) && t.text.includes("count"), t.text);
    const c = allClips(load(dir, project).motion!.clips).find((x) => x.name === "Too much")!;
    ok("clamping: the value on disk is the legal one", (c.source as any).count <= 400 && (c.source as any).size <= 200);
    void id;

    // The clip limit.
    for (let i = 0; i < 100; i++) { const r = await s.tool("add_clip", { source: { type: "solid", w: 10, h: 10, color: "#fff" }, duration: 1 }); if (r.isError) { ok("the 96-clip limit is reported", r.text.includes("96"), r.text); break; } }
    ok("the design on disk is within the limit", allClips(load(dir, project).motion!.clips).length <= 96);
  } finally { s.close(); }
}

// ---- Damaged files and hostile paths -------------------------------------------------------------------------------------------------
{
  const { dir, docFile } = await folder("nameplate");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    writeFileSync(docFile, "{ not json");
    const r = await s.tool("describe_design");
    ok("unreadable design: says so, doesn't crash", r.isError && r.text.includes("isn't valid JSON"), r.text);
    ok("unreadable design: is left alone", readFileSync(docFile, "utf8") === "{ not json");
    ok("unreadable design: writes refused too", (await s.tool("add_node", { type: "rect" })).isError && readFileSync(docFile, "utf8") === "{ not json");
  } finally { s.close(); }
  const evil = await folder("nameplate");
  const proj = join(evil.dir, "My Thing.crysproj");
  writeFileSync(proj, readFileSync(proj, "utf8").replace(/^document = .*$/m, 'document = "../../outside.json"'));
  writeFileSync(join(evil.dir, "../outside.json"), JSON.stringify({ format: 1, kind: "nameplate", doc: {} }));
  const s2 = new Server(evil.dir);
  try {
    await s2.rpc("initialize", {});
    const r = await s2.tool("add_node", { type: "rect" });
    ok("a project file pointing outside the folder is refused", r.isError && r.text.includes("unexpected place"), r.text);
    ok("and the outside file was not written", readFileSync(join(evil.dir, "../outside.json"), "utf8").includes('"doc":{}'));
  } finally { s2.close(); rmSync(join(evil.dir, "../outside.json"), { force: true }); }
}

// ---- Scenes -----------------------------------------------------------------------------------------------------------------------------------
{
  const { dir, project } = await folder("scene");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    ok("a screen", !(await s.tool("add_scene_object", { type: "screen" })).isError);
    ok("a second screen is refused", (await s.tool("add_scene_object", { type: "screen" })).isError);
    ok("a floor", !(await s.tool("add_scene_object", { type: "floor", y: 520 })).isError);
    for (let i = 0; i < 3; i++) ok(`seat ${i + 1}`, !(await s.tool("add_scene_object", { type: "seat", x: 400 + i * 200, y: 700 })).isError);
    ok("a candle prop", !(await s.tool("add_scene_object", { type: "prop", prop: "candle", x: 100, y: 600 })).isError);
    ok("an unknown prop is refused", (await s.tool("add_scene_object", { type: "prop", prop: "dragon" })).isError);
    ok("room dimming", !(await s.tool("set_scene_dim", { dimOnShare: true, amount: 0.7 })).isError);
    const loaded = load(dir, project);
    const types = Object.values(loaded.doc!.nodes).map((n) => n.type).sort();
    eq("the room is what was asked for", types, ["floor", "prop", "screen", "seat", "seat", "seat"]);
    eq("dimming is saved", loaded.doc!.scene, { dimOnShare: true, amount: 0.7 });
    ok("add_effect isn't a scene tool", (await s.rpc("tools/call", { name: "add_effect", arguments: { preset: "snow" } })).error?.code === -32602);
    let refused = false;
    for (let i = 0; i < 30; i++) if ((await s.tool("add_scene_object", { type: "seat" })).isError) { refused = true; break; }
    ok("the seat limit is enforced", refused);
  } finally { s.close(); }
}

// ---- Decorations and stickers: canvas only ---------------------------------------------------------------------------------------------------
{
  const { dir, project } = await folder("decoration");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    const a = await s.tool("add_node", { type: "ellipse", x: 20, y: 20, w: 360, h: 360, fill: "#00000000", stroke: "#ffcc00", strokeWidth: 14 });
    ok("a ring around the avatar", !a.isError, a.text);
    ok("no timeline mentioned on a still design", !a.text.includes("timeline"));
    ok("it is saved", Object.keys(load(dir, project).doc!.nodes).length === 1 && !load(dir, project).motion);
    ok("a still design has no clips to describe", !(await s.tool("describe_design")).text.includes("Clips"));
    ok("hidden/locked can be set", !(await s.tool("set_node", { nodeId: idIn(a.text, /layer (\w+)/), patch: { hidden: true, locked: true, name: "Ring" } })).isError);
  } finally { s.close(); }
}

// ---- Theme packs ---------------------------------------------------------------------------------------------------------------------------------
{
  const { dir, project } = await folder("themePack");
  const s = new Server(dir);
  try {
    await s.rpc("initialize", {});
    ok("set the main look's colours", !(await s.tool("set_theme_colors", { colors: { background: "#101014", foreground: "#fafafa", primary: "oklch(0.7 0.2 290)" }, isDark: true })).isError);
    let loaded = load(dir, project);
    eq("they are saved", loaded.themePack!.theme!.colors, { background: "#101014", foreground: "#fafafa", primary: "oklch(0.7 0.2 290)" });
    const alt = await s.tool("set_theme_colors", { scheme: "alt", colors: { background: "#ffffff", foreground: "#111111" } });
    ok("a second look is created", !alt.isError, alt.text);
    eq("and is kept apart from the first", [load(dir, project).themePack!.theme!.alt!.colors.background, load(dir, project).themePack!.theme!.colors.background], ["#ffffff", "#101014"]);
    ok("merging keeps earlier colours", !(await s.tool("set_theme_colors", { colors: { card: "#1a1a20" } })).isError && load(dir, project).themePack!.theme!.colors.primary === "oklch(0.7 0.2 290)");
    ok("an empty value removes a colour", !(await s.tool("set_theme_colors", { colors: { card: "" } })).isError && !("card" in load(dir, project).themePack!.theme!.colors));
    ok("a token that doesn't exist is refused", (await s.tool("set_theme_colors", { colors: { nope: "#fff" } })).text.includes("isn't a colour a theme can set"));
    ok("a colour with CSS in it is refused", (await s.tool("set_theme_colors", { colors: { background: "red; } body { display:none" } })).isError);
    ok("a colour with url() is refused", (await s.tool("set_theme_colors", { colors: { background: "url(https://x.test/a.png)" } })).isError);
    ok("the main scheme can't flip under a second look", (await s.tool("set_theme_colors", { colors: { card: "#111" }, isDark: false })).isError);
    const desc = (await s.tool("describe_theme")).text;
    ok("describe_theme shows both looks", desc.includes("Main look: dark") && desc.includes("Second look (light)"), desc);
    ok("removing the second look", !(await s.tool("remove_theme_variant")).isError && !load(dir, project).themePack!.theme!.alt);
    ok("removing it again says there is none", (await s.tool("remove_theme_variant")).text.includes("no second look"));
    ok("replace swaps a whole look", !(await s.tool("set_theme_colors", { colors: { background: "#222222" }, replace: true })).isError && Object.keys(load(dir, project).themePack!.theme!.colors).length === 1);
    ok("undo works for a theme", !(await s.tool("undo_last_change")).isError);
  } finally { s.close(); }
}

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
