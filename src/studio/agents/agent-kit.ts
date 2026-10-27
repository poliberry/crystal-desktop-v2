import {
  AGENT_FILES_VERSION,
  MCP_CONFIGS,
  MCP_DIR,
  managedFiles,
  mcpConfigText,
  mergeMcpConfig,
  shouldRefresh,
} from "@/studio/agents/agent-files";
import { isCodeKind, type Project, type ProjectKind } from "@/studio/model/types";

/**
 * Putting the AI-agent kit in a project folder: Studio's MCP server and what it reads, instructions every agent finds on
 * its own, skills, and the configuration that starts the server in each tool. For every kind of project.
 *
 * What is written, and what is left alone:
 *  - `.crystal/mcp/*` is Studio's, and is replaced whenever the bundled kit changes.
 *  - Instruction and skill files carry a marker. A file Studio wrote is refreshed when its text is newer; a file whose
 *    marker the person removed, or that they wrote themselves, is never touched.
 *  - Instruction, skill and MCP config files are created only the first time. A person who deletes one has decided, and
 *    it stays deleted. An MCP config that already exists gets our server added to it and nothing else changed.
 *
 * It never fails a save: whoever calls this treats an error as "the kit isn't there yet".
 */

export interface KitFs {
  exists(rel: string): Promise<boolean>;
  readText(rel: string): Promise<string>;
  writeText(rel: string, text: string): Promise<void>;
}

/** The shipped kit: `public/studio-sdk/agent` (see scripts/build-agent-kit.mjs). */
export interface KitBundle {
  version: string;
  server: string;
  /** The editing tools, bundled with the real motion and document rules. */
  core: string;
  docs: KitDocs;
  formats: { name: string; text: string }[];
}

export interface KitDocs {
  version?: string;
  guides: { slug: string; title: string; topic: string; kind: string; section: string; summary: string; order: number; body: string }[];
  reference: Record<string, unknown>;
  formats: { name: string; about: string }[];
}

const STAMP = `${MCP_DIR}/VERSION`;

/** Which guides and which SDK reference are worth an agent's attention for a project, so a theme pack isn't buried in bot docs. */
export function docsFor(kind: ProjectKind, docs: KitDocs): KitDocs {
  const topics = new Set(["general"]);
  if (kind === "bot") topics.add("bots");
  if (kind === "extension") topics.add("extensions");
  const sdk = isCodeKind(kind) ? kind : null;
  return {
    ...docs,
    guides: docs.guides.filter((g) => topics.has(g.topic)),
    reference: sdk && docs.reference[sdk] ? { [sdk]: docs.reference[sdk] } : {},
  };
}

/** The shipped kit, read from the app's own files (no network). */
export async function loadKitBundle(base = "/studio-sdk/agent"): Promise<KitBundle> {
  const get = async (rel: string) => {
    const res = await fetch(`${base}/${rel}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`The bundled agent kit is missing ${rel}.`);
    return res.text();
  };
  const manifest = JSON.parse(await get("manifest.json")) as { version: string; files: string[] };
  if (!/^[0-9a-f]{8,64}$/.test(manifest.version) || manifest.files.some((f) => !/^(formats\/)?[\w.-]+$/.test(f))) throw new Error("The bundled agent kit is damaged.");
  const docs = JSON.parse(await get("docs.json")) as KitDocs;
  const formats: KitBundle["formats"] = [];
  for (const f of manifest.files.filter((x) => x.startsWith("formats/"))) formats.push({ name: f.slice("formats/".length), text: await get(f) });
  return { version: manifest.version, server: await get("server.mjs"), core: await get("motion-core.mjs"), docs, formats };
}

/**
 * Bring a project folder's kit up to date. `folder` is the project's folder under Studio's root. Returns the paths it wrote.
 */
export async function ensureAgentKit(fs: KitFs, folder: string, project: Pick<Project, "kind">, bundle: KitBundle): Promise<string[]> {
  const at = (rel: string) => `${folder}/${rel}`;
  const wanted = `${bundle.version}/${AGENT_FILES_VERSION}`;
  const stamp = await fs.readText(at(STAMP)).then((t) => t.trim()).catch(() => null);
  if (stamp === wanted) return [];
  const first = stamp === null;
  const wrote: string[] = [];
  const put = async (rel: string, text: string) => {
    await fs.writeText(at(rel), text);
    wrote.push(rel);
  };

  // Studio's own files: always the current ones.
  await put(`${MCP_DIR}/server.mjs`, bundle.server);
  await put(`${MCP_DIR}/motion-core.mjs`, bundle.core);
  await put(`${MCP_DIR}/docs.json`, JSON.stringify({ ...docsFor(project.kind, bundle.docs), version: bundle.version }));
  for (const f of bundle.formats) await put(`${MCP_DIR}/formats/${f.name}`, f.text);

  // Instructions and skills: created the first time, refreshed only where Studio still owns the file.
  for (const file of managedFiles(project)) {
    if (await fs.exists(at(file.path))) {
      if (first) continue;
      const existing = await fs.readText(at(file.path)).catch(() => null);
      if (existing !== null && shouldRefresh(existing)) await put(file.path, file.text);
    } else if (first) {
      await put(file.path, file.text);
    }
  }

  // MCP configuration for each tool: created, or our server added to what is there. Only the first time.
  if (first) {
    for (const c of MCP_CONFIGS) {
      if (!(await fs.exists(at(c.path)))) {
        await put(c.path, mcpConfigText(c));
        continue;
      }
      const merged = mergeMcpConfig(await fs.readText(at(c.path)).catch(() => ""), c);
      if (merged !== null) await put(c.path, merged);
    }
  }

  // The stamp last: if anything above failed, the next look finds the kit incomplete and tries again.
  await put(STAMP, `${wanted}\n`);
  return wrote;
}
