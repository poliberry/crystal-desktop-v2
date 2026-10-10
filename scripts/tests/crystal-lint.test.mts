import { blank, lintExtension, powersUsed } from "../../src/studio/code/crystal-lint";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d))); };
const all = { capabilities: ["ui.panel", "storage", "network", "notifications"], network: ["https://api.example.org"] };
const none = { capabilities: [] as string[], network: [] as string[] };
const codes = (src: string, o = none) => lintExtension(src, o).map((x) => x.code + (x.capability ? ":" + x.capability : ""));
const at = (src: string, needle: string) => src.indexOf(needle);

// --- blanking -----------------------------------------------------------------------------------
{
  const src = 'const a = "eval(x)"; // eval(y)\n/* eval(z) */ const b = `t ${ "eval(q)" } eval(r)`;';
  const b = blank(src, true);
  ok("blank keeps length and newlines", b.length === src.length && b.split("\n").length === src.split("\n").length);
  ok("blank hides words in strings, comments and templates", !/eval/.test(b), b);
  ok("blank keeps code outside them", b.startsWith("const a = ") && b.includes("const b ="));
  ok("blank keeps quotes so a string start is visible", /setTimeout\(\s*"/.test(blank('setTimeout("x")', true)));
  const nested = "const s = `a ${ `b ${ eval('x') } c` } d`; eval(1)";
  ok("nested templates: code inside ${} is still code", (blank(nested, true).match(/eval/g) ?? []).length === 2, blank(nested, true));
  ok("an escaped quote doesn't end a string", !/eval/.test(blank('const s = "a \\" eval(x)";', true)));
}

// --- forbidden code -----------------------------------------------------------------------------
{
  ok("eval is an error", codes("eval('1')").join() === "dynamic-code");
  ok("new Function is one error (not also Function())", codes("const f = new Function('return 1')").length >= 1 && codes("const f = new Function('return 1')").every((c) => c === "dynamic-code"));
  ok("import() is refused", codes("await import('./x')").includes("dynamic-code"));
  ok("setTimeout with a string is refused, with a function isn't", codes("setTimeout('go()', 5)").includes("dynamic-code") && !codes("setTimeout(() => go(), 5)").includes("dynamic-code"));
  ok("constructor.constructor is refused", codes("({}).constructor.constructor('x')").includes("dynamic-code"));
  ok("a mention in a comment or message is not code", codes("// never eval(x)\nconst m = 'do not use eval()';").length === 0);
  ok("a method called evaluate / x.Function( isn't caught", codes("const r = evaluate(1); obj.Function(2);").length === 0);
  const src = "const x = 1;\n  (Function('return 1'))()";
  const [hit] = lintExtension(src, none);
  ok("position is exact, even after a leading character", hit && src.slice(hit.start, hit.end).startsWith("Function"), hit && src.slice(hit.start, hit.end));
}

// --- imports ------------------------------------------------------------------------------------
{
  const bad = 'import _ from "lodash";\nimport { a } from "./a";\nimport { Extension } from "@crystal/extension";\nexport * from "../b";\nimport "node:fs";';
  const hits = lintExtension(bad, all).filter((x) => x.code === "import");
  ok("other packages are errors; own files and the SDK are fine", hits.map((h) => bad.slice(h.start, h.end)).join() === "lodash,node:fs", hits.map((h) => bad.slice(h.start, h.end)));
  ok("export-from a package is caught too", lintExtension('export { x } from "left-pad";', all).some((x) => x.code === "import"));
}

// --- powers used vs asked for ------------------------------------------------------------------
{
  const src = 'import { storage, http, notify, ui, Panel, Extension } from "@crystal/extension";\nconst ext = new Extension();\nawait storage.get("a");\nawait http.fetch("https://api.example.org/x");\nawait notify("hi");\nui.text("x");';
  ok("everything asked for → no capability findings", !codes(src, all).some((c) => c.startsWith("capability")), codes(src, all));
  const found = codes(src, none).filter((c) => c.startsWith("capability")).sort().join();
  ok("each power used and not asked for is an error", found === "capability:network,capability:notifications,capability:storage,capability:ui.panel", found);
  ok("importing a thing is not using it", !codes('import { storage } from "@crystal/extension";', none).some((c) => c.startsWith("capability")));
  const only = codes(src, { capabilities: ["storage"], network: [] }).filter((c) => c.startsWith("capability")).sort().join();
  ok("only the missing ones are reported", only === "capability:network,capability:notifications,capability:ui.panel", only);
  const renamed = 'import { storage as store } from "@crystal/extension";\nstore.get("k");';
  ok("a renamed import is followed", codes(renamed, none).includes("capability:storage"));
  const ns = 'import * as sdk from "@crystal/extension";\nsdk.http.fetch("x"); sdk.storage.get("k");';
  ok("a namespace import is followed", codes(ns, none).filter((c) => c.startsWith("capability")).sort().join() === "capability:network,capability:storage");
  ok("a property of something else with the same name isn't a use", !codes('import { storage } from "@crystal/extension";\nconst o = { storage: 1 }; o.storage; other.storage.get(1);', none).some((c) => c.startsWith("capability")));
  ok("a local variable that isn't from the SDK isn't a use", codes('const http = { fetch() {} }; http.fetch();', none).length === 0);
  ok("the raw host object is checked too", codes("crystal.http.fetch('x')", none).includes("capability:network") && codes("crystal.storage.get('x')", none).includes("capability:storage"));
  const [hit] = lintExtension(src, { capabilities: ["ui.panel", "network", "notifications"], network: ["https://api.example.org"] }).filter((x) => x.code === "capability");
  ok("the marker sits on the use, not the import", hit && src.slice(hit.start, hit.end) === "storage" && hit.start > src.indexOf("\n"), hit && hit.start);
  ok("the message says where to turn it on", hit?.message.includes("What it asks for"));
}

// --- addresses ---------------------------------------------------------------------------------
{
  const src = 'await http.fetch("https://api.example.org/a");\nawait http.fetch("https://evil.test/x");\nawait http.fetch("http://api.example.org/y");';
  const hits = lintExtension(src, all).filter((x) => x.code === "origin");
  ok("a site not on the list is a warning", hits.some((h) => src.slice(h.start, h.end) === "https://evil.test") && hits.every((h) => h.severity === "warning"));
  ok("a listed site is fine; plain http is flagged", !hits.some((h) => src.slice(h.start, h.end) === "https://api.example.org") && hits.some((h) => /isn't https/.test(h.message)));
  ok("no network power → no address warnings (the power itself is the error)", lintExtension(src, none).every((x) => x.code !== "origin"));
  ok("example.com and schema hosts are ignored", lintExtension('const u = "https://example.com"; const s = "http://www.w3.org";', all).every((x) => x.code !== "origin"));
}

// --- powersUsed ---------------------------------------------------------------------------------
ok("powersUsed lists what the source needs", powersUsed('import { storage, ui } from "@crystal/extension";\nstorage.get("a"); ui.text("x");').sort().join() === "storage,ui.panel");
ok("a clean file uses nothing", powersUsed("export const x = 1;").length === 0);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
