import { PRE_HYDRATION_SCRIPT } from "../../src/lib/pre-hydration-script";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });

/** Just enough of a page to run the script against: classes and style properties on <html>, a head, localStorage, matchMedia. */
function run(storage: Record<string, string>, systemDark = true, brokenStorage = false) {
  const classes = new Set<string>(["dark", "h-full"]);
  const props: Record<string, string> = {};
  const styles: { id: string; attrs: Record<string, string>; textContent: string }[] = [];
  const html = {
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
    style: { setProperty: (k: string, v: string) => { props[k] = v; } },
  };
  const document = {
    documentElement: html,
    head: { appendChild: (el: (typeof styles)[number]) => styles.push(el) },
    createElement: () => {
      const el = { id: "", attrs: {} as Record<string, string>, textContent: "", setAttribute(k: string, v: string) { this.attrs[k] = v; } };
      return el;
    },
  };
  const localStorage = {
    getItem: (k: string) => {
      if (brokenStorage) throw new Error("denied");
      return storage[k] ?? null;
    },
  };
  const window = { localStorage, matchMedia: () => ({ matches: systemDark }) };
  new Function("document", "window", PRE_HYDRATION_SCRIPT)(document, window);
  return { classes, props, styles };
}

const LIGHT = { id: "x", name: "X", isDark: false, colors: { background: "#fff", foreground: "#111" } };
const DARK = { id: "y", name: "Y", isDark: true, font: '"Inter", sans-serif', colors: { background: "#000", "sidebar-accent": "#222" } };

// ---- The saved theme --------------------------------------------------------------------------------------------------------
{
  const r = run({ "crystal-theme": JSON.stringify(LIGHT) });
  ok("a saved light theme drops the dark class", !r.classes.has("dark"), [...r.classes]);
  eq("and writes one style element", r.styles.length, 1);
  eq("under the id the provider looks for", r.styles[0].id, "crystal-theme-vars");
  ok("marked so the provider replaces it", "data-prehydrate" in r.styles[0].attrs);
  ok("with the colours", r.styles[0].textContent.includes("--background: #fff;") && r.styles[0].textContent.includes("--foreground: #111;"), r.styles[0].textContent);
  ok("in rules that out-rank the stylesheet's", r.styles[0].textContent.startsWith("html:root {") && r.styles[0].textContent.includes("html.dark {"), r.styles[0].textContent);
}
{
  const r = run({ "crystal-theme": JSON.stringify(DARK) });
  ok("a saved dark theme keeps the dark class", r.classes.has("dark"));
  ok("hyphenated tokens are written as they are", r.styles[0].textContent.includes("--sidebar-accent: #222;"));
  ok("a theme's font is written", r.styles[0].textContent.includes('--font-sans: "Inter", sans-serif;'));
}
{
  const r = run({});
  ok("nothing saved: the page keeps its default (dark) and writes nothing", r.classes.has("dark") && r.styles.length === 0);
}

// ---- Modes that follow the system ------------------------------------------------------------------------------------------
{
  const light = run({ "crystal-theme-mode": "system", "crystal-theme": JSON.stringify(DARK) }, false);
  ok("system mode follows a light OS", !light.classes.has("dark"));
  eq("and leaves the colours to the provider", light.styles.length, 0);
  ok("system mode follows a dark OS", run({ "crystal-theme-mode": "system" }, true).classes.has("dark"));
  ok("dynamic mode is treated the same", !run({ "crystal-theme-mode": "dynamic" }, false).classes.has("dark"));
  ok("an unknown mode is a fixed theme", run({ "crystal-theme-mode": "weird", "crystal-theme": JSON.stringify(LIGHT) }).styles.length === 1);
}

// ---- Accessibility -------------------------------------------------------------------------------------------------------------
{
  const r = run({ "crystal-accessibility": JSON.stringify({ reducedMotion: true, reduceBlur: true, highContrast: false, readableFont: true, underlineLinks: false, textScale: 1.3, zoom: 1.5 }) });
  ok("reduced motion", r.classes.has("a11y-reduced-motion"));
  ok("reduced blur", r.classes.has("a11y-reduce-blur"));
  ok("readable font", r.classes.has("a11y-readable-font"));
  ok("what is off stays off", !r.classes.has("a11y-high-contrast") && !r.classes.has("a11y-underline-links"));
  eq("text size", r.props["--a11y-text-scale"], "1.3");
}
{
  const r = run({ "crystal-accessibility": JSON.stringify({ reducedMotion: "yes", textScale: "big" }) });
  ok("only a real `true` turns anything on", !r.classes.has("a11y-reduced-motion"));
  ok("and a text scale must be a number", !("--a11y-text-scale" in r.props));
  ok("an absurd text scale is ignored", !("--a11y-text-scale" in run({ "crystal-accessibility": JSON.stringify({ textScale: 400 }) }).props));
}

// ---- Damage -------------------------------------------------------------------------------------------------------------------
{
  const r = run({ "crystal-theme": "{not json", "crystal-accessibility": "also not" });
  ok("garbage in storage doesn't throw, and leaves the page as it was", r.classes.has("dark") && r.styles.length === 0);
  ok("a theme with no colours is ignored", run({ "crystal-theme": JSON.stringify({ isDark: false }) }).classes.has("dark"));
  ok("storage that refuses to be read doesn't throw", run({}, true, true).classes.has("dark"));
}

// The script is put into the page as text. Nothing in it may close a script element early.
ok("the script can't end its own <script> tag", !/<\/script/i.test(PRE_HYDRATION_SCRIPT));

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
