import { SCENE_LIMITS, normalizeSceneSpec } from "../../convex/lib/creationSpecs";
import { checkScene, compileScene, sceneArtwork } from "../../src/studio/model/compile";
import { addNode, emptyDoc, makeImage, makeSceneObject, makeShape, makeText, patchNodes } from "../../src/studio/model/doc";
import { bakesToPicture } from "../../src/studio/model/fx";
import { toolForKey, TOOLS } from "../../src/studio/editor/tools";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const throws = (n: string, fn: () => unknown, re: RegExp) => { try { fn(); ok(n, false, "did not throw"); } catch (e) { ok(n, re.test((e as Error).message), (e as Error).message); } };
const https = (u: string) => u;

// --- the server's rules --------------------------------------------------------------------------
const base = { name: "Room", backgroundUrl: "https://cdn.example/bg.png", screen: { x: 30, y: 10, w: 40, h: 30 }, floorTop: 58 };
const art = (o: object = {}) => ({ url: "https://cdn.example/a.png", x: 10, y: 20, w: 30, h: 25, opacity: 1, ...o });
{
  const s = normalizeSceneSpec({ ...base, overlay: [art(), art({ url: "https://cdn.example/b.webp", opacity: 0.5 })] }, https);
  ok("a scene's artwork is kept, in order", s.overlay.length === 2 && s.overlay[1].url.endsWith("b.webp") && s.overlay[1].opacity === 0.5, s.overlay);
  ok("a scene made before artwork existed has none", normalizeSceneSpec(base, https).overlay.length === 0);
  ok("junk in the list becomes nothing, not a crash", (() => { try { return normalizeSceneSpec({ ...base, overlay: "x" }, https).overlay.length === 0; } catch { return false; } })());
  const c = normalizeSceneSpec({ ...base, overlay: [art({ x: 9999, y: -9999, w: 1e9, h: -5, opacity: 7 })] }, https).overlay[0];
  ok("numbers are clamped to something drawable", c.x === 150 && c.y === -50 && c.w === 200 && c.h === 0.1 && c.opacity === 1, c);
  ok("opacity can't be made invisible", normalizeSceneSpec({ ...base, overlay: [art({ opacity: 0 })] }, https).overlay[0].opacity === 0.02);
  ok("NaN and strings fall back", normalizeSceneSpec({ ...base, overlay: [art({ x: NaN, w: "wide" })] }, https).overlay[0].x === 0);
  throws("a clip or a page isn't artwork", () => normalizeSceneSpec({ ...base, overlay: [art({ url: "https://cdn.example/a.mp4" })] }, https), /PNG, WebP or GIF/);
  throws("html isn't artwork", () => normalizeSceneSpec({ ...base, overlay: [art({ url: "https://cdn.example/a.html" })] }, https), /PNG, WebP or GIF/);
  throws("an address the caller rejects stops the whole scene", () => normalizeSceneSpec({ ...base, overlay: [art()] }, () => { throw new Error("not on our CDN"); }), /not on our CDN/);
  ok("too many pieces are cut to the limit", normalizeSceneSpec({ ...base, overlay: Array.from({ length: 80 }, () => art()) }, https).overlay.length === SCENE_LIMITS.overlay);
}

// --- what Studio draws ------------------------------------------------------------------------------
const room = () => {
  let d = emptyDoc("scene");
  d = addNode(d, { ...makeImage("bg", "Room", 0, 0, d.artboard.w, d.artboard.h), role: "background" } as never);
  d = addNode(d, makeSceneObject("screen", d.artboard));
  d = addNode(d, makeSceneObject("floor", d.artboard));
  return d;
};
{
  let d = room();
  ok("a room with no artwork has an empty overlay", sceneArtwork(d).length === 0 && compileScene(d, "R", "u").overlay.length === 0);
  const rect = makeShape("rect", 100, 100, 200, 120);
  d = addNode(d, rect);
  ok("a shape drawn above the background is artwork", sceneArtwork(d).map((n) => n.id).join() === rect.id);
  ok("…and in a scene it is always baked to a picture, even with no effects", bakesToPicture(d, rect));
  ok("…but in a decoration the same plain shape is still sent as a shape", !bakesToPicture({ kind: "decoration" }, rect));
  ok("the background itself is not artwork", !sceneArtwork(d).some((n) => n.type === "image" && (n as { role?: string }).role === "background"));
  ok("seats, the screen and the floor are not artwork", sceneArtwork(d).every((n) => n.type === "shape"));
  const spec = compileScene(d, "R", "u", (id) => (id === rect.id ? "https://cdn.example/r.png" : undefined));
  const o = spec.overlay[0];
  const AW = d.artboard.w, AH = d.artboard.h;
  ok("its place is in percent of the room", Math.abs(o.x - (100 / AW) * 100) < 0.1 && Math.abs(o.y - (100 / AH) * 100) < 0.1 && Math.abs(o.w - (200 / AW) * 100) < 0.5 && Math.abs(o.h - (120 / AH) * 100) < 0.5, o);
  ok("the compiled spec passes the server's own rules", (() => { try { normalizeSceneSpec(spec, https); return true; } catch (e) { return String(e); } })());
  ok("artwork with no uploaded picture yet is left out of what is sent", compileScene(d, "R", "u", () => undefined).overlay.length === 0);
  ok("…but while only checking (no uploader given) it is still counted", compileScene(d, "R", "u").overlay.length === 1);
  d = patchNodes(d, [rect.id], { hidden: true } as never);
  ok("hidden artwork isn't sent", sceneArtwork(d).length === 0);
}
{
  // Order and the background: only what is *above* the background is visible in the room.
  let d = emptyDoc("scene");
  const under = makeShape("rect", 10, 10, 50, 50);
  d = addNode(d, under);
  d = addNode(d, { ...makeImage("bg", "Room", 0, 0, d.artboard.w, d.artboard.h), role: "background" } as never);
  const over = makeText(50, 50);
  d = addNode(d, over);
  ok("only artwork above the background counts; what's under it is covered", sceneArtwork(d).map((n) => n.id).join() === over.id, sceneArtwork(d).map((n) => n.name));
  const stroked = { ...makeShape("rect", 100, 100, 100, 100), stroke: "#fff", strokeWidth: 20 } as never;
  d = addNode(d, stroked);
  const box = compileScene(d, "R", "u").overlay.at(-1)!;
  ok("a stroked shape's picture has room for the outline (not clipped)", box.w > (100 / d.artboard.w) * 100, box);
}
{
  let d = room();
  for (let i = 0; i < SCENE_LIMITS.overlay + 1; i++) d = addNode(d, makeShape("rect", i, i, 20, 20));
  ok("too much artwork is a problem while editing, not a surprise at submission", checkScene(d, () => true).some((x) => x.severity === "error" && /At most 40 pieces of artwork/.test(x.message)));
  const far = addNode(room(), makeShape("rect", 99999, 99999, 20, 20));
  ok("artwork nowhere near the room is warned about", checkScene(far, () => true).some((x) => /outside the room/.test(x.message)));
}

// --- the tools ----------------------------------------------------------------------------------------
{
  for (const id of ["pen", "line", "polygon", "star", "rect", "ellipse", "text"] as const) {
    const t = TOOLS.find((x) => x.id === id)!;
    for (const kind of ["decoration", "sticker", "scene"] as const) ok(`${t.label} is available for a ${kind}`, !t.kinds || t.kinds.includes(kind), t.kinds);
  }
  ok("the scene-only tools stay scene-only", ["screen", "seat", "floor"].every((id) => TOOLS.find((t) => t.id === id)!.kinds?.join() === "scene"));
  ok("P picks the Pen in a scene, as it does elsewhere", toolForKey("p", "scene") === "pen" && toolForKey("p", "decoration") === "pen");
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
