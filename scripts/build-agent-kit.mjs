#!/usr/bin/env bun
/**
 * Bundles what Studio's MCP server needs into `public/studio-sdk/agent/`, which the app serves and Studio copies into every
 * project folder (`.crystal/mcp/`), the same way it ships the SDKs:
 *
 *   server.mjs     agent-kit/mcp-server.mjs, as it is
 *   motion-core.mjs  the editing tools (src/studio/agents/motion-tools.ts) bundled with the real motion and document rules, so
 *                  what an agent writes is checked by the same code the app and the store use
 *   docs.json      the written guides and the SDK reference, as plain text an agent can search
 *   formats/       the TypeScript that defines the file formats and limits, as the app itself uses it
 *   manifest.json  the files, and a version that changes whenever any of them does
 *
 * Built from the sources, never written by hand, so the guides an agent reads are the guides the app shows. Run by
 * scripts/prepare-studio-assets.mjs (postinstall, dev and build). It reads the committed `built-in.generated.ts` and
 * `reference.generated.ts`, so run `bun scripts/build-guides.mjs` / `build-reference.mjs` first if those are stale.
 *
 *   bun scripts/build-agent-kit.mjs
 */
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "studio-sdk", "agent");

/** The sources that define a file format or a limit, and what each is for. Read by an agent through `format_source`. */
export const FORMATS = [
  { from: "src/studio/model/types.ts", about: "Every design's document: nodes, paint, effects, projects, listings, theme packs." },
  { from: "convex/lib/motion.ts", about: "Animated nameplates and profile effects: clips, keyframes, generators, limits." },
  { from: "convex/lib/creationSpecs.ts", about: "Lounge scenes and theme packs as the server validates them; colour tokens, sounds, limits." },
  { from: "convex/lib/cosmeticLayers.ts", about: "Avatar decoration and sticker layers, positions and limits." },
  { from: "src/studio/storage/format.ts", about: "How a project is written to and read back from its folder (.crysproj and design files)." },
];

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

/** One SDK item as plain text: its signature(s), what it is, and each member with its summary. */
export function renderItem(item) {
  const lines = [];
  const doc = (d) => (d && d.summary ? clean(d.summary) : "");
  const sig = (s) => `${s.text}${s.doc ? `  // ${clean(s.doc)}` : ""}`;
  switch (item.kind) {
    case "class":
      lines.push(`class ${item.name}${item.extends ? ` extends ${item.extends}` : ""}`);
      for (const c of item.constructors ?? []) lines.push(`  new ${sig(c)}`);
      break;
    case "function":
      for (const s of item.signatures ?? []) lines.push(`function ${item.name}${sig(s)}`);
      break;
    case "constant":
      lines.push(`const ${item.name}: ${item.type}${item.value ? ` = ${item.value}` : ""}`);
      break;
    case "type":
      lines.push(`type ${item.name} = ${item.definition}`);
      break;
    default:
      lines.push(`${item.kind} ${item.name}`);
  }
  if (doc(item.doc)) lines.push(doc(item.doc));
  for (const t of item.doc?.tags ?? []) lines.push(`@${t.name} ${clean(t.text)}`);
  for (const m of item.members ?? []) {
    const head =
      m.kind === "method"
        ? (m.signatures ?? []).map((s) => `${m.static ? "static " : ""}${m.name}${s.text}`).join("\n    ")
        : `${m.static ? "static " : ""}${m.readonly ? "readonly " : ""}${m.name}${m.optional ? "?" : ""}: ${m.type}`;
    lines.push(`  ${head}${doc(m.doc) ? `   — ${doc(m.doc)}` : ""}`);
  }
  return lines.join("\n");
}

export async function buildAgentKit() {
  const { BUILT_IN_GUIDES } = await import("../src/studio/docs/built-in.generated.ts");
  const { SDK_REFERENCE } = await import("../src/studio/docs/reference.generated.ts");

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "formats"), { recursive: true });

  const reference = {};
  for (const [sdk, ref] of Object.entries(SDK_REFERENCE)) {
    reference[sdk] = {
      package: ref.package,
      version: ref.version,
      items: ref.items.map((i) => ({ name: i.name, kind: i.kind, file: i.file, summary: clean(i.doc?.summary), text: renderItem(i) })),
    };
  }

  const formats = [];
  for (const f of FORMATS) {
    const src = join(root, f.from);
    if (!existsSync(src)) throw new Error(`${f.from} is missing, so the agent kit can't be built.`);
    const name = f.from.split("/").pop();
    cpSync(src, join(out, "formats", name));
    formats.push({ name, about: f.about });
  }

  cpSync(join(root, "agent-kit", "mcp-server.mjs"), join(out, "server.mjs"));
  await build({
    entryPoints: [join(root, "src", "studio", "agents", "motion-tools.ts")],
    outfile: join(out, "motion-core.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    tsconfig: join(root, "tsconfig.json"),
    legalComments: "none",
    logLevel: "warning",
  });
  const docs = {
    guides: BUILT_IN_GUIDES.map((g) => ({ slug: g.slug, title: g.title, topic: g.topic, kind: g.kind, section: g.section, summary: g.summary, order: g.order, body: g.body })),
    reference,
    formats,
  };

  // A version that changes when anything an agent reads does, so Studio knows when to refresh a project's copy.
  const hash = createHash("sha256");
  hash.update(readFileSync(join(out, "server.mjs")));
  hash.update(readFileSync(join(out, "motion-core.mjs")));
  hash.update(JSON.stringify(docs));
  for (const f of formats) hash.update(readFileSync(join(out, "formats", f.name)));
  const version = hash.digest("hex").slice(0, 16);

  writeFileSync(join(out, "docs.json"), JSON.stringify({ version, ...docs }));
  const files = ["server.mjs", "motion-core.mjs", "docs.json", ...formats.map((f) => `formats/${f.name}`)];
  writeFileSync(join(out, "manifest.json"), JSON.stringify({ version, files }, null, 2));
  return { version, files };
}

if (import.meta.main) {
  const { version, files } = await buildAgentKit();
  console.log(`[studio] built the agent kit ${version} (${files.length} files)`);
}
