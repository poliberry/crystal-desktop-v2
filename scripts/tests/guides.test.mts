/**
 * The written guides: that they are well-formed, that what they promise is true, and that every
 * code sample in them compiles against the SDK it is about.
 *
 *  - the compiled module is up to date with the Markdown;
 *  - every page passes the validator the Admin Console uses, so any page can be edited and re-saved;
 *  - `{{placeholders}}` all exist and expand, and links to other guides lead somewhere;
 *  - samples fenced as ```ts bot or ```ts extension are type-checked with the real compiler against
 *    `sdk/bot` or `sdk/extension`; extension samples are also run through Crystal's own lint with
 *    every power switched on, so a sample can't teach something the editor would underline;
 *  - the SDK reference only names things that exist.
 *
 * Run: npx tsx scripts/tests/guides.test.mts
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error plain JS module
import { OUT, parseGuide, readGuides, renderModule } from "../build-guides.mjs";
import { CAPABILITIES } from "../../convex/lib/extensionManifest";
import { DOC_KINDS, DOC_TOPICS, normalizeDoc, safeHref } from "../../convex/lib/studioDocs";
import { lintExtension } from "../../src/studio/code/crystal-lint";
import { FACT_NAMES, expand } from "../../src/studio/docs/facts";
import { docLinks, groupPages, mergePages, searchPages, type GuidePage, type PageData } from "../../src/studio/docs/pages";
import * as botSdk from "../../sdk/bot/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
let f = 0,
  p = 0;
const ok = (n: string, c: boolean, d?: unknown) => {
  c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : typeof d === "string" ? d : JSON.stringify(d)));
};

const pages: PageData[] = readGuides();
const slugs = new Set(pages.map((x) => x.slug));

// --- shape ---------------------------------------------------------------------------------------
ok("there are guides", pages.length >= 20, pages.length);
ok("compiled module is up to date with the Markdown", readFileSync(OUT, "utf8") === renderModule(readGuides()), "run: bun scripts/build-guides.mjs");
ok("slugs are unique", slugs.size === pages.length);
for (const page of pages) {
  let why: unknown = "";
  try {
    normalizeDoc({ ...page, body: page.body });
  } catch (e) {
    why = (e as Error).message;
  }
  ok(`${page.slug}: passes the Admin Console's validator (so it can be edited and saved)`, why === "", why);
  ok(`${page.slug}: topic and kind are known`, (DOC_TOPICS as readonly string[]).includes(page.topic) && (DOC_KINDS as readonly string[]).includes(page.kind));
  ok(`${page.slug}: path folder matches its topic's folder or is general`, page.slug.startsWith(page.topic + "/") || page.slug.startsWith("general/") || page.topic === "general");
  ok(`${page.slug}: no empty headings or raw HTML`, !/^#+\s*$/m.test(page.body) && !/<\/?(script|iframe|style|object|embed)\b/i.test(page.body));
}

// Front matter errors are reported with the file, not swallowed.
for (const [name, text, re] of [
  ["no front matter", "# Hi", /front matter/],
  ["missing key", "---\ntitle: x\n---\nbody", /missing/],
  ["unknown key", "---\ntitle: x\nfoo: y\n---\nbody", /unknown/],
  ["order not a number", "---\ntitle: x\ntopic: bots\nkind: guide\nsection: S\norder: soon\nsummary: s\n---\nbody", /order/],
] as const) {
  let msg = "";
  try {
    parseGuide("t", text);
  } catch (e) {
    msg = (e as Error).message;
  }
  ok(`front matter: ${name} is refused with a reason`, re.test(msg), msg);
}

// --- placeholders and links -----------------------------------------------------------------------
for (const page of pages) {
  const used = [...page.body.matchAll(/\{\{([a-z-]+)\}\}/g)].map((m) => m[1]);
  ok(`${page.slug}: placeholders exist`, used.every((n) => FACT_NAMES.includes(n)), used.filter((n) => !FACT_NAMES.includes(n)));
  const out = expand(page.body);
  ok(`${page.slug}: everything expands`, !/\{\{[a-z-]+\}\}/.test(out));
  const dead = docLinks(page.body).filter((s) => !slugs.has(s));
  ok(`${page.slug}: links to other guides resolve`, dead.length === 0, dead);
}
for (const name of FACT_NAMES) {
  const text = expand(`{{${name}}}`);
  ok(`fact ${name}: produces content`, text.length > 40 && !/undefined|NaN|\[object/.test(text), text.slice(0, 120));
}
// Facts really come from the code that enforces them.
{
  const { ROUTES } = await import("../../convex/lib/botRoutes");
  const routes = expand("{{bot-routes}}");
  ok("bot-routes lists every route exactly once", ROUTES.every((r) => routes.includes(`\`${r.path}\``)) && (routes.match(/^\| `(GET|POST|PUT|PATCH|DELETE)` /gm) ?? []).length === ROUTES.length, (routes.match(/^\| `(GET|POST|PUT|PATCH|DELETE)` /gm) ?? []).length + " vs " + ROUTES.length);
  const { BOT_PERMISSIONS } = await import("../../convex/lib/botAuth");
  const perms = expand("{{bot-permissions}}");
  ok("bot-permissions has a row per grantable permission", BOT_PERMISSIONS.every((x) => perms.includes(x.label)) && (perms.match(/^\| \*\*/gm) ?? []).length === BOT_PERMISSIONS.length);
  const powers = expand("{{extension-powers}}");
  ok("extension-powers has a row per capability", CAPABILITIES.every((c) => powers.includes("`" + c + "`")));
  ok("bot-limits states the real rate limit", expand("{{bot-limits}}").includes("120 requests a minute"));
}

// --- code samples compile ---------------------------------------------------------------------------
interface Sample {
  page: string;
  kind: "bot" | "extension";
  n: number;
  code: string;
}
const samples: Sample[] = [];
for (const page of pages) {
  let n = 0;
  for (const m of page.body.matchAll(/^~~~ts (bot|extension)\n([\s\S]*?)\n~~~$/gm)) samples.push({ page: page.slug, kind: m[1] as "bot" | "extension", n: ++n, code: m[2] });
  // An untagged TypeScript fence is a mistake: either it compiles and should say so, or it's a fragment and should not be TypeScript.
  const untagged = [...page.body.matchAll(/^(~~~|```)ts\s*$/gm)].length;
  ok(`${page.slug}: every TypeScript sample says what it is for (ts bot / ts extension)`, untagged === 0, untagged);
}
ok("there are samples to check", samples.length >= 25, samples.length);

const work = mkdtempSync(join(tmpdir(), "guides-"));
try {
  const tsc = join(root, "node_modules/.bin/tsc");
  for (const kind of ["bot", "extension"] as const) {
    const dir = join(work, kind);
    mkdirSync(dir, { recursive: true });
    const mine = samples.filter((s) => s.kind === kind);
    const files = mine.map((s) => {
      // A sample that starts with a path comment (`// src/open.ts`) is a file of a small project: it is written at that path,
      // in a folder of its own for the page, so the other samples on the page can import it and the compiler follows the imports.
      const at = /^\/\/ (src\/[\w/.-]+\.ts)\n/.exec(s.code)?.[1];
      const name = at ? `${s.page.replace(/\//g, "__")}/${at}` : `${s.page.replace(/\//g, "__")}__${s.n}.ts`;
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), s.code + "\n");
      return name;
    });
    const sdk = join(root, "sdk", kind);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: kind === "bot" ? "ES2022" : "ES2020",
          module: "ESNext",
          moduleResolution: "Bundler",
          lib: ["ES2022"],
          types: kind === "bot" ? ["node"] : [],
          typeRoots: [join(root, "node_modules/@types")],
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          paths: { [`@crystal/${kind}`]: [join(sdk, "index.ts")] },
        },
        include: [...files, ...(kind === "extension" ? [join(sdk, "globals.ts")] : [])],
      }),
    );
    let out = "";
    try {
      out = execFileSync(tsc, ["-p", join(dir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? "");
    }
    const errors = out.split("\n").filter((l) => /error TS\d+/.test(l));
    ok(`all ${mine.length} ${kind} samples compile against sdk/${kind}`, errors.length === 0, errors.slice(0, 8));

    if (kind === "extension") {
      for (const s of mine) {
        const origins = [...new Set([...s.code.matchAll(/https:\/\/[A-Za-z0-9.-]+/g)].map((m) => m[0]))];
        const bad = lintExtension(s.code, { capabilities: [...CAPABILITIES], network: origins }).filter((x) => x.severity === "error");
        ok(`${s.page} #${s.n}: no Crystal lint errors with every power on`, bad.length === 0, bad.map((b) => b.message));
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

// --- the SDK reference names real things ----------------------------------------------------------------
{
  const ref = pages.find((x) => x.slug === "bots/sdk-reference")!.body;
  const sdk = botSdk as unknown as Record<string, { prototype?: Record<string, unknown> }>;
  const missing: string[] = [];
  // "What you get back": | `Class` | members… `method()` … |
  const section = ref.split("## What you get back")[1].split("## Builders")[0];
  for (const row of section.split("\n").filter((l) => l.startsWith("| `"))) {
    const cells = row.split("|").map((c) => c.trim());
    const classNames = [...cells[1].matchAll(/`(\w+)`/g)].map((m) => m[1]);
    for (const c of classNames) if (!sdk[c]) missing.push(c);
    for (const m of cells[2].matchAll(/`(\w+)\(\)`/g)) {
      if (!classNames.some((c) => sdk[c]?.prototype && m[1] in sdk[c].prototype!)) missing.push(`${classNames.join("/")}.${m[1]}()`);
    }
  }
  // Builders and helpers.
  const helpers = ref.split("## Builders and helpers")[1].split("## Requirements")[0];
  for (const row of helpers.split("\n").filter((l) => l.startsWith("| `"))) {
    const cell = row.split("|")[1];
    for (const m of cell.matchAll(/`(\w+)/g)) if (!(m[1] in botSdk) && !["new"].includes(m[1])) missing.push(m[1]);
  }
  // The Client table.
  const proto = (botSdk.Client as unknown as { prototype: Record<string, unknown> }).prototype;
  for (const m of ref.split("## Client")[1].split("## What you get back")[0].matchAll(/`client\.(\w+)\(/g)) if (!(m[1] in proto)) missing.push(`client.${m[1]}()`);
  ok("the SDK reference only names classes, builders and methods that exist", missing.length === 0, missing);
}

// --- merging with pages saved in the Admin Console -------------------------------------------------------
{
  const shipped: PageData[] = [
    { slug: "bots/a", title: "A", topic: "bots", kind: "guide", section: "S", summary: "", body: "a", order: 2 },
    { slug: "bots/b", title: "B", topic: "bots", kind: "guide", section: "S", summary: "", body: "b", order: 1 },
    { slug: "extensions/c", title: "C", topic: "extensions", kind: "guide", section: "T", summary: "", body: "c", order: 1 },
  ];
  const saved = [
    { slug: "bots/a", title: "A (edited)", topic: "bots", kind: "guide", section: "S", summary: "", body: "new a", order: 2, updatedAt: 5 },
    { slug: "bots/new", title: "New", topic: "bots", kind: "article", section: "S", summary: "", body: "n", order: 3, updatedAt: 6 },
  ] as (PageData & { updatedAt: number })[];
  const merged = mergePages(shipped, saved);
  ok("a saved page with a shipped address replaces it", merged.find((x) => x.slug === "bots/a")?.body === "new a" && merged.find((x) => x.slug === "bots/a")?.source === "edited");
  ok("a saved page with a new address is added", merged.find((x) => x.slug === "bots/new")?.source === "added" && merged.length === 4);
  ok("unchanged shipped pages stay as shipped", merged.find((x) => x.slug === "bots/b")?.source === "built-in");
  ok("removing the saved page brings the shipped one back", mergePages(shipped, []).find((x) => x.slug === "bots/a")?.body === "a");
  const groups = groupPages(merged);
  ok("grouped by topic (extensions before bots follows DOC_TOPICS), then section, in order", groups.map((g) => g.topic).join() === "extensions,bots" && groups[1].sections[0].pages.map((x) => x.slug).join() === "bots/b,bots/a,bots/new", groups.map((g) => g.topic + ":" + g.sections.map((s) => s.pages.map((x) => x.slug)).join("|")));
  ok("groupPages can show just some topics", groupPages(merged, ["extensions"]).length === 1);
  ok("search finds by body, ranks titles first", searchPages(merged, "new")[0].slug === "bots/new" && searchPages(merged, "zzz").length === 0 && searchPages(merged, "").length === merged.length);
  ok("search needs every word", searchPages(merged as GuidePage[], "edited new").length === 1);
}

// --- links ---------------------------------------------------------------------------------------------
for (const [href, want] of [
  ["https://example.com/x", "https://example.com/x"],
  ["http://example.com", null],
  ["javascript:alert(1)", null],
  ["data:text/html,hi", null],
  ["//evil.test", null],
  ["doc:bots/events", "doc:bots/events"],
  ["doc:bots/events#polling", "doc:bots/events#polling"],
  ["doc:../x", null],
  ["#section", "#section"],
  ["", null],
  [undefined, null],
] as const) {
  ok(`safeHref(${JSON.stringify(href)})`, safeHref(href as string | undefined) === want, safeHref(href as string | undefined));
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
