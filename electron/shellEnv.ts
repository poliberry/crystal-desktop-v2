import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Finding programs the way the person's own terminal would.
 *
 * An app started from the Dock gets a minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), so `git`,
 * `claude`, `codex` or anything installed with Homebrew or nvm isn't found even though it works in
 * every terminal. Studio's terminal fixes that by starting a login shell; this does the same once,
 * to ask that shell what its PATH is. Nothing here runs a program on the page's behalf: it only
 * answers "is there a `git`, and where".
 */

const START = "__CRYSTAL_PATH_START__";
const END = "__CRYSTAL_PATH_END__";

/** Places tools commonly live that a stripped PATH misses, tried after the real PATH. */
export function commonToolDirs(home = os.homedir(), platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return [];
  return ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", path.join(home, ".local", "bin"), path.join(home, ".cargo", "bin"), path.join(home, ".bun", "bin"), "/usr/bin", "/bin"];
}

/** `a:b` + `b:c` → `a:b:c`, keeping the first occurrence of each. */
export function mergePaths(...lists: (string | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const p of (list ?? "").split(path.delimiter)) {
      if (p && !seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out.join(path.delimiter);
}

/** Pull the PATH out of a login shell's output, which may have a banner or rc-file noise around it. */
export function parseMarkedPath(output: string): string | null {
  const a = output.lastIndexOf(START);
  const b = output.indexOf(END, a + START.length);
  if (a === -1 || b === -1) return null;
  const value = output.slice(a + START.length, b).trim();
  return value.length > 0 && !/[\0\n]/.test(value) ? value : null;
}

let cached: Promise<string> | null = null;

/** The PATH of the person's login shell, merged with the usual tool folders. Asked once per run. */
export function loginPath(): Promise<string> {
  cached ??= (async () => {
    const fallback = mergePaths(process.env.PATH, ...commonToolDirs());
    if (process.platform === "win32") return process.env.PATH ?? "";
    const wanted = process.env.SHELL;
    const shell = wanted && path.isAbsolute(wanted) && fs.existsSync(wanted) ? wanted : process.platform === "darwin" ? "/bin/zsh" : "/bin/bash";
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          shell,
          ["-ilc", `printf '%s' "${START}\${PATH}${END}"`],
          { timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true, env: { ...process.env, TERM: "dumb" } },
          (err, stdout) => (err && !stdout ? reject(err) : resolve(String(stdout))),
        );
        child.stdin?.end();
      });
      const real = parseMarkedPath(out);
      return real ? mergePaths(real, process.env.PATH, ...commonToolDirs()) : fallback;
    } catch {
      return fallback;
    }
  })();
  return cached;
}

/** For tests and for "I just installed it": forget what was learned. */
export function forgetLoginPath() {
  cached = null;
}

/**
 * Where `name` is, searching `pathVar` — or null. On Windows an executable has an extension from
 * PATHEXT; a name that already has one is tried as is. Only regular files that can be executed count.
 */
export function findOnPath(
  name: string,
  pathVar: string,
  opts: { platform?: NodeJS.Platform; exists?: (p: string) => boolean; pathExt?: string } = {},
): string | null {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return null;
  const platform = opts.platform ?? process.platform;
  const exists = opts.exists ?? isExecutable;
  const exts = platform === "win32" ? ["", ...(opts.pathExt ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)] : [""];
  const sep = platform === "win32" ? ";" : ":";
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = platform === "win32" ? path.win32.join(dir, name + ext) : path.posix.join(dir, name + ext);
      if (exists(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(p: string): boolean {
  try {
    const st = fs.statSync(p);
    if (!st.isFile()) return false;
    if (process.platform === "win32") return true;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
