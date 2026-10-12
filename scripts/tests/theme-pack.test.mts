import { normalizeThemePackSpec, pickThemeVariant } from "../../convex/lib/creationSpecs";
import { checkThemePack, themePackSpecInput } from "../../src/studio/model/theme-pack";
import { decodeDocument, decodeProjectFile, encodeProject } from "../../src/studio/storage/format";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
const same = (u: string) => u;

const DARK = { background: "#101014", foreground: "#fafafa", primary: "oklch(0.7 0.2 290)" };
const LIGHT = { background: "#ffffff", foreground: "#111111", primary: "oklch(0.5 0.2 290)" };

// ---- A pack made before variants existed reads exactly as it did ------------------------------------------------------
const old = normalizeThemePackSpec({ name: "Old pack", theme: { isDark: true, colors: DARK } }, same);
eq("an old pack has no variant", old.theme, { isDark: true, colors: DARK });
ok("an old pack has no `alt` key at all", old.theme !== undefined && !("alt" in old.theme));

// ---- A pack with both palettes ------------------------------------------------------------------------------------------
const both = normalizeThemePackSpec({ name: "Both", theme: { isDark: true, colors: DARK, alt: { colors: LIGHT } } }, same);
eq("the other palette is kept", both.theme?.alt, { colors: LIGHT });
eq("the main palette is untouched", both.theme?.colors, DARK);
eq("a light-first pack keeps its order", normalizeThemePackSpec({ name: "LF", theme: { isDark: false, colors: LIGHT, alt: { colors: DARK } } }, same).theme, { isDark: false, colors: LIGHT, alt: { colors: DARK } });
eq("an empty second palette is no variant, not an error", normalizeThemePackSpec({ name: "Empty", theme: { isDark: true, colors: DARK, alt: { colors: {} } } }, same).theme?.alt, undefined);
eq("a missing colours object is no variant either", normalizeThemePackSpec({ name: "None", theme: { isDark: true, colors: DARK, alt: {} } }, same).theme?.alt, undefined);
eq("a null alt is no variant", normalizeThemePackSpec({ name: "Null", theme: { isDark: true, colors: DARK, alt: null } }, same).theme?.alt, undefined);
eq("values are trimmed in the second palette too", normalizeThemePackSpec({ name: "Trim", theme: { isDark: true, colors: DARK, alt: { colors: { background: "  #fff  " } } } }, same).theme?.alt, { colors: { background: "#fff" } });

// The second palette is held to the same rules as the first: it ends up in a stylesheet.
ok("an unknown token in the second palette is refused", throws(() => normalizeThemePackSpec({ name: "Bad", theme: { isDark: true, colors: DARK, alt: { colors: { nope: "#fff" } } } }, same)));
ok("a url() in the second palette is refused", throws(() => normalizeThemePackSpec({ name: "Bad", theme: { isDark: true, colors: DARK, alt: { colors: { background: "url(https://x.test/a.png)" } } } }, same)));
ok("a declaration can't be ended early in the second palette", throws(() => normalizeThemePackSpec({ name: "Bad", theme: { isDark: true, colors: DARK, alt: { colors: { background: "#fff;} body{display:none" } } } }, same)));
ok("a non-string colour in the second palette is refused", throws(() => normalizeThemePackSpec({ name: "Bad", theme: { isDark: true, colors: DARK, alt: { colors: { background: 5 } } } }, same)));
ok("the first palette is still checked", throws(() => normalizeThemePackSpec({ name: "Bad", theme: { isDark: true, colors: { background: "red; x:y" }, alt: { colors: LIGHT } } }, same)));
ok("a pack can't be only a second palette", throws(() => normalizeThemePackSpec({ name: "Alt only", theme: { isDark: true, colors: {}, alt: { colors: LIGHT } } }, same)));
ok("an unknown key beside colours is not carried", !("extra" in (normalizeThemePackSpec({ name: "Xx", theme: { isDark: true, colors: DARK, alt: { colors: LIGHT, extra: 1 } } }, same).theme?.alt ?? {})));

// ---- Which palette is worn ------------------------------------------------------------------------------------------------
const one = { isDark: true, colors: DARK };
eq("one palette, dark app: it forces its scheme", pickThemeVariant(one, true), { isDark: true, colors: DARK, forced: true });
eq("one palette, light app: still its own scheme", pickThemeVariant(one, false), { isDark: true, colors: DARK, forced: true });
const duo = { isDark: true, colors: DARK, alt: { colors: LIGHT } };
eq("two palettes, dark app: the dark one, scheme left to the app", pickThemeVariant(duo, true), { isDark: true, colors: DARK, forced: false });
eq("two palettes, light app: the light one", pickThemeVariant(duo, false), { isDark: false, colors: LIGHT, forced: false });
const duoLight = { isDark: false, colors: LIGHT, alt: { colors: DARK } };
eq("light-first, light app: its own palette", pickThemeVariant(duoLight, false), { isDark: false, colors: LIGHT, forced: false });
eq("light-first, dark app: the alternate", pickThemeVariant(duoLight, true), { isDark: true, colors: DARK, forced: false });
ok("the palette always matches the scheme it reports", [true, false].every((d) => [duo, duoLight].every((t) => pickThemeVariant(t, d).isDark === d)));

// ---- Studio: saved, read back, and sent ------------------------------------------------------------------------------------
// Saved to disk and read back, the way a project is: a creator's second palette has to survive a restart.
const roundTrip = (theme: unknown) => {
  const now = Date.now();
  const project = { id: "abcd1234", kind: "themePack" as const, name: "Pack", createdAt: now, updatedAt: now, listing: { name: "Pack", description: "", free: true, priceUsd: "0" }, themePack: { sounds: {}, icons: {}, theme } };
  const enc = encodeProject(project as never, "Pack", []);
  const base = decodeProjectFile(enc.proj).project;
  return decodeDocument(base, enc.doc!).themePack?.theme;
};
eq("both palettes survive a save and a reload", roundTrip({ isDark: true, colors: DARK, template: "dark", alt: { colors: LIGHT, template: "light" } }), { isDark: true, colors: DARK, template: "dark", alt: { colors: LIGHT, template: "light" } });
eq("a one-palette pack reloads with no second palette", roundTrip({ isDark: true, colors: DARK }), { isDark: true, colors: DARK });
eq("a second palette that is not an object is dropped", roundTrip({ isDark: true, colors: DARK, alt: "nope" }), { isDark: true, colors: DARK });
eq("junk inside the second palette is dropped, the rest kept", roundTrip({ isDark: true, colors: DARK, alt: { colors: { background: "#fff", bad: 5 } } }), { isDark: true, colors: DARK, alt: { colors: { background: "#fff" } } });
eq("a template note that isn't a theme id is dropped", roundTrip({ isDark: true, colors: DARK, alt: { colors: LIGHT, template: "../etc" } }), { isDark: true, colors: DARK, alt: { colors: LIGHT } });
const assets = new Map();
const urlOf = (id: string) => `https://cdn.test/${id}.woff2`;
const input = (theme: unknown) => themePackSpecInput({ sounds: {}, icons: {}, theme } as never, "Pack", assets, urlOf) as { theme?: { alt?: unknown } };
eq("both palettes are sent", input({ isDark: true, colors: DARK, alt: { colors: LIGHT } }).theme?.alt, { colors: LIGHT });
eq("an empty second palette is not sent", input({ isDark: true, colors: DARK, alt: { colors: {} } }).theme?.alt, undefined);
eq("Studio's template note is not sent with the second palette", input({ isDark: true, colors: DARK, alt: { colors: LIGHT, template: "dark" } }).theme?.alt, { colors: LIGHT });
ok("what Studio sends is accepted by the server's own validator", checkThemePack({ sounds: {}, icons: {}, theme: { isDark: true, colors: DARK, alt: { colors: LIGHT } } }, "Pack", assets).length === 0);
ok("and a bad second palette is reported before it is sent", checkThemePack({ sounds: {}, icons: {}, theme: { isDark: true, colors: DARK, alt: { colors: { background: "javascript:1" } } } }, "Pack", assets).length > 0);

// ---- Background -------------------------------------------------------------------------------------------------------------
const bgOnly = normalizeThemePackSpec({ name: "Bg only", background: { url: "https://cdn.test/a.webp", dim: 20, blur: 4, panels: 60 } }, same);
eq("a background alone makes a pack", bgOnly.background, { url: "https://cdn.test/a.webp", dim: 20, blur: 4, panels: 60 });
eq("an old pack has no background key", "background" in old, false);
eq("missing numbers take their defaults", normalizeThemePackSpec({ name: "Defaults", background: { url: "https://cdn.test/a.png" } }, same).background, { url: "https://cdn.test/a.png", dim: 35, blur: 0, panels: 70 });
eq("numbers are clamped", normalizeThemePackSpec({ name: "Clamp", background: { url: "https://cdn.test/a.jpg", dim: 500, blur: -3, panels: 1 } }, same).background, { url: "https://cdn.test/a.jpg", dim: 90, blur: 0, panels: 30 });
eq("junk numbers fall back to defaults", normalizeThemePackSpec({ name: "Junk", background: { url: "https://cdn.test/a.gif", dim: "lots", blur: NaN, panels: null } }, same).background, { url: "https://cdn.test/a.gif", dim: 35, blur: 0, panels: 70 });
ok("a clip can't be a background", throws(() => normalizeThemePackSpec({ name: "Clip", background: { url: "https://cdn.test/a.mp4" } }, same)));
ok("an SVG can't be a background", throws(() => normalizeThemePackSpec({ name: "Svg", background: { url: "https://cdn.test/a.svg" } }, same)));
ok("a background with no address is refused", throws(() => normalizeThemePackSpec({ name: "None", background: {} }, same)));
ok("the address is checked by the caller's rule", throws(() => normalizeThemePackSpec({ name: "Elsewhere", background: { url: "https://evil.test/a.png" } }, (u) => { if (!u.startsWith("https://cdn.test/")) throw new Error("no"); return u; })));
ok("an unknown key beside the background is not carried", !("extra" in (normalizeThemePackSpec({ name: "Xx", background: { url: "https://cdn.test/a.png", extra: 1 } }, same).background ?? {})));
const withBg = normalizeThemePackSpec({ name: "Both", theme: { isDark: true, colors: DARK }, background: { url: "https://cdn.test/a.png" } }, same);
eq("a background sits beside the theme without changing it", withBg.theme, { isDark: true, colors: DARK });

const bgData = { sounds: {}, icons: {}, background: { assetId: "a1", dim: 40, blur: 2, panels: 65 } };
const bgAssets = new Map([["a1", { id: "a1", projectId: "p", name: "sky.jpg", type: "image/jpeg", size: 400_000, width: 1920, height: 1080, createdAt: 0 }]]);
const bgUrlOf = (id: string) => `https://cdn.test/${id}.jpg`;
eq("Studio sends the background as an address", (themePackSpecInput(bgData as never, "Pack", bgAssets, bgUrlOf) as { background?: unknown }).background, { url: "https://cdn.test/a1.jpg", dim: 40, blur: 2, panels: 65 });
eq("a background whose file is gone is not sent", (themePackSpecInput(bgData as never, "Pack", new Map(), bgUrlOf) as { background?: unknown }).background, undefined);
eq("a good background has no problems", checkThemePack(bgData as never, "Pack", bgAssets), []);
ok("a small picture is warned about", checkThemePack(bgData as never, "Pack", new Map([["a1", { ...bgAssets.get("a1")!, width: 400, height: 300 }]])).some((x) => x.severity === "warning" && /soft/.test(x.message)));
ok("a huge file is warned about", checkThemePack(bgData as never, "Pack", new Map([["a1", { ...bgAssets.get("a1")!, size: 6 * 1024 * 1024 }]])).some((x) => x.severity === "warning" && /MB/.test(x.message)));
ok("a video file is refused before it is sent", checkThemePack(bgData as never, "Pack", new Map([["a1", { ...bgAssets.get("a1")!, name: "loop.mp4" }]])).some((x) => x.severity === "error"));
ok("a missing file is an error", checkThemePack(bgData as never, "Pack", new Map()).some((x) => x.severity === "error"));

const roundBg = (background: unknown) => {
  const now = Date.now();
  const project = { id: "abcd1234", kind: "themePack" as const, name: "Pack", createdAt: now, updatedAt: now, listing: { name: "Pack", description: "", free: true, priceUsd: "0" }, themePack: { sounds: {}, icons: {}, background } };
  const enc = encodeProject(project as never, "Pack", []);
  return decodeDocument(decodeProjectFile(enc.proj).project, enc.doc!).themePack?.background;
};
eq("a background survives a save and a reload", roundBg({ assetId: "a1", dim: 40, blur: 2, panels: 65 }), { assetId: "a1", dim: 40, blur: 2, panels: 65 });
eq("a reloaded background's numbers are clamped", roundBg({ assetId: "a1", dim: 999, blur: -5, panels: 0 }), { assetId: "a1", dim: 90, blur: 0, panels: 30 });
eq("a background with no file is dropped on reload", roundBg({ dim: 10 }), undefined);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
