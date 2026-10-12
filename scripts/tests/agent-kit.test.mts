/**
 * The AI-agent kit, written to real folders for every kind of project and then used: the generated MCP server is started as a
 * child process and spoken to over stdio the way an agent does. Run: bun scripts/tests/agent-kit.test.mts
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { buildAgentKit } from "../build-agent-kit.mjs";
import { docsFor, ensureAgentKit, loadKitBundle, type KitFs } from "../../src/studio/agents/agent-kit";
import { MARKER_PATTERN, MCP_CONFIGS, MCP_NAME, managedFiles, mergeMcpConfig, mcpConfigText, skillsFor } from "../../src/studio/agents/agent-files";
import { encodeProject } from "../../src/studio/storage/format";
import { KIND_LABEL, type ProjectKind } from "../../src/studio/model/types";
import { newProject } from "../../src/studio/storage/use-projects";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : String(d).slice(0, 600))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ got, want }));

const root = join(import.meta.dir, "../..");
await buildAgentKit();
const bundle = await loadKitBundle(pathToFileURL(join(root, "public/studio-sdk/agent")).href);
const made: string[] = [];

/** A KitFs over a real folder, as Studio's bridge would be. */
const diskFs = (base: string): KitFs & { writes: string[] } => {
  const writes: string[] = [];
  return {
    writes,
    exists: async (rel) => existsSync(join(base, rel)),
    readText: async (rel) => readFileSync(join(base, rel), "utf8"),
    writeText: async (rel, text) => {
      mkdirSync(dirname(join(base, rel)), { recursive: true });
      writeFileSync(join(base, rel), text);
      writes.push(rel);
    },
  };
};

const KINDS = Object.keys(KIND_LABEL) as ProjectKind[];

/** A project folder as Studio writes it: the .crysproj, and the design file if the kind has one. */
function projectFolder(kind: ProjectKind) {
  const dir = mkdtempSync(join(tmpdir(), `crystal-kit-${kind}-`));
  made.push(dir);
  const project = newProject(kind, "My Thing");
  const enc = encodeProject(project, "My Thing", []);
  writeFileSync(join(dir, enc.projectFile), enc.proj);
  if (enc.docFile) writeFileSync(join(dir, enc.docFile), enc.doc!);
  return { dir, project };
}

// ---- Every kind gets the kit --------------------------------------------------------------------------------------------
for (const kind of KINDS) {
  const { dir, project } = projectFolder(kind);
  // A KitFs rooted at the project folder, so the folder argument is empty and paths are `./x`.
  const base = diskFs(dir);
  const rooted: KitFs = { exists: (r) => base.exists(r.replace(/^\//, "")), readText: (r) => base.readText(r.replace(/^\//, "")), writeText: (r, t) => base.writeText(r.replace(/^\//, ""), t) };
  const wrote = await ensureAgentKit(rooted, "", project, bundle);
  const has = (rel: string) => existsSync(join(dir, rel));

  ok(`${kind}: AGENTS.md`, has("AGENTS.md"));
  ok(`${kind}: CLAUDE.md imports AGENTS.md`, readFileSync(join(dir, "CLAUDE.md"), "utf8").includes("@AGENTS.md"));
  ok(`${kind}: GEMINI.md`, has("GEMINI.md"));
  ok(`${kind}: Cursor rule`, has(".cursor/rules/crystal-studio.mdc"));
  ok(`${kind}: Copilot instructions`, has(".github/copilot-instructions.md"));
  ok(`${kind}: the MCP server and its documents`, has(".crystal/mcp/server.mjs") && has(".crystal/mcp/docs.json") && has(".crystal/mcp/formats/types.ts"));
  for (const c of MCP_CONFIGS) ok(`${kind}: ${c.path} starts our server`, JSON.stringify(JSON.parse(readFileSync(join(dir, c.path), "utf8"))[c.key]?.[MCP_NAME]) === JSON.stringify(c.entry));
  for (const root of [".claude/skills", ".agents/skills"]) {
    for (const s of skillsFor(kind)) {
      const text = readFileSync(join(dir, `${root}/${s.name}/SKILL.md`), "utf8");
      const fm = /^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/.exec(text);
      ok(`${kind}: ${root}/${s.name} has valid front matter naming its folder`, !!fm && fm[1] === s.name && fm[2].length > 20 && fm[2].length <= 1024, text.slice(0, 200));
    }
  }
  ok(`${kind}: a kind-specific skill, as well as the general one`, skillsFor(kind).length === 2 && skillsFor(kind)[0].name === "crystal-studio");
  ok(`${kind}: the stamp is last`, wrote[wrote.length - 1] === ".crystal/mcp/VERSION");
  ok(`${kind}: no secrets or absolute paths written`, !wrote.some((w) => w.startsWith("/")) && !readFileSync(join(dir, "AGENTS.md"), "utf8").includes(dir));

  // The documents are narrowed to the kind.
  const docs = JSON.parse(readFileSync(join(dir, ".crystal/mcp/docs.json"), "utf8"));
  const topics = new Set(docs.guides.map((g: { topic: string }) => g.topic));
  ok(`${kind}: only its own guides`, topics.has("general") && (kind === "bot") === topics.has("bots") && (kind === "extension") === topics.has("extensions"), [...topics].join());
  eq(`${kind}: SDK reference only for code projects`, Object.keys(docs.reference), kind === "bot" ? ["bot"] : kind === "extension" ? ["extension"] : []);
}

// ---- Running it again, and the person's choices -------------------------------------------------------------------------
{
  const { dir, project } = projectFolder("themePack");
  const fs = diskFs(dir);
  await ensureAgentKit(fs, "", project, bundle);
  const n = fs.writes.length;
  eq("a second run writes nothing", (await ensureAgentKit(fs, "", project, bundle)).length, 0);
  eq("and touches no file", fs.writes.length, n);

  // The person deletes one, takes one over, and edits another's config.
  rmSync(join(dir, "GEMINI.md"));
  writeFileSync(join(dir, "AGENTS.md"), "# My own notes\n");
  writeFileSync(join(dir, ".crystal/mcp/VERSION"), "old/0\n");
  const wrote = await ensureAgentKit(fs, "", project, bundle);
  ok("a new bundle replaces Studio's own files", wrote.includes(".crystal/mcp/server.mjs") && wrote.includes(".crystal/mcp/docs.json"));
  ok("a file the person deleted stays deleted", !existsSync(join(dir, "GEMINI.md")));
  eq("a file the person wrote is never touched", readFileSync(join(dir, "AGENTS.md"), "utf8"), "# My own notes\n");
  ok("their MCP configs aren't rewritten after the first time", !wrote.includes(".mcp.json"));

  // A managed file from an older Studio is refreshed; one with the marker removed is not.
  const skill = join(dir, ".claude/skills/crystal-studio/SKILL.md");
  writeFileSync(skill, readFileSync(skill, "utf8").replace(MARKER_PATTERN, "crystal-studio:managed v0"));
  const other = join(dir, ".agents/skills/crystal-studio/SKILL.md");
  writeFileSync(other, readFileSync(other, "utf8").replace(/<!-- crystal-studio:managed[^>]*-->\n/, "") + "\nMy addition.\n");
  writeFileSync(join(dir, ".crystal/mcp/VERSION"), "old/0\n");
  await ensureAgentKit(fs, "", project, bundle);
  ok("an older managed file is refreshed", /managed v[1-9]/.test(readFileSync(skill, "utf8")));
  ok("one the person took over is left alone", readFileSync(other, "utf8").includes("My addition."));
}

// ---- Existing MCP config is merged, never clobbered ------------------------------------------------------------------------
{
  const claude = MCP_CONFIGS[0];
  const merged = JSON.parse(mergeMcpConfig(JSON.stringify({ mcpServers: { other: { command: "x" } }, extra: 1 }), claude)!);
  ok("our server is added beside theirs", merged.mcpServers.other.command === "x" && !!merged.mcpServers[MCP_NAME] && merged.extra === 1);
  eq("a server of ours they edited is left as it is", mergeMcpConfig(JSON.stringify({ mcpServers: { [MCP_NAME]: { command: "mine" } } }), claude), null);
  eq("a file that isn't JSON is left alone", mergeMcpConfig("// comments\n{ }", claude), null);
  eq("a file that isn't an object is left alone", mergeMcpConfig("[1]", claude), null);
  eq("servers that isn't an object is left alone", mergeMcpConfig(JSON.stringify({ mcpServers: [] }), claude), null);
  const oc = MCP_CONFIGS.find((c) => c.path === "opencode.json")!;
  const o = JSON.parse(mcpConfigText(oc));
  ok("OpenCode's shape: local, with the command as an array", o.mcp[MCP_NAME].type === "local" && Array.isArray(o.mcp[MCP_NAME].command) && o.$schema.includes("opencode.ai"));
  const vs = JSON.parse(mcpConfigText(MCP_CONFIGS.find((c) => c.path === ".vscode/mcp.json")!));
  ok("VS Code's shape: `servers` with a type", vs.servers[MCP_NAME].type === "stdio");

  const { dir, project } = projectFolder("bot");
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }));
  const base = diskFs(dir);
  await ensureAgentKit(base, "", project, bundle);
  const after = JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8"));
  ok("an existing .mcp.json keeps its servers and gains ours", after.mcpServers.github.command === "gh-mcp" && !!after.mcpServers[MCP_NAME]);
}

// ---- What an agent is told is true -----------------------------------------------------------------------------------------
{
  const text = (kind: ProjectKind) => skillsFor(kind).map((s) => s.body).join("\n");
  ok("the theme pack skill lists the real colour tokens", text("themePack").includes("sidebar-accent-foreground") && text("themePack").includes("callJoin"));
  ok("and tells how the two looks work", text("themePack").includes("theme.alt"));
  ok("the cosmetic skill quotes the real motion limits", text("nameplate").includes("12 s") && text("nameplate").includes("96 clips"));
  ok("each cosmetic kind's artboard is in it", text("decoration").includes("400 × 400") && text("nameplate").includes("960 × 176") && text("effect").includes("600 × 700"));
  ok("the scene skill lists the real props", text("scene").includes("discoball") && text("scene").includes("fireflies"));
  ok("the pack skill states the pack rules", text("pack").includes("At least two") && text("pack").includes("scenes"));
  ok("every skill says it can't publish or invent assets", skillsFor("bot")[0].body.includes("can't publish") && skillsFor("bot")[0].body.includes("Don't invent assets"));
  ok("general skill tells where secrets go", skillsFor("bot")[0].body.includes(".env"));
  ok("every managed file has the marker", managedFiles({ kind: "bot" }).every((m) => MARKER_PATTERN.test(m.text)));
  ok("docs narrow without losing the rest", docsFor("themePack", bundle.docs).formats.length === bundle.docs.formats.length);
}

// ---- The MCP server, spoken to over stdio ----------------------------------------------------------------------------------
class Client {
  private proc;
  private buf = "";
  private waiting = new Map<number, (m: any) => void>();
  private n = 0;
  constructor(cwd: string, server: string) {
    this.proc = spawn(process.execPath.endsWith("bun") ? "node" : process.execPath, [server], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (c: string) => {
      this.buf += c;
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        const m = JSON.parse(line);
        this.waiting.get(m.id)?.(m);
      }
    });
  }
  call(method: string, params?: unknown): Promise<any> {
    const id = ++this.n;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no answer to ${method}`)), 8000);
      this.waiting.set(id, (m) => (clearTimeout(t), resolve(m)));
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }
  notify(method: string) {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
  }
  raw(line: string) {
    this.proc.stdin.write(`${line}\n`);
  }
  close() {
    this.proc.kill();
  }
}

for (const kind of ["bot", "themePack", "nameplate"] as ProjectKind[]) {
  const { dir, project } = projectFolder(kind);
  const base = diskFs(dir);
  await ensureAgentKit(base, "", project, bundle);
  const c = new Client(dir, join(dir, ".crystal/mcp/server.mjs"));
  try {
    const init = await c.call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    ok(`${kind}: initialises, with tools`, init.result.protocolVersion === "2025-06-18" && !!init.result.capabilities.tools && init.result.serverInfo.name === "crystal-studio", JSON.stringify(init));
    eq(`${kind}: an unknown protocol version gets one it speaks`, (await c.call("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, "2025-06-18");
    c.notify("notifications/initialized");
    eq(`${kind}: ping`, (await c.call("ping")).result, {});
    const tools = (await c.call("tools/list")).result.tools as { name: string; inputSchema: { type: string } }[];
    eq(`${kind}: the read-only tools come first, always`, tools.slice(0, 7).map((t) => t.name), ["project_info", "list_docs", "read_doc", "search_docs", "sdk_reference", "format_source", "check_project"]);
    ok(`${kind}: each tool has an object schema`, tools.every((t) => t.inputSchema.type === "object"));
    const call = async (name: string, args: unknown = {}) => (await c.call("tools/call", { name, arguments: args })).result as { content: { text: string }[]; isError?: boolean };

    const info = (await call("project_info")).content[0].text;
    ok(`${kind}: project_info names the project and its kind`, info.includes("Project: My Thing") && info.includes(`Kind: ${kind}`), info);
    ok(`${kind}: and the skill to read`, /Skill to read: crystal-/.test(info), info);

    const list = (await call("list_docs")).content[0].text;
    ok(`${kind}: list_docs lists real guides`, list.includes("general/the-sdk"), list.slice(0, 200));
    const read = await call("read_doc", { slug: "general/the-sdk" });
    ok(`${kind}: read_doc returns a guide's text`, read.content[0].text.includes("Crystal's SDK") || read.content[0].text.length > 500, read.content[0].text.slice(0, 100));
    ok(`${kind}: an unknown guide is an error, not a crash`, (await call("read_doc", { slug: "nope/nothing" })).isError === true);
    ok(`${kind}: searching finds things`, (await call("search_docs", { query: "update live listing" })).content[0].text.includes("general/updating"));
    ok(`${kind}: and says when there is nothing`, (await call("search_docs", { query: "zzzxqj" })).content[0].text.includes("Nothing matches"));
    ok(`${kind}: an empty search is refused`, (await call("search_docs", { query: "  " })).isError === true);

    const fmt = await call("format_source");
    ok(`${kind}: format_source lists the format files`, fmt.content[0].text.includes("motion.ts") && fmt.content[0].text.includes("creationSpecs.ts"));
    ok(`${kind}: and returns a file's source`, (await call("format_source", { file: "creationSpecs.ts" })).content[0].text.includes("normalizeThemePackSpec"));
    ok(`${kind}: it will not read a path it wasn't given a name for`, (await call("format_source", { file: "../../../etc/passwd" })).isError === true && (await call("format_source", { file: "../../AGENTS.md" })).isError === true);

    const check = (await call("check_project")).content[0].text;
    ok(`${kind}: a fresh project checks clean`, kind === "bot" ? true : check.startsWith("No problems"), check);

    if (kind === "bot") {
      const sdk = (await call("sdk_reference", { sdk: "bot", name: "Client" })).content[0].text;
      ok("bot: sdk_reference gives a class's real signature", sdk.includes('from "@crystal/bot"') && sdk.includes("class Client"), sdk.slice(0, 300));
      ok("bot: the list of names", (await call("sdk_reference", { sdk: "bot" })).content[0].text.includes("Client (class)"));
      ok("bot: an unknown name is an error", (await call("sdk_reference", { sdk: "bot", name: "Nope" })).isError === true);
      ok("bot: the other SDK isn't here", (await call("sdk_reference", { sdk: "extension" })).isError === true);
      ok("bot: search finds SDK items too", (await call("search_docs", { query: "Client" })).content[0].text.includes("sdk    bot/Client"));
    }
    if (kind === "themePack") {
      // Break the project in the ways that happen: a design that disagrees, an asset that isn't listed or isn't there.
      const doc = JSON.parse(readFileSync(join(dir, "My Thing.crystheme"), "utf8"));
      doc.kind = "decoration";
      doc.themePack.font = { family: "X", faces: [{ assetId: "ghost", weight: 400, style: "normal" }] };
      writeFileSync(join(dir, "My Thing.crystheme"), JSON.stringify(doc));
      const bad = (await call("check_project")).content[0].text;
      ok("themePack: a kind mismatch is reported", bad.includes('says kind "decoration"'), bad);
      ok("themePack: an unlisted asset is reported", bad.includes('"ghost"'), bad);
      writeFileSync(join(dir, "My Thing.crystheme"), "{ not json");
      ok("themePack: unreadable JSON is reported", (await call("check_project")).content[0].text.includes("isn't valid JSON"));
      rmSync(join(dir, "My Thing.crystheme"));
      ok("themePack: a missing design file is reported", (await call("check_project")).content[0].text.includes("is missing"));
    }
    eq(`${kind}: an unknown method is an error`, (await c.call("resources/list")).error.code, -32601);
    eq(`${kind}: an unknown tool is an error`, (await c.call("tools/call", { name: "rm_rf", arguments: {} })).error.code, -32602);
    c.raw("this is not json");
    eq(`${kind}: still alive after garbage`, (await c.call("ping")).result, {});
  } finally {
    c.close();
  }
}

// ---- Not a project folder ---------------------------------------------------------------------------------------------------
{
  const dir = mkdtempSync(join(tmpdir(), "crystal-kit-empty-"));
  made.push(dir);
  const base = diskFs(dir);
  await ensureAgentKit(base, "", { kind: "bot" }, bundle);
  rmSync(join(dir, ".crystal/mcp/docs.json"));
  const c = new Client(dir, join(dir, ".crystal/mcp/server.mjs"));
  try {
    await c.call("initialize", {});
    const res = (await c.call("tools/call", { name: "project_info", arguments: {} })).result;
    ok("no .crysproj: says so", res.isError === true && res.content[0].text.includes("not a Crystal Studio project"));
    ok("missing documents don't stop it starting", (await c.call("tools/call", { name: "list_docs", arguments: {} })).result.content[0].text.includes("No guides"));
  } finally {
    c.close();
  }
}

for (const d of made) rmSync(d, { recursive: true, force: true });
console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
