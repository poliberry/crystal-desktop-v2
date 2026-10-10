import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import * as fs from "node:fs";
import * as pty from "node-pty";

/**
 * The terminal in Crystal Studio's code workbench: a real shell, in a real PTY, started in the
 * project's own folder.
 *
 * A terminal is a way to run anything, so what it does and doesn't allow is spelled out here:
 *
 *  - Only the Studio window can open or use one; any other renderer is refused. Terminals belong to
 *    the window that opened them, are closed with it, and are capped in number.
 *  - It starts inside a project folder under Documents/Crystal Studio (the caller passes a folder
 *    already resolved and checked by `studioFs`; the page never supplies a real path).
 *  - It is only started by the person pressing "New terminal" — never by opening a project, and
 *    never on behalf of extension or bot code, which has no way to reach this.
 *  - The shell inherits the user's environment minus anything that looks like a credential and
 *    Electron's own variables, so a token in Crystal's environment doesn't appear in `env`.
 *
 * Within the shell the person can do whatever they could do in their own terminal; that is the
 * point of one. This file doesn't try to be a sandbox for it.
 */

const MAX_TERMINALS = 6;
const MAX_WRITE = 64 * 1024;

interface Term {
  proc: pty.IPty;
  owner: WebContents;
}

const SECRET_NAME = /(token|secret|password|passwd|api[_-]?key|private[_-]?key|credential|auth)/i;

/** The user's environment, without Electron's variables or anything that reads like a credential. */
export function terminalEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (k.startsWith("ELECTRON_") || k === "NODE_OPTIONS" || k === "ELECTRON_RUN_AS_NODE") continue;
    if (SECRET_NAME.test(k)) continue;
    out[k] = v;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  out.TERM_PROGRAM = "CrystalStudio";
  return out;
}

function shellFor(): { file: string; args: string[] } {
  if (process.platform === "win32") return { file: "powershell.exe", args: [] };
  const wanted = process.env.SHELL;
  const file = wanted && wanted.startsWith("/") && fs.existsSync(wanted) ? wanted : process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
  // A login shell, because an app started from the Dock gets a minimal PATH: without this, `npm`
  // and `node` installed through nvm or Homebrew aren't found.
  return { file, args: ["-l"] };
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback);

export function registerStudioTerminal(
  /** The real, checked path of a project folder, or throws. */
  dirPath: (rel: string) => string,
  isStudio: (sender: WebContents) => boolean,
) {
  const terms = new Map<string, Term>();
  const watched = new WeakSet<WebContents>();
  let counter = 0;

  const guard =
    <A extends unknown[], R>(fn: (event: IpcMainInvokeEvent, ...args: A) => R) =>
    (event: IpcMainInvokeEvent, ...args: A): R => {
      if (!isStudio(event.sender)) throw new Error("Not allowed.");
      return fn(event, ...args);
    };
  const owned = (event: IpcMainInvokeEvent, id: unknown): Term | undefined => {
    const t = typeof id === "string" ? terms.get(id) : undefined;
    return t && t.owner === event.sender ? t : undefined;
  };
  const closeAllFor = (owner: WebContents) => {
    for (const [id, t] of terms) {
      if (t.owner !== owner) continue;
      terms.delete(id);
      try {
        t.proc.kill();
      } catch {
        /* already gone */
      }
    }
  };

  ipcMain.handle(
    "studio:term:open",
    guard((event, folder: string, cols: number, rows: number) => {
      const owner = event.sender;
      if ([...terms.values()].filter((t) => t.owner === owner).length >= MAX_TERMINALS) throw new Error(`Up to ${MAX_TERMINALS} terminals can be open at once.`);
      const cwd = dirPath(folder);
      if (!fs.statSync(cwd).isDirectory()) throw new Error("That isn't a folder.");
      const { file, args } = shellFor();
      const proc = pty.spawn(file, args, { name: "xterm-256color", cols: clamp(cols, 10, 500, 80), rows: clamp(rows, 2, 200, 24), cwd, env: terminalEnv() });
      const id = `t${++counter}`;
      terms.set(id, { proc, owner });
      // Output and exit are only sent while the window still exists: during quit the shell can
      // outlive it by a moment, and sending to a destroyed webContents throws.
      const send = (channel: string, ...payload: unknown[]) => {
        if (!owner.isDestroyed()) owner.send(channel, id, ...payload);
      };
      proc.onData((d) => send("studio:term:data", d));
      proc.onExit(({ exitCode }) => {
        terms.delete(id);
        send("studio:term:exit", exitCode);
      });
      if (!watched.has(owner)) {
        watched.add(owner);
        owner.once("destroyed", () => closeAllFor(owner));
      }
      return id;
    }),
  );
  ipcMain.handle(
    "studio:term:write",
    guard((event, id: string, data: string) => {
      if (typeof data !== "string" || data.length > MAX_WRITE) return;
      owned(event, id)?.proc.write(data);
    }),
  );
  ipcMain.handle(
    "studio:term:resize",
    guard((event, id: string, cols: number, rows: number) => {
      try {
        owned(event, id)?.proc.resize(clamp(cols, 10, 500, 80), clamp(rows, 2, 200, 24));
      } catch {
        /* the shell has just exited */
      }
    }),
  );
  ipcMain.handle(
    "studio:term:kill",
    guard((event, id: string) => {
      const t = owned(event, id);
      if (!t) return;
      terms.delete(id);
      try {
        t.proc.kill();
      } catch {
        /* already gone */
      }
    }),
  );

  return { closeAll: () => [...new Set([...terms.values()].map((t) => t.owner))].forEach(closeAllFor) };
}
