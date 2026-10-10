import { ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * Crystal Studio's files: projects live in a folder in the person's Documents, as ordinary files
 * they can see, back up, put in git or open in another editor.
 *
 * The page asks for things by *relative path*, and this is the only code that turns one into a real
 * path — so it is where the boundary is. Everything below is resolved against one root folder and
 * refused if it would land anywhere else: `..`, absolute paths, drive letters, odd characters, and
 * symbolic links that point out of the folder (a link dropped into a project folder must not become
 * a way to read or overwrite something elsewhere). Only the Studio window may ask; any other
 * renderer is refused, whatever it sends.
 *
 * Writes are atomic (a temporary file, then a rename) so a crash or power cut mid-save leaves the
 * previous version intact rather than half a file. Deleting a whole project moves it to the
 * Trash/Recycle Bin instead of removing it: it is a person's work, in their own folder.
 */

const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_BINARY_BYTES = 16 * 1024 * 1024;
const MAX_PATH_CHARS = 400;
const MAX_SEGMENT_CHARS = 200;
/** Characters no segment may contain: separators, the ones Windows forbids, and control codes. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export class StudioFsError extends Error {}

function segmentsOf(rel: unknown): string[] {
  if (typeof rel !== "string" || rel.length > MAX_PATH_CHARS) throw new StudioFsError("That path isn't valid.");
  if (rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) throw new StudioFsError("That path isn't valid.");
  const parts = rel.split("/").filter((p) => p.length > 0);
  for (const p of parts) {
    if (p === "." || p === ".." || p.length > MAX_SEGMENT_CHARS || FORBIDDEN.test(p) || /[. ]$/.test(p) && p !== ".") {
      throw new StudioFsError("That path isn't valid.");
    }
  }
  return parts;
}

/** Inside `root` once links are followed, for a path that may not exist yet. */
function insideRoot(realRoot: string, target: string): boolean {
  let probe = target;
  // The nearest ancestor that exists is the one whose real location matters.
  for (;;) {
    try {
      const real = fs.realpathSync(probe);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

export function createStudioFs(rootDir: string) {
  const ensureRoot = () => {
    fs.mkdirSync(rootDir, { recursive: true });
    return fs.realpathSync(rootDir);
  };

  /** The real, checked path for a relative one. Throws rather than ever returning a path outside. */
  function resolve(rel: unknown, opts: { allowRoot?: boolean } = {}): string {
    const realRoot = ensureRoot();
    const parts = segmentsOf(rel);
    if (parts.length === 0 && !opts.allowRoot) throw new StudioFsError("That path isn't valid.");
    const abs = path.join(realRoot, ...parts);
    if (!insideRoot(realRoot, abs)) throw new StudioFsError("That path isn't valid.");
    return abs;
  }

  const asBytes = (data: unknown): Buffer => {
    if (data instanceof Uint8Array) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    throw new StudioFsError("That isn't file data.");
  };

  function atomicWrite(abs: string, data: Buffer) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.tmp-${randomBytes(6).toString("hex")}`);
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, abs);
    } catch (e) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* nothing to clean */
      }
      throw e;
    }
  }

  return {
    root: () => ensureRoot(),

    /** The real path of a folder under the root, for starting a terminal or a build in it. Never the root itself. */
    dirPath(rel: string): string {
      const abs = resolve(rel);
      if (!fs.statSync(abs).isDirectory()) throw new StudioFsError("That isn't a folder.");
      return abs;
    },

    listDir(rel: string): DirEntry[] {
      const abs = resolve(rel, { allowRoot: true });
      if (!fs.existsSync(abs)) return [];
      const out: DirEntry[] = [];
      for (const name of fs.readdirSync(abs)) {
        if (name.startsWith(".tmp-")) continue;
        try {
          // lstat: a link is reported as what it is, never followed out of the folder.
          const st = fs.lstatSync(path.join(abs, name));
          if (st.isSymbolicLink()) continue;
          out.push({ name, isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs });
        } catch {
          /* vanished while listing */
        }
      }
      return out;
    },

    exists(rel: string): boolean {
      return fs.existsSync(resolve(rel, { allowRoot: true }));
    },

    readText(rel: string): string {
      const abs = resolve(rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_TEXT_BYTES) throw new StudioFsError("That file can't be read.");
      return fs.readFileSync(abs, "utf8");
    },

    writeText(rel: string, text: unknown): void {
      if (typeof text !== "string") throw new StudioFsError("That isn't text.");
      const data = Buffer.from(text, "utf8");
      if (data.length > MAX_TEXT_BYTES) throw new StudioFsError("That file is too large.");
      atomicWrite(resolve(rel), data);
    },

    readBytes(rel: string): Buffer {
      const abs = resolve(rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_BINARY_BYTES) throw new StudioFsError("That file can't be read.");
      return fs.readFileSync(abs);
    },

    writeBytes(rel: string, data: unknown): void {
      const bytes = asBytes(data);
      if (bytes.length > MAX_BINARY_BYTES) throw new StudioFsError("That file is too large.");
      atomicWrite(resolve(rel), bytes);
    },

    mkdir(rel: string): void {
      fs.mkdirSync(resolve(rel), { recursive: true });
    },

    /** Delete one file. Folders go through `trash`, not here. */
    removeFile(rel: string): void {
      const abs = resolve(rel);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) throw new StudioFsError("That's a folder.");
      fs.rmSync(abs, { force: true });
    },

    /** Move a file or folder to the Trash. If that isn't possible, nothing is deleted. */
    async trash(rel: string): Promise<void> {
      const abs = resolve(rel);
      if (!fs.existsSync(abs)) return;
      await shell.trashItem(abs);
    },

    rename(from: string, to: string): void {
      const a = resolve(from);
      const b = resolve(to);
      if (fs.existsSync(b)) throw new StudioFsError("Something with that name already exists.");
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.renameSync(a, b);
    },

    /** Show a file or folder in Finder / Explorer. */
    reveal(rel: string): void {
      const abs = resolve(rel, { allowRoot: true });
      if (fs.statSync(abs).isDirectory()) void shell.openPath(abs);
      else shell.showItemInFolder(abs);
    },
  };
}

/**
 * Hand the filesystem to the Studio window over IPC. `isStudio` says whether a request came from
 * it; anything else is refused before it reaches a path.
 */
export function registerStudioFs(rootDir: string, isStudio: (sender: WebContents) => boolean) {
  const api = createStudioFs(rootDir);
  const guard =
    <A extends unknown[], R>(fn: (...args: A) => R | Promise<R>) =>
    async (event: IpcMainInvokeEvent, ...args: A): Promise<R> => {
      if (!isStudio(event.sender)) throw new StudioFsError("Not allowed.");
      return fn(...args);
    };

  ipcMain.handle("studio:fs:root", guard(() => api.root()));
  ipcMain.handle("studio:fs:listDir", guard((rel: string) => api.listDir(rel)));
  ipcMain.handle("studio:fs:exists", guard((rel: string) => api.exists(rel)));
  ipcMain.handle("studio:fs:readText", guard((rel: string) => api.readText(rel)));
  ipcMain.handle("studio:fs:writeText", guard((rel: string, text: string) => api.writeText(rel, text)));
  ipcMain.handle("studio:fs:readBytes", guard((rel: string) => api.readBytes(rel)));
  ipcMain.handle("studio:fs:writeBytes", guard((rel: string, data: Uint8Array) => api.writeBytes(rel, data)));
  ipcMain.handle("studio:fs:mkdir", guard((rel: string) => api.mkdir(rel)));
  ipcMain.handle("studio:fs:removeFile", guard((rel: string) => api.removeFile(rel)));
  ipcMain.handle("studio:fs:trash", guard((rel: string) => api.trash(rel)));
  ipcMain.handle("studio:fs:rename", guard((from: string, to: string) => api.rename(from, to)));
  ipcMain.handle("studio:fs:reveal", guard((rel: string) => api.reveal(rel)));
  return api;
}
