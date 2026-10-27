import { getDesktopAPI } from "@/lib/desktop";
import { SDK_DIR, scaffoldFiles, sdkDirFor } from "@/studio/model/code-templates";
import type { Project } from "@/studio/model/types";
import { projectFolder } from "@/studio/storage/db";
import type { DesktopAPI } from "@/types/desktop-api";

type Fs = DesktopAPI["studio"]["fs"];

/**
 * A code project's files, as the workbench sees them: paths relative to the project folder
 * (`src/index.ts`). Everything goes through the sandboxed file API in the main process, which
 * refuses anything that would leave the Studio folder; this layer adds the project's own folder
 * name (which changes when the project is renamed, so it is asked for every time) and the few
 * things the workbench needs that a bare file API doesn't give it.
 */

export interface FileInfo {
  name: string;
  /** Relative to the project folder. */
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export class WorkspaceError extends Error {}

/** `src/a/b.ts` → `src/a`; a top-level file → `""`. */
export const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
export const baseOf = (path: string) => path.split("/").pop() ?? path;
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** A name for a new file or folder: one path segment, nothing a file system would choke on. */
export function validateNewName(name: string): string {
  const n = name.trim();
  // eslint-disable-next-line no-control-regex
  if (!n || n.length > 100 || /[\\/:*?"<>|\u0000-\u001f]/.test(n) || n === "." || n === ".." || /[. ]$/.test(n)) {
    throw new WorkspaceError("That isn't a name a file can have. Use letters, numbers, dots, dashes and underscores.");
  }
  return n;
}

export interface Workspace {
  /** The project's folder under the Studio folder, right now. */
  folder(): Promise<string>;
  list(dir: string): Promise<FileInfo[]>;
  /** The file's current state, or null if it isn't there. */
  stat(path: string): Promise<FileInfo | null>;
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  /** Write and return the new modification time. */
  write(path: string, text: string): Promise<number>;
  createFile(dir: string, name: string, text?: string): Promise<string>;
  createFolder(dir: string, name: string): Promise<string>;
  rename(path: string, newName: string): Promise<string>;
  /** To the Trash, not erased. */
  trash(path: string): Promise<void>;
  reveal(path: string): Promise<void>;
}

export function openWorkspace(projectId: string): Workspace | null {
  const fs: Fs | undefined = getDesktopAPI()?.studio?.fs;
  if (!fs) return null;
  const folder = async () => {
    const f = await projectFolder(projectId);
    if (!f) throw new WorkspaceError("This project isn't saved yet.");
    return f;
  };
  const abs = async (path: string) => `${await folder()}${path ? `/${path}` : ""}`;

  const ws: Workspace = {
    folder,
    async list(dir) {
      const entries = await fs.listDir(await abs(dir));
      return entries
        .map((e) => ({ ...e, path: join(dir, e.name) }))
        .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    },
    async stat(path) {
      const parent = parentOf(path);
      const name = baseOf(path);
      try {
        const e = (await fs.listDir(await abs(parent))).find((x) => x.name === name);
        return e ? { ...e, path } : null;
      } catch {
        return null;
      }
    },
    async exists(path) {
      return fs.exists(await abs(path));
    },
    async read(path) {
      return fs.readText(await abs(path));
    },
    async write(path, text) {
      await fs.writeText(await abs(path), text);
      return (await ws.stat(path))?.mtimeMs ?? Date.now();
    },
    async createFile(dir, name, text = "") {
      const path = join(dir, validateNewName(name));
      if (await ws.exists(path)) throw new WorkspaceError(`“${baseOf(path)}” already exists.`);
      await fs.writeText(await abs(path), text);
      return path;
    },
    async createFolder(dir, name) {
      const path = join(dir, validateNewName(name));
      if (await ws.exists(path)) throw new WorkspaceError(`“${baseOf(path)}” already exists.`);
      await fs.mkdir(await abs(path));
      return path;
    },
    async rename(path, newName) {
      const to = join(parentOf(path), validateNewName(newName));
      if (to === path) return path;
      await fs.rename(await abs(path), await abs(to));
      return to;
    },
    async trash(path) {
      await fs.trash(await abs(path));
    },
    async reveal(path) {
      await fs.reveal(await abs(path));
    },
  };
  return ws;
}

const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split(".").map((n) => parseInt(n, 10) || 0));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
};

/** The SDK Studio ships, read from the app's own files (no network): its version and every file. */
async function bundledSdk(kind: "extension" | "bot"): Promise<{ version: string; files: Record<string, string> }> {
  const base = `/studio-sdk/${kind}`;
  const manifest = (await (await fetch(`${base}/manifest.json`, { cache: "no-store" })).json()) as { version: string; files: string[] };
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || !Array.isArray(manifest.files) || manifest.files.some((f) => !/^[\w.-]+$/.test(f))) throw new WorkspaceError("The bundled SDK is damaged. Reinstall Crystal.");
  const files: Record<string, string> = {};
  for (const f of manifest.files) {
    const res = await fetch(`${base}/${f}`, { cache: "no-store" });
    if (!res.ok) throw new WorkspaceError(`The bundled SDK is missing ${f}. Reinstall Crystal.`);
    files[f] = await res.text();
  }
  return { version: manifest.version, files };
}

/**
 * Put the Crystal SDK in a project, at `.crystal/sdk/<kind>/`, so its source is there to read and to
 * step into — it is the project's own copy, not a hidden dependency. Installed on creation and
 * refreshed when this Studio carries a newer version, or if files are missing; a version that is
 * the same or newer than Studio's is left alone, and nothing outside `.crystal/sdk/<kind>` is touched.
 */
export async function ensureSdk(ws: Workspace, kind: "extension" | "bot"): Promise<"installed" | "updated" | "current"> {
  const dir = sdkDirFor(kind);
  const bundled = await bundledSdk(kind);
  const onDisk = await ws.read(`${dir}/package.json`).then((t) => (JSON.parse(t) as { version?: string }).version ?? null).catch(() => null);
  const present = new Set((await ws.list(dir).catch(() => [])).map((e) => e.name));
  const complete = Object.keys(bundled.files).every((f) => present.has(f));
  if (onDisk && complete && !newer(bundled.version, onDisk)) return "current";
  for (const [name, text] of Object.entries(bundled.files)) await ws.write(`${dir}/${name}`, text);
  await ws.write(`${SDK_DIR}/README.md`, "# The Crystal SDK\n\nThis folder is Crystal's own SDK, copied here by Crystal Studio so you can read it and step into it. Studio keeps it up to date, so don't edit the files in here — changes are overwritten when the SDK is updated.\n");
  return onDisk ? "updated" : "installed";
}

/**
 * Give a code project the files it should start with. Only ever adds: a file that exists is left
 * exactly as it is. The SDK is handled by `ensureSdk`.
 */
export async function ensureScaffold(ws: Workspace, project: Project, siteUrl: string): Promise<string[]> {
  const created: string[] = [];
  for (const [path, text] of Object.entries(scaffoldFiles(project, siteUrl))) {
    if (await ws.exists(path)) continue;
    await ws.write(path, text);
    created.push(path);
  }
  if (project.kind === "extension" || project.kind === "bot") await ensureSdk(ws, project.kind);
  return created;
}
