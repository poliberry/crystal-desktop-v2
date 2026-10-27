#!/usr/bin/env node
/**
 * Crystal Studio's MCP server, for whichever AI agent is working in this project folder.
 *
 * It is copied here by Crystal Studio (`.crystal/mcp/`) and kept up to date by it, so don't edit it. It needs nothing
 * installed beyond Node 18: no packages, no network, and it only ever *reads*. It answers over stdio, the way every MCP
 * client starts a local server, and tells the agent what Studio's own guides, SDK reference and file formats say, and what
 * is wrong with the project in front of it.
 *
 * Everything it knows is in `docs.json` and `formats/` beside it, written by Studio from the same guides and SDK
 * reference the app shows. It reads files in the project folder (the `.crysproj`, the design file, `assets/`) and nothing
 * outside it; the names it is asked for are looked up in lists, never joined onto a path.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// `.crystal/mcp/server.mjs`: the project folder is two levels up.
const root = resolve(here, "..", "..");

const SERVER = { name: "crystal-studio", version: "1.0.0" };
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

const docs = (() => {
  try {
    return JSON.parse(readFileSync(join(here, "docs.json"), "utf8"));
  } catch {
    return { version: "unknown", guides: [], reference: {}, formats: [] };
  }
})();

// The editing tools: bundled with the real motion and document rules (see scripts/build-agent-kit.mjs). Without the file
// the server still answers questions; it just can't change designs.
const core = await import(pathToFileURL(join(here, "motion-core.mjs")).href).catch(() => null);

// --- Helpers -------------------------------------------------------------------------------------------------

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fail = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters; ask for a narrower item)` : s);

/** The top-level `key = "value"` lines of a `.crysproj` (TOML), before its first table. Enough for what is asked here. */
function topLevel(toml) {
  const out = {};
  for (const line of toml.split("\n")) {
    if (line.startsWith("[")) break;
    const m = /^([a-z_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function projectFile() {
  try {
    return readdirSync(root).filter((f) => f.endsWith(".crysproj")).sort()[0] ?? null;
  } catch {
    return null;
  }
}

/** Every asset the `.crysproj` lists: `[[assets]]` tables with an `id` and a `file`. */
function listedAssets(toml) {
  const found = [];
  for (const block of toml.split(/^\[\[assets\]\]\s*$/m).slice(1)) {
    const id = /^id\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const file = /^file\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const w = /^width\s*=\s*(\d+)/m.exec(block)?.[1];
    const h = /^height\s*=\s*(\d+)/m.exec(block)?.[1];
    if (id) found.push({ id, file, w: w ? Number(w) : undefined, h: h ? Number(h) : undefined });
  }
  return found;
}

/** Ids a design refers to: `assetId` fields, and `studio:asset/<id>` addresses on a timeline. */
function referencedAssets(value, into = new Set()) {
  if (Array.isArray(value)) for (const v of value) referencedAssets(v, into);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "assetId" && typeof v === "string") into.add(v);
      else referencedAssets(v, into);
    }
  } else if (typeof value === "string") {
    const m = /^studio:asset\/([\w-]+)$/.exec(value);
    if (m) into.add(m[1]);
  }
  return into;
}

const SKILL_FOR = {
  decoration: "crystal-cosmetic",
  sticker: "crystal-cosmetic",
  nameplate: "crystal-cosmetic",
  effect: "crystal-cosmetic",
  scene: "crystal-scene",
  themePack: "crystal-theme-pack",
  pack: "crystal-pack",
  bot: "crystal-bot",
  extension: "crystal-extension",
};

// --- Editing a design ------------------------------------------------------------------------------------------------------

/** The project's kind, and the design file it names (only a plain file name beside the .crysproj, never a path). */
function designTarget() {
  const file = projectFile();
  if (!file) throw new Error("No .crysproj file in this folder, so this isn't a Crystal Studio project.");
  const toml = readFileSync(join(root, file), "utf8");
  const top = topLevel(toml);
  const doc = top.document;
  if (!doc) throw new Error("This project has no design file: its code is in src/, and there is nothing here for the design tools to edit.");
  if (!/^[^/\\.][^/\\]*$/.test(doc) || doc.includes("..")) throw new Error("The project file names a design file in an unexpected place, so it was left alone.");
  const path = join(root, doc);
  if (!existsSync(path)) throw new Error(`The design file ${doc} is missing.`);
  return { kind: top.kind, doc, path, toml };
}

const BACKUPS = join(here, "backups");
const KEEP_BACKUPS = 20;

/** The design as it was before a change, kept so `undo_last_change` can put it back. Only the newest few are kept. */
function backUp(path) {
  mkdirSync(BACKUPS, { recursive: true });
  const stamp = String(Date.now()).padStart(15, "0");
  copyFileSync(path, join(BACKUPS, `${stamp}__${path.split(/[\\/]/).pop()}`));
  const all = readdirSync(BACKUPS).filter((f) => /^\d{15}__/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) unlinkSync(join(BACKUPS, old));
}

/** Written to a temporary file in the same folder and renamed over the design, so a reader never sees half of it. */
function writeDesign(path, value) {
  backUp(path);
  const tmp = join(dirname(path), `.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

const DOC_KINDS = ["decoration", "sticker", "nameplate", "effect", "scene"];

const UNDO = {
  name: "undo_last_change",
  description: "Put the design file back as it was before the last change made through these tools. Can be called repeatedly to step further back (the last 20 changes are kept).",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

function undoLast() {
  const t = designTarget();
  const mine = existsSync(BACKUPS) ? readdirSync(BACKUPS).filter((f) => f.endsWith(`__${t.doc}`)).sort() : [];
  const latest = mine[mine.length - 1];
  if (!latest) return fail("There is nothing to undo: no change has been made through these tools yet.");
  const from = join(BACKUPS, latest);
  const tmp = join(dirname(t.path), `.tmp-${process.pid}-${Date.now()}`);
  copyFileSync(from, tmp);
  renameSync(tmp, t.path);
  unlinkSync(from);
  return text(`Restored ${t.doc} to how it was before the last change (${mine.length - 1} earlier change${mine.length - 1 === 1 ? "" : "s"} can still be undone).`);
}

function extraTools() {
  if (!core) return [];
  let kind = null;
  try {
    kind = topLevel(readFileSync(join(root, projectFile() ?? ""), "utf8")).kind ?? null;
  } catch {
    /* no project file */
  }
  if (kind === "themePack") return [...core.THEME_TOOLS, UNDO];
  return DOC_KINDS.includes(kind) ? [...core.designToolsFor(kind), UNDO] : [];
}

function runExtra(name, args) {
  if (name === "undo_last_change") return undoLast();
  const isTheme = core.THEME_TOOLS.some((t) => t.name === name);
  const t = designTarget();
  let file;
  try {
    file = JSON.parse(readFileSync(t.path, "utf8"));
  } catch (e) {
    return fail(`${t.doc} isn't valid JSON (${e.message}), so it wasn't changed. Fix or restore it first.`);
  }
  if (file.kind !== t.kind) return fail(`${t.doc} says kind "${file.kind}" but the project file says "${t.kind}", so it wasn't changed.`);
  if (isTheme) {
    if (t.kind !== "themePack") return fail("That tool is for theme packs.");
    const out = core.runThemeTool(name, args, file.themePack ?? { sounds: {}, icons: {} });
    if (out.themePack) writeDesign(t.path, { ...file, themePack: out.themePack });
    return text(out.text + (out.themePack ? "\n\nSaved. If the project is open in Studio, it picks the change up when the window is next focused (unless it has unsaved changes there)." : ""));
  }
  if (!DOC_KINDS.includes(t.kind)) return fail(`A ${t.kind} project has no canvas or timeline for these tools to edit.`);
  const assets = new Map(listedAssets(t.toml).map((a) => [a.id, { w: a.w, h: a.h }]));
  const out = core.runDesignTool(name, args, { kind: t.kind, doc: file.doc, motion: file.motion }, { assets });
  if (out.design) writeDesign(t.path, { ...file, doc: out.design.doc, ...(out.design.motion ? { motion: out.design.motion } : {}) });
  return text(out.text + (out.design ? "\n\nSaved. If the project is open in Studio, it picks the change up when the window is next focused (unless it has unsaved changes there)." : ""));
}

const STARTING_DOCS = {
  bot: ["bots/overview", "bots/first-bot", "bots/events", "bots/commands", "bots/limits"],
  extension: ["extensions/overview", "extensions/first-extension", "extensions/powers", "extensions/panels", "extensions/limits"],
};

// --- Tools ---------------------------------------------------------------------------------------------------

const TOOLS = [
  {
    name: "project_info",
    description: "What this Studio project is: its kind, name, files, and which skill and guides to read first. Call this first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run() {
      const file = projectFile();
      if (!file) return fail("No .crysproj file in this folder. This is not a Crystal Studio project folder.");
      const toml = readFileSync(join(root, file), "utf8");
      const top = topLevel(toml);
      const names = readdirSync(root).filter((n) => !n.startsWith(".") && n !== "node_modules");
      const lines = [
        `Project: ${top.name ?? "(unnamed)"}`,
        `Kind: ${top.kind ?? "(unknown)"}`,
        `Project file: ${file}`,
        top.document ? `Design file: ${top.document}` : "Design file: none (a code project: its code is in src/)",
        `Files here: ${names.join(", ")}`,
        `Studio guides version: ${docs.version}`,
      ];
      const skill = SKILL_FOR[top.kind];
      if (skill) lines.push(`Skill to read: ${skill} (and crystal-studio)`);
      const start = STARTING_DOCS[top.kind];
      if (start) lines.push(`Guides to start with (read_doc): ${start.join(", ")}`);
      lines.push("Use check_project to find problems, search_docs to look things up, format_source for the exact file format.");
      return text(lines.join("\n"));
    },
  },
  {
    name: "list_docs",
    description: "List Studio's written guides (slug, title, summary), optionally for one topic: general, canvas, extensions or bots.",
    inputSchema: { type: "object", properties: { topic: { type: "string" } }, additionalProperties: false },
    run({ topic }) {
      const pages = docs.guides.filter((g) => !topic || g.topic === topic).sort((a, b) => a.topic.localeCompare(b.topic) || a.order - b.order);
      if (!pages.length) return text(topic ? `No guides under "${topic}".` : "No guides are installed.");
      return text(pages.map((g) => `${g.slug}  [${g.topic}]  ${g.title} — ${g.summary}`).join("\n"));
    },
  },
  {
    name: "read_doc",
    description: "Read one guide in full, by slug (e.g. bots/first-bot). Slugs come from list_docs or search_docs.",
    inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"], additionalProperties: false },
    run({ slug }) {
      const g = docs.guides.find((x) => x.slug === slug);
      if (!g) return fail(`No guide called "${slug}". list_docs shows what there is.`);
      return text(`# ${g.title}\n\n${g.body}`);
    },
  },
  {
    name: "search_docs",
    description: "Search the guides and the SDK reference for words. Returns the best matches, each with how to read it.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false },
    run({ query, limit }) {
      const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return fail("Give some words to search for.");
      const hits = [];
      for (const g of docs.guides) {
        const title = `${g.title} ${g.slug}`.toLowerCase();
        const body = `${g.summary} ${g.body}`.toLowerCase();
        if (!words.every((w) => title.includes(w) || body.includes(w))) continue;
        hits.push({ score: words.filter((w) => title.includes(w)).length * 10 + 1, line: `guide  ${g.slug} — ${g.title}: ${g.summary}  (read_doc)` });
      }
      for (const [sdk, ref] of Object.entries(docs.reference ?? {})) {
        for (const item of ref.items) {
          const name = item.name.toLowerCase();
          const body = `${item.summary} ${item.text}`.toLowerCase();
          if (!words.every((w) => name.includes(w) || body.includes(w))) continue;
          hits.push({ score: words.filter((w) => name.includes(w)).length * 12 + 2, line: `sdk    ${sdk}/${item.name} (${item.kind}) — ${item.summary}  (sdk_reference)` });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      const shown = hits.slice(0, Math.min(40, Math.max(1, Number(limit) || 12)));
      return text(shown.length ? shown.map((h) => h.line).join("\n") : `Nothing matches "${query}".`);
    },
  },
  {
    name: "sdk_reference",
    description: "The API of the bot SDK (@crystal/bot) or the extension SDK (@crystal/extension): one class, function or type by name, or every name if none is given.",
    inputSchema: { type: "object", properties: { sdk: { type: "string", enum: ["bot", "extension"] }, name: { type: "string" } }, required: ["sdk"], additionalProperties: false },
    run({ sdk, name }) {
      const ref = docs.reference?.[sdk];
      if (!ref) return fail(`There is no "${sdk}" SDK. Use "bot" or "extension".`);
      if (!name) return text(`${ref.package} ${ref.version}\n\n${ref.items.map((i) => `${i.name} (${i.kind}) — ${i.summary}`).join("\n")}`);
      const item = ref.items.find((i) => i.name === name) ?? ref.items.find((i) => i.name.toLowerCase() === String(name).toLowerCase());
      if (!item) return fail(`${ref.package} has no "${name}". Call sdk_reference with just the sdk to list names.`);
      return text(clip(`import { ${item.name} } from "${ref.package}";   // .crystal/sdk/${sdk}/${item.file}\n\n${item.text}`, 20000));
    },
  },
  {
    name: "format_source",
    description: "The TypeScript source that defines Studio's file formats and limits, exactly as the app uses it. With no file, lists them. Read this before editing a design file by hand.",
    inputSchema: { type: "object", properties: { file: { type: "string" } }, additionalProperties: false },
    run({ file }) {
      const known = docs.formats ?? [];
      if (!file) return text(known.map((f) => `${f.name} — ${f.about}`).join("\n"));
      const entry = known.find((f) => f.name === file);
      if (!entry) return fail(`No format file "${file}". Call format_source with no file to list them.`);
      try {
        return text(clip(readFileSync(join(here, "formats", entry.name), "utf8"), 60000));
      } catch {
        return fail(`${entry.name} isn't installed. Open the project in Crystal Studio to restore it.`);
      }
    },
  },
  {
    name: "check_project",
    description: "Check this project's files for problems Studio would trip over: unreadable files, a design that doesn't match its project file, and pictures, fonts or sounds the design uses that the project doesn't list or that are missing from assets/.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run() {
      const file = projectFile();
      if (!file) return fail("No .crysproj file in this folder.");
      const problems = [];
      const toml = readFileSync(join(root, file), "utf8");
      const top = topLevel(toml);
      const assets = listedAssets(toml);
      const listed = new Set(assets.map((a) => a.id));
      for (const a of assets) {
        if (a.file && !existsSync(join(root, a.file))) problems.push(`The project lists ${a.file}, which isn't in assets/.`);
      }
      if (top.document) {
        let design = null;
        const path = join(root, top.document);
        if (!existsSync(path)) problems.push(`The design file ${top.document} named in the project file is missing.`);
        else {
          try {
            design = JSON.parse(readFileSync(path, "utf8"));
          } catch (e) {
            problems.push(`${top.document} isn't valid JSON (${e.message}). Studio will refuse to open the project.`);
          }
        }
        if (design) {
          if (design.kind !== top.kind) problems.push(`${top.document} says kind "${design.kind}" but the project file says "${top.kind}".`);
          if (typeof design.format !== "number") problems.push(`${top.document} has no "format" number.`);
          for (const id of referencedAssets(design)) if (!listed.has(id)) problems.push(`The design uses the file "${id}", which the project file doesn't list under [[assets]].`);
        }
      } else if (top.kind === "bot" || top.kind === "extension") {
        if (!existsSync(join(root, "src", "index.ts"))) problems.push("src/index.ts is missing.");
        if (!existsSync(join(root, ".crystal", "sdk", top.kind))) problems.push("The SDK copy in .crystal/sdk is missing: open the project in Studio to restore it.");
      }
      try {
        if (statSync(join(root, ".env")).isFile() && !/^\.env\s*$/m.test(existsSync(join(root, ".gitignore")) ? readFileSync(join(root, ".gitignore"), "utf8") : "")) {
          problems.push(".env exists but .gitignore doesn't list it: it holds secrets and must not be committed.");
        }
      } catch {
        /* no .env */
      }
      return text(problems.length ? `${problems.length} problem${problems.length === 1 ? "" : "s"}:\n- ${problems.join("\n- ")}` : "No problems found in the project's files. (Studio's Submit panel runs the store's own checks.)");
    },
  },
];

// --- The protocol --------------------------------------------------------------------------------------------

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}
function refuse(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

export function handle(message) {
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  if (!method) return;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return respond(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions: "Call project_info first. For a design project the editing tools (describe_design, add_effect, animate, add_node …) change the design file; call describe_design before and after. Read the project's skill (crystal-studio plus its kind's) and use search_docs, read_doc, sdk_reference and format_source rather than guessing; run check_project after editing files.",
      });
    }
    case "ping":
      return isRequest ? respond(id, {}) : undefined;
    case "tools/list":
      return respond(id, { tools: [...TOOLS, ...extraTools()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      const extra = tool ? null : extraTools().find((t) => t.name === params?.name);
      if (!tool && !extra) return refuse(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        return respond(id, tool ? tool.run(params?.arguments ?? {}) : runExtra(extra.name, params?.arguments ?? {}));
      } catch (e) {
        return respond(id, fail(`That failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    default:
      // Notifications (initialized, cancelled…) need no answer; an unknown request does.
      if (isRequest) refuse(id, -32601, `Method not found: ${method}`);
  }
}

/** Whether this file is the program being run (not imported by a test). Real paths on both sides: `import.meta.url` has
 * symbolic links resolved and `argv[1]` doesn't, and a project folder behind a link (a synced Documents, /var on macOS) is common. */
function isMain() {
  try {
    return !!process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        refuse(null, -32700, "Parse error");
        continue;
      }
      if (Array.isArray(message)) for (const m of message) handle(m);
      else handle(message);
    }
  });
}
