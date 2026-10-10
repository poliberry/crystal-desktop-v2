import { newId } from "@/studio/model/doc";
import { remapAssetIds } from "@/studio/model/remap";
import type { AssetMeta, Project } from "@/studio/model/types";
import {
  ASSETS_DIR,
  PROJECT_EXT,
  ProjectFormatError,
  assetFileName,
  decodeDocument,
  decodeProjectFile,
  encodeProject,
  folderNameFor,
  uniqueName,
  type DiskAsset,
} from "@/studio/storage/format";
import type { LoadError, StorageInfo, StudioStorage } from "@/studio/storage/types";
import type { DesktopAPI } from "@/types/desktop-api";

type Fs = DesktopAPI["studio"]["fs"];

/**
 * Studio's projects as files in a folder the person can see: `~/Documents/Crystal Studio/<name>/`.
 * What is written, and how a project that was edited or copied by hand is read back, is `format.ts`;
 * what a page may touch is decided in the Electron main process (`electron/studioFs.ts`). This
 * file is the part between: which folder a project is in, keeping the index, and doing it safely.
 *
 * Every operation goes through one queue. That is more than the work needs, deliberately: a save
 * is two small files, and running them one after another is what makes it impossible for a rename,
 * a save and an asset write to interleave and leave a folder half one thing and half another.
 */

const MIGRATED_FLAG = "crystal-studio-migrated-to-disk";

interface Entry {
  folder: string;
  project: Project;
  assets: Map<string, DiskAsset>;
  /** The names last written, so a rename can remove the old ones. */
  projFile: string;
  /** Absent for code projects (extensions, bots), which have no design file. */
  docFile?: string;
}

const fileOf = (a: DiskAsset) => a.file.slice(ASSETS_DIR.length + 1);
const message = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : String(e));

export function createDiskStore(fs: Fs, legacy: StudioStorage): StudioStorage {
  let entries = new Map<string, Entry>();
  let assetOwner = new Map<string, string>();
  let issues: LoadError[] = [];
  let migrationIssue: LoadError | null = null;
  let root = "";
  let ready: Promise<void> | null = null;

  // --- One thing at a time ---------------------------------------------------------------------
  let chain: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn);
    chain = next.catch(() => undefined);
    return next;
  };

  // --- Writing -----------------------------------------------------------------------------------
  async function writeEntry(e: Entry, withDocument: boolean) {
    const enc = encodeProject(e.project, e.folder, [...e.assets.values()]);
    // The design first, then the file that points at it: if this stops between the two, the old
    // project file still points at a design file that is still there.
    if (withDocument && enc.docFile && enc.doc !== undefined) await fs.writeText(`${e.folder}/${enc.docFile}`, enc.doc);
    await fs.writeText(`${e.folder}/${enc.projectFile}`, enc.proj);
    for (const stale of [e.docFile !== enc.docFile && e.docFile, e.projFile !== enc.projectFile && e.projFile]) {
      if (stale) await fs.removeFile(`${e.folder}/${stale}`).catch(() => undefined);
    }
    e.docFile = enc.docFile;
    e.projFile = enc.projectFile;
  }

  async function saveInternal(project: Project, touch: boolean) {
    const p: Project = { ...project, updatedAt: touch ? Date.now() : project.updatedAt };
    const dirs = (await fs.listDir("")).map((d) => d.name);
    let e = entries.get(p.id);
    if (!e) {
      const folder = uniqueName(folderNameFor(p.name), dirs);
      await fs.mkdir(`${folder}/${ASSETS_DIR}`);
      e = { folder, project: p, assets: new Map(), projFile: "", docFile: undefined };
    } else {
      // The folder follows the project's name. A change of case alone isn't a rename (macOS and
      // Windows can't tell the two apart), and if the rename can't happen — a file open in
      // another program, say — the project simply stays where it is: the save must not fail for it.
      const target = uniqueName(folderNameFor(p.name), dirs.filter((n) => n.toLowerCase() !== e!.folder.toLowerCase()));
      if (target.toLowerCase() !== e.folder.toLowerCase()) {
        try {
          await fs.rename(e.folder, target);
          e.folder = target;
        } catch {
          /* stays where it is */
        }
      }
      e.project = p;
    }
    e.project = p;
    await writeEntry(e, true);
    entries.set(p.id, e);
  }

  async function putAssetInternal(meta: AssetMeta, blob: Blob) {
    const e = entries.get(meta.projectId);
    if (!e) throw new Error("That project hasn't been saved yet.");
    const known = e.assets.get(meta.id);
    let name: string;
    if (known) name = fileOf(known);
    else {
      const onDisk = (await fs.listDir(`${e.folder}/${ASSETS_DIR}`)).map((f) => f.name);
      name = assetFileName(meta.name, [...[...e.assets.values()].map(fileOf), ...onDisk]);
    }
    await fs.writeBytes(`${e.folder}/${ASSETS_DIR}/${name}`, new Uint8Array(await blob.arrayBuffer()));
    e.assets.set(meta.id, { ...meta, size: blob.size, file: `${ASSETS_DIR}/${name}` });
    assetOwner.set(meta.id, e.project.id);
    await writeEntry(e, false);
  }

  // --- Reading -----------------------------------------------------------------------------------
  /** Read every project folder. Anything that can't be read is reported, not fatal. */
  async function scan() {
    const next = new Map<string, Entry>();
    const owner = new Map<string, string>();
    const found: LoadError[] = [];
    const repairs: Entry[] = [];

    const dirs = (await fs.listDir("")).filter((d) => d.isDir).sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirs) {
      try {
        const files = await fs.listDir(d.name);
        const projFiles = files.filter((f) => !f.isDir && f.name.toLowerCase().endsWith(`.${PROJECT_EXT}`)).map((f) => f.name).sort();
        if (!projFiles.length) continue; // some other folder; not ours to touch or report
        const projFile = projFiles.find((n) => n === `${d.name}.${PROJECT_EXT}`) ?? projFiles[0];

        const decoded = decodeProjectFile(await fs.readText(`${d.name}/${projFile}`));
        let project: Project;
        if (decoded.docFile) {
          if (!files.some((f) => f.name === decoded.docFile)) throw new ProjectFormatError(`The design file “${decoded.docFile}” is missing.`);
          project = decodeDocument(decoded.project, await fs.readText(`${d.name}/${decoded.docFile}`));
        } else {
          project = decoded.project as Project; // a code project: settings are in the .crysproj, code is in its files
        }

        const present = new Set((await fs.listDir(`${d.name}/${ASSETS_DIR}`)).filter((f) => !f.isDir).map((f) => f.name));
        let assets = decoded.assets.filter((a) => present.has(fileOf(a)));
        if (assets.length < decoded.assets.length) {
          const n = decoded.assets.length - assets.length;
          found.push({ folder: d.name, level: "warning", message: `${n} file${n === 1 ? " is" : "s are"} listed in the project but missing from its assets folder.` });
        }

        // A folder copied in Finder carries its project's id (and its files' ids) with it. An id has
        // to mean one thing, so the second to be read is given new ones.
        let changed = false;
        if (next.has(project.id)) {
          const id = newId("p");
          project = { ...project, id };
          assets = assets.map((a) => ({ ...a, projectId: id }));
          changed = true;
        }
        const idMap = new Map<string, string>();
        for (const a of assets) if (owner.has(a.id)) idMap.set(a.id, newId("a"));
        if (idMap.size) {
          project = structuredClone(project);
          remapAssetIds(project, (id) => idMap.get(id) ?? id);
          assets = assets.map((a) => ({ ...a, id: idMap.get(a.id) ?? a.id }));
          changed = true;
        }
        assets = assets.map((a) => ({ ...a, projectId: project.id }));

        const entry: Entry = { folder: d.name, project, assets: new Map(assets.map((a) => [a.id, a])), projFile, docFile: decoded.docFile };
        for (const a of assets) owner.set(a.id, project.id);
        next.set(project.id, entry);
        if (changed) repairs.push(entry);
      } catch (e) {
        found.push({ folder: d.name, level: "error", message: message(e) });
      }
    }

    entries = next;
    assetOwner = owner;
    issues = found;
    for (const e of repairs) {
      try {
        await writeEntry(e, true);
      } catch (err) {
        issues.push({ folder: e.folder, level: "warning", message: `Couldn't save a fix to this project's ids: ${message(err)}` });
      }
    }
  }

  /** Bring across the projects Studio kept in the browser before it kept files. Idempotent, and never blocks opening. */
  async function migrate() {
    if (typeof localStorage === "undefined" || localStorage.getItem(MIGRATED_FLAG)) return;
    try {
      const old = await legacy.listProjects();
      for (const p of old) {
        if (!entries.has(p.id)) await saveInternal(p, false);
        for (const a of await legacy.listAssets(p.id)) {
          if (entries.get(p.id)?.assets.has(a.id)) continue;
          const blob = await legacy.getAssetBlob(a.id);
          if (blob) await putAssetInternal(a, blob);
        }
      }
      // The browser's copies are left where they are: this only ever adds to the folder.
      localStorage.setItem(MIGRATED_FLAG, "1");
    } catch (e) {
      migrationIssue = { folder: "Earlier projects", level: "warning", message: `Couldn't copy projects from the browser's storage yet (${message(e)}). They are still there, and Studio will try again next time.` };
    }
  }

  const ensure = (): Promise<void> => {
    ready ??= run(async () => {
      root = await fs.root();
      await scan();
      await migrate();
    }).catch((e) => {
      ready = null;
      throw e;
    });
    return ready;
  };

  // --- The interface -----------------------------------------------------------------------------
  return {
    async listProjects() {
      const first = !ready;
      await ensure();
      if (!first) await run(scan); // a later look sees what changed in the folder meanwhile
      return [...entries.values()].map((e) => e.project).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async getProject(id) {
      await ensure();
      return entries.get(id)?.project ?? null;
    },

    async saveProject(project) {
      await ensure();
      return run(() => saveInternal(project, true));
    },

    async deleteProject(id) {
      await ensure();
      return run(async () => {
        const e = entries.get(id);
        if (!e) return;
        // To the Trash, not erased: it is somebody's work. If that can't be done, nothing is removed.
        await fs.trash(e.folder);
        for (const a of e.assets.keys()) assetOwner.delete(a);
        entries.delete(id);
      });
    },

    async listAssets(projectId) {
      await ensure();
      return [...(entries.get(projectId)?.assets.values() ?? [])].map(({ file: _file, ...meta }) => meta);
    },

    async putAsset(meta, blob) {
      await ensure();
      return run(() => putAssetInternal(meta, blob));
    },

    async getAssetBlob(id) {
      await ensure();
      const e = entries.get(assetOwner.get(id) ?? "");
      const a = e?.assets.get(id);
      if (!e || !a) return null;
      try {
        const bytes = await fs.readBytes(`${e.folder}/${a.file}`);
        return new Blob([bytes as unknown as BlobPart], { type: a.type });
      } catch {
        return null;
      }
    },

    async deleteAsset(id) {
      await ensure();
      return run(async () => {
        const e = entries.get(assetOwner.get(id) ?? "");
        const a = e?.assets.get(id);
        if (!e || !a) return;
        await fs.removeFile(`${e.folder}/${a.file}`).catch(() => undefined);
        e.assets.delete(id);
        assetOwner.delete(id);
        await writeEntry(e, false);
      });
    },

    async projectFolder(id) {
      await ensure();
      return entries.get(id)?.folder ?? null;
    },

    info: (): StorageInfo => ({ kind: "disk", root }),
    loadErrors: () => (migrationIssue ? [...issues, migrationIssue] : issues),
    reveal: () => fs.reveal(""),
  };
}
