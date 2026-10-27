import { readFileSync } from "node:fs";
import { join } from "node:path";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const C = await import("../../src/studio/motion/effect-library-client");
const { EFFECT_LIBRARY, LIBRARY_FOLDER, LIBRARY_VERSION, catalogOf, publishedEffect } = await import("../../convex/lib/effectLibrary");
const { MOTION_LIMITS } = await import("../../convex/lib/motion");

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d)?.slice(0, 300))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });
const rejects = async (fn: () => Promise<unknown>, mention: string) => { try { await fn(); return false; } catch (e) { return e instanceof C.LibraryError && e.message.toLowerCase().includes(mention.toLowerCase()); } };

// The files exactly as the publish step writes them.
const root = join(import.meta.dir, "../../public", LIBRARY_FOLDER);
const BASE = "https://cdn.test/" + LIBRARY_FOLDER;
const served = (over: Record<string, string | number> = {}): typeof fetch => (async (input: any) => {
  const url = String(input);
  const name = url.slice(BASE.length + 1);
  if (name in over) { const v = over[name]; return typeof v === "number" ? new Response("", { status: v }) : new Response(v, { status: 200 }); }
  try { return new Response(readFileSync(join(root, name), "utf8"), { status: 200 }); } catch { return new Response("", { status: 404 }); }
}) as typeof fetch;

ok("the base is built from the CDN address", C.libraryBase("https://cdn.test/") === BASE && C.libraryBase("https://cdn.test") === BASE && C.libraryBase("") === null && C.libraryBase(undefined) === null);

// ---- Every published file is something Studio can add ---------------------------------------------------------------------
const cat = await C.fetchCatalog(BASE, served());
eq("the catalogue has every effect", cat.effects.length, EFFECT_LIBRARY.length);
let added = 0;
for (const e of cat.effects) for (const kind of e.kinds) {
  const r = await C.fetchEffectClips(BASE, e.id, kind, MOTION_LIMITS.clips, served()).catch((err) => err);
  if (r instanceof Error) { ok(`${e.id} on a ${kind}: adds`, false, r.message); continue; }
  added++;
  if (r.clips.length === 0 || r.name !== e.name) ok(`${e.id} on a ${kind}: whole`, false, r.name);
}
ok("every effect adds on every kind it fits", added >= EFFECT_LIBRARY.length * 2 - 2, added);
{
  const a = await C.fetchEffectClips(BASE, "snowfall", "effect", 90, served());
  const b = await C.fetchEffectClips(BASE, "snowfall", "effect", 90, served());
  ok("each add gets fresh ids, so the same effect can go on twice", a.clips[0].id !== b.clips[0].id && a.clips[0].id !== "snowfall-effect-1");
  ok("and carries its length", a.duration === 6);
  ok("and the intro that plays before it loops", a.intro >= 1 && a.intro <= a.duration / 3, a.intro);
  const old = await C.fetchEffectClips(BASE, "snowfall", "effect", 90, served({ "snowfall.json": JSON.stringify({ ...publishedEffect(EFFECT_LIBRARY.find((e) => e.id === "snowfall")!), intro: undefined }) }));
  ok("an effect from before intros existed has none", old.intro === 0);
  const wild = await C.fetchEffectClips(BASE, "snowfall", "effect", 90, served({ "snowfall.json": JSON.stringify({ ...publishedEffect(EFFECT_LIBRARY.find((e) => e.id === "snowfall")!), intro: 999 }) }));
  ok("a wild intro is held to a third of the design", wild.intro <= wild.duration / 3 + 1e-9, wild.intro);
  const neg = await C.fetchEffectClips(BASE, "snowfall", "effect", 90, served({ "snowfall.json": JSON.stringify({ ...publishedEffect(EFFECT_LIBRARY.find((e) => e.id === "snowfall")!), intro: -5 }) }));
  ok("and a negative one is none", neg.intro === 0);
}

// ---- Hostile or broken responses -----------------------------------------------------------------------------------------------
const good = publishedEffect(EFFECT_LIBRARY.find((e) => e.id === "snowfall")!);
const one = (over: unknown) => served({ "snowfall.json": JSON.stringify(over) });
ok("a 404 says it isn't published", await rejects(() => C.fetchCatalog(BASE, served({ "index.json": 404 })), "hasn't been published"));
ok("a server error says so", await rejects(() => C.fetchCatalog(BASE, served({ "index.json": 500 })), "500"));
ok("no network says so", await rejects(() => C.fetchCatalog(BASE, (async () => { throw new TypeError("offline"); }) as typeof fetch), "reach the library"));
ok("not JSON is refused", await rejects(() => C.fetchCatalog(BASE, served({ "index.json": "<html>" })), "readable"));
ok("an oversized file is refused", await rejects(() => C.fetchCatalog(BASE, served({ "index.json": "x".repeat(200_000) })), "larger"));
ok("a catalogue from another version is refused", await rejects(() => C.fetchCatalog(BASE, served({ "index.json": JSON.stringify({ version: 99, effects: [] }) })), "different version"));
ok("a catalogue that isn't one is refused", await rejects(() => C.fetchCatalog(BASE, served({ "index.json": JSON.stringify({ version: LIBRARY_VERSION }) })), "damaged"));
{
  const messy = C.parseCatalog({ version: LIBRARY_VERSION, effects: [
    { id: "ok-one", name: "Fine", group: "G", description: "d", kinds: ["effect"], colors: ["#ffffff", "javascript:1", 5], clips: 2 },
    { id: "../escape", name: "Bad id", kinds: ["effect"] },
    { id: "no-kinds", name: "None", kinds: ["video"] },
    { id: "no-name", kinds: ["effect"] },
    "junk", null,
  ] });
  eq("a messy catalogue keeps only what is sound", messy.effects.map((e) => e.id), ["ok-one"]);
  eq("and cleans the colours", messy.effects[0].colors, ["#ffffff"]);
  ok("long text is cut", C.parseCatalog({ version: LIBRARY_VERSION, effects: [{ id: "x", name: "n".repeat(500), kinds: ["effect"], description: "d".repeat(900) }] }).effects[0].name.length === 60);
}
ok("an id that tries to leave the folder is refused before any request", await rejects(() => C.fetchEffectClips(BASE, "../index", "effect", 90, (async () => { throw new Error("must not fetch"); }) as typeof fetch), "isn't an effect"));
ok("an effect whose file says it is another is refused", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, one({ ...good, id: "other" })), "damaged"));
ok("an effect with no variants is refused", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, one({ id: "snowfall", name: "x" })), "damaged"));
ok("an effect not made for this kind says so", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "nameplate", 90, one({ ...good, variants: { effect: good.variants.effect } })), "nameplate"));
ok("a picture address in an effect is refused", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, one({ ...good, variants: { effect: [{ ...good.variants.effect![0], source: { type: "image", url: "https://evil.test/x.png", w: 1, h: 1, ox: 0, oy: 0 } }] } })), "isn't valid"));
ok("a canvas-layer clip is refused", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, one({ ...good, variants: { effect: [{ ...good.variants.effect![0], source: { type: "layer", nodeId: "n1", w: 1, h: 1, ox: 0, oy: 0 } }] } })), "isn't valid"));
ok("a clip the validator would drop is refused, not half-added", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, one({ ...good, variants: { effect: [...good.variants.effect!, "junk"] } })), "can't use"));
ok("an effect that won't fit the room left is refused whole", await rejects(() => C.fetchEffectClips(BASE, "aurora", "effect", 1, served()), "room for 1"));
ok("and with no room at all", await rejects(() => C.fetchEffectClips(BASE, "aurora", "effect", 0, served()), "room for 0"));
{
  const r = await C.fetchEffectClips(BASE, "snowfall", "effect", 90, one({ ...good, duration: 9999, variants: { effect: good.variants.effect!.map((c) => (c.source.type === "particles" ? { ...c, source: { ...(c.source as object), count: 99999 } } : c)) } }));
  const emitters = r.clips.filter((c) => c.source.type === "particles");
  ok("out-of-range numbers are clamped to the legal range", emitters.length > 0 && emitters.every((c) => (c.source as { count: number }).count <= MOTION_LIMITS.particles) && r.duration <= MOTION_LIMITS.duration);
}

// ---- Downloads on the device ------------------------------------------------------------------------------------------------------
{
  const entry = cat.effects.find((e) => e.id === "aurora")!;
  eq("nothing is downloaded at first", [...C.downloadedIds()], []);
  await C.downloadEffect(BASE, entry, served());
  ok("a download is remembered", C.isDownloaded("aurora") && C.downloadedIds().has("aurora"));
  const offline = C.withDownloads((async () => { throw new TypeError("offline"); }) as typeof fetch);
  const r = await C.fetchEffectClips(BASE, "aurora", "effect", 90, offline);
  ok("a downloaded effect adds with no network", r.clips.length >= 1 && r.name === "Aurora");
  ok("one that wasn't downloaded still needs the network", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, offline), "reach the library"));
  ok("the catalogue is never served from the device", await rejects(() => C.fetchCatalog(BASE, offline), "reach the library"));
  C.removeDownload("aurora");
  ok("removing a download removes it", !C.isDownloaded("aurora") && await rejects(() => C.fetchEffectClips(BASE, "aurora", "effect", 90, offline), "reach the library"));
  ok("a damaged file is not kept", await rejects(() => C.downloadEffect(BASE, entry, served({ "aurora.json": JSON.stringify({ id: "x" }) })), "damaged") && !C.isDownloaded("aurora"));
  ok("a file with a picture in it is not kept", await rejects(() => C.downloadEffect(BASE, { ...entry, id: "snowfall", kinds: ["effect"] }, one({ ...good, variants: { effect: [{ ...good.variants.effect![0], source: { type: "image", url: "https://evil.test/x.png", w: 1, h: 1, ox: 0, oy: 0 } }] } })), "isn't valid") && !C.isDownloaded("snowfall"));
  ok("a failed request keeps nothing", await rejects(() => C.downloadEffect(BASE, entry, served({ "aurora.json": 500 })), "500") && !C.isDownloaded("aurora"));
  // Tampering with what is stored can't get past the same checks.
  localStorage.setItem("crystal-studio:effect:snowfall", JSON.stringify({ ...good, variants: { effect: [{ ...good.variants.effect![0], source: { type: "image", url: "https://evil.test/x.png", w: 1, h: 1, ox: 0, oy: 0 } }] } }));
  ok("a tampered download is refused when it is added", await rejects(() => C.fetchEffectClips(BASE, "snowfall", "effect", 90, offline), "isn't valid"));
  const quota = (localStorage as any).setItem;
  (localStorage as any).setItem = () => { throw new Error("quota"); };
  ok("a full device says so", await rejects(() => C.downloadEffect(BASE, entry, served()), "no room"));
  (localStorage as any).setItem = quota;
}

// ---- What is published matches what the app bundles ----------------------------------------------------------------------------
eq("the bundled copy is the library as built", JSON.parse(readFileSync(join(root, "index.json"), "utf8")), JSON.parse(JSON.stringify(catalogOf())));
ok("the bundled files are the published ones", EFFECT_LIBRARY.every((d) => readFileSync(join(root, `${d.id}.json`), "utf8") === JSON.stringify(publishedEffect(d))));

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
