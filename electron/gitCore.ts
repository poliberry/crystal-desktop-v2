import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { GitCode, GitDiffRequest, GitDiffSides, GitFileChange, GitRemote, GitStatus } from "./gitTypes";

/**
 * Git for Studio's code projects, as a handful of plain functions over one project folder. Nothing
 * here knows about Electron or the page, so it can be tested against real repositories.
 *
 * Studio asks git for its status every couple of seconds while a project is open, so the commands it
 * runs on its own (status, diff, log) are held to a stricter standard than a person typing in a
 * terminal, because a project folder is not always something the person wrote:
 *
 *  - Git is told not to look above the project folder (`GIT_CEILING_DIRECTORIES`): a repository in
 *    Documents is not this project's repository, and its status isn't shown as if it were.
 *  - Nothing configured *inside* the folder gets to run code while reading: no file-system monitor
 *    (`core.fsmonitor` can name a program), no external diff driver, no text conversion filter.
 *  - Reading doesn't take git's index lock, so it never makes a commit in a terminal fail.
 *  - Every path from the page is checked and given to git after `--` with pathspec magic turned
 *    off, so a file called `:(exclude)src` is a file, not an instruction.
 *
 * Commit, push and pull do what git does, including running the repository's hooks — they happen
 * only when the person presses the button, as they would in a terminal.
 */

export class GitError extends Error {
  constructor(
    message: string,
    /** Lets the page act on a few cases (`identity`: ask who the commit is by). */
    readonly code?: "identity" | "nothing-staged" | "no-remote" | "auth" | "behind" | "not-a-repo" | "diverged" | "missing",
  ) {
    super(message);
  }
}

export interface GitCtx {
  /** The project folder. */
  cwd: string;
  /** The `git` executable. */
  git: string;
  /** The environment to run it in (with a PATH that finds tools). */
  env: NodeJS.ProcessEnv;
  /** Move a path to the Trash. Used for discarding a file git has never seen. */
  trash?: (abs: string) => Promise<void>;
  /** Extra arguments placed before the subcommand, e.g. a credential helper for one push. */
  pre?: string[];
  /** Added to the environment for network commands only. */
  secretEnv?: NodeJS.ProcessEnv;
}

export interface RunResult {
  code: number | null;
  out: Buffer;
  err: string;
  timedOut: boolean;
  /** Output was cut at the limit. */
  truncated: boolean;
}

const MAX_OUT = 16 * 1024 * 1024;
const MAX_ERR = 256 * 1024;
export const MAX_CHANGES = 2000;
export const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_PATHS = 5000;

/** Options in front of every command. */
const SAFE_FLAGS = ["--no-pager", "--literal-pathspecs", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.quotepath=off", "-c", "color.ui=never"];

export const realCwd = (cwd: string): string => {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return path.resolve(cwd);
  }
};

function baseEnv(ctx: GitCtx, network: boolean): NodeJS.ProcessEnv {
  const real = realCwd(ctx.cwd);
  return {
    ...ctx.env,
    ...(network ? ctx.secretEnv : undefined),
    GIT_CEILING_DIRECTORIES: path.dirname(real),
    // Never wait for someone to type at a prompt that nobody can see.
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_OPTIONAL_LOCKS: "0",
    // Messages are matched below, so they have to be in a known language.
    LC_MESSAGES: "C",
    LANGUAGE: "C",
    // These would aim git somewhere else than the folder it was started in.
    GIT_DIR: undefined,
    GIT_WORK_TREE: undefined,
    GIT_INDEX_FILE: undefined,
    GIT_EXTERNAL_DIFF: undefined,
  };
}

/** Run git with an argument list (never a shell). */
export function run(ctx: GitCtx, args: string[], opts: { input?: string; timeoutMs?: number; maxBytes?: number; network?: boolean } = {}): Promise<RunResult> {
  const network = !!opts.network;
  const full = [...SAFE_FLAGS, ...(network ? (ctx.pre ?? []) : []), ...args];
  const maxBytes = opts.maxBytes ?? MAX_OUT;
  const env = baseEnv(ctx, network);
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ctx.git, full, { cwd: realCwd(ctx.cwd), env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    } catch {
      return reject(new GitError("Git couldn't be started.", "missing"));
    }
    const out: Buffer[] = [];
    let outBytes = 0;
    let err = "";
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 30_000);
    child.stdout.on("data", (d: Buffer) => {
      if (truncated) return;
      outBytes += d.length;
      if (outBytes > maxBytes) {
        truncated = true;
        child.kill("SIGKILL");
        return;
      }
      out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      if (err.length < MAX_ERR) err += d.toString("utf8");
    });
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new GitError(e.code === "ENOENT" ? "Git isn't installed on this computer." : "Git couldn't be started.", "missing"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: Buffer.concat(out), err, timedOut, truncated });
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(opts.input ?? "");
  });
}

/** What to show a person from git's stderr: no `fatal:` prefix, no credentials, not endless. */
export function cleanMessage(raw: string): string {
  const text = scrubSecrets(raw)
    .split("\n")
    .map((l) => l.replace(/^(fatal|error|remote): /, "").trimEnd())
    .filter((l) => l.trim().length > 0 && !/^hint:/.test(l))
    .join("\n")
    .trim();
  return text.length > 800 ? `${text.slice(0, 800)}…` : text || "Git reported an error.";
}

/** Passwords and tokens in URLs, and anything that looks like a GitHub token, replaced. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "•••");
}

async function ok(ctx: GitCtx, args: string[], opts: Parameters<typeof run>[2] = {}): Promise<RunResult> {
  const r = await run(ctx, args, opts);
  if (r.timedOut) throw new GitError("Git took too long and was stopped.");
  if (r.code !== 0) throw new GitError(cleanMessage(r.err));
  return r;
}

const text = (r: RunResult) => r.out.toString("utf8");

// --- Paths from the page ------------------------------------------------------------------------

const MAX_PATH = 400;

/** A project-relative path that stays inside the project and doesn't touch git's own folder. */
export function cleanRelPath(rel: unknown): string {
  if (typeof rel !== "string" || rel.length === 0 || rel.length > MAX_PATH) throw new GitError("That path isn't valid.");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(rel) || rel.startsWith("/") || rel.includes("\\") || /^[a-zA-Z]:/.test(rel)) throw new GitError("That path isn't valid.");
  const parts = rel.split("/");
  for (const p of parts) {
    if (p === "" || p === "." || p === ".." || p.toLowerCase() === ".git") throw new GitError("That path isn't valid.");
  }
  return rel;
}

function cleanPaths(paths: unknown): string[] {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS) throw new GitError("Nothing was chosen.");
  return [...new Set(paths.map(cleanRelPath))];
}

/** Credential files that shouldn't be committed by accident. */
export function looksSensitive(rel: string): boolean {
  const base = rel.split("/").pop() ?? rel;
  if (/^\.env(\..+)?$/i.test(base)) return !/\.(example|sample|template|dist)$/i.test(base);
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(base)) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(base)) return true;
  if (/^(\.npmrc|\.pypirc|\.netrc|credentials\.json|service-account.*\.json)$/i.test(base)) return true;
  return false;
}

// --- Reading ------------------------------------------------------------------------------------

/** Where git is, and whether it works. */
export async function gitVersion(ctx: GitCtx): Promise<string | null> {
  try {
    const r = await run({ ...ctx, cwd: process.cwd() }, ["--version"], { timeoutMs: 8000 });
    return r.code === 0 ? text(r).trim() : null;
  } catch {
    return null;
  }
}

/** Whether the project folder itself is a repository's top (not a folder inside someone else's). */
export async function isRepoRoot(ctx: GitCtx): Promise<boolean> {
  const r = await run(ctx, ["rev-parse", "--show-toplevel"], { timeoutMs: 8000 });
  if (r.code !== 0) return false;
  const top = text(r).trim();
  if (!top) return false;
  const a = realCwd(path.resolve(top));
  const b = realCwd(ctx.cwd);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

const X: Record<string, GitCode | null> = { ".": null, M: "M", A: "A", D: "D", R: "R", C: "C", T: "T", U: "U" };
const code = (c: string): GitCode | null => (c in X ? X[c] : "M");

export interface ParsedStatus {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  truncated: boolean;
}

/** `git status --porcelain=v2 --branch -z`, understood. */
export function parseStatusV2(raw: string): ParsedStatus {
  const out: ParsedStatus = { branch: null, oid: null, upstream: null, ahead: 0, behind: 0, changes: [], truncated: false };
  const recs = raw.split("\0");
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (!r) continue;
    if (r.startsWith("# ")) {
      const [, key, ...rest] = r.split(" ");
      const val = rest.join(" ");
      if (key === "branch.oid") out.oid = val === "(initial)" ? null : val;
      else if (key === "branch.head") out.branch = val === "(detached)" ? null : val;
      else if (key === "branch.upstream") out.upstream = val;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(val);
        if (m) {
          out.ahead = Number(m[1]);
          out.behind = Number(m[2]);
        }
      }
      continue;
    }
    const kind = r[0];
    let change: GitFileChange | null = null;
    if (kind === "1") {
      // 1 XY sub mH mI mW hH hI path
      const f = r.split(" ");
      const xy = f[1] ?? "..";
      change = { path: f.slice(8).join(" "), staged: code(xy[0]), unstaged: code(xy[1]), conflicted: false, sensitive: false };
    } else if (kind === "2") {
      // 2 XY sub mH mI mW hH hI Xscore path \0 origPath
      const f = r.split(" ");
      const xy = f[1] ?? "..";
      const from = recs[++i];
      change = { path: f.slice(9).join(" "), from, staged: code(xy[0]), unstaged: code(xy[1]), conflicted: false, sensitive: false };
    } else if (kind === "u") {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const f = r.split(" ");
      change = { path: f.slice(10).join(" "), staged: "U", unstaged: "U", conflicted: true, sensitive: false };
    } else if (kind === "?") {
      change = { path: r.slice(2), staged: null, unstaged: "?", conflicted: false, sensitive: false };
    }
    if (!change || !change.path) continue;
    change.sensitive = looksSensitive(change.path);
    if (out.changes.length >= MAX_CHANGES) {
      out.truncated = true;
      continue;
    }
    out.changes.push(change);
  }
  out.changes.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: "base" }));
  return out;
}

/** An address without the password or token that may be in it. */
export function publicUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/i, "$1");
}

async function remotes(ctx: GitCtx): Promise<GitRemote[]> {
  const r = await run(ctx, ["remote", "-v"], { timeoutMs: 8000 });
  if (r.code !== 0) return [];
  const seen = new Map<string, string>();
  for (const line of text(r).split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (m && (m[3] === "push" || !seen.has(m[1]))) seen.set(m[1], publicUrl(m[2]));
  }
  return [...seen].map(([name, url]) => ({ name, url }));
}

async function configValue(ctx: GitCtx, key: string): Promise<string | null> {
  const r = await run(ctx, ["config", "--get", key], { timeoutMs: 8000 });
  if (r.code !== 0) return null;
  return text(r).trim() || null;
}

export const emptyStatus = (git: GitStatus["git"]): GitStatus => ({
  git,
  isRepo: false,
  branch: null,
  upstream: null,
  ahead: 0,
  behind: 0,
  hasCommits: false,
  remotes: [],
  changes: [],
  truncated: false,
  identity: { name: null, email: null },
});

export async function status(ctx: GitCtx): Promise<GitStatus> {
  if (!(await isRepoRoot(ctx))) return emptyStatus("ok");
  const r = await ok(ctx, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], { timeoutMs: 25_000 });
  const parsed = parseStatusV2(r.out.toString("utf8"));
  const [rem, name, email] = await Promise.all([remotes(ctx), configValue(ctx, "user.name"), configValue(ctx, "user.email")]);
  return {
    git: "ok",
    isRepo: true,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    hasCommits: parsed.oid !== null,
    remotes: rem,
    changes: parsed.changes,
    truncated: parsed.truncated,
    identity: { name, email },
  };
}

// --- Diff ---------------------------------------------------------------------------------------

const isBinary = (b: Buffer) => b.subarray(0, 8000).includes(0);

/** A file's bytes at a git object name (`HEAD:src/a.ts`, `:src/a.ts`), or null if there isn't one. */
async function blob(ctx: GitCtx, spec: string): Promise<{ data: Buffer | null; tooLarge: boolean }> {
  const r = await run(ctx, ["cat-file", "blob", spec], { maxBytes: MAX_DIFF_BYTES, timeoutMs: 15_000 });
  if (r.truncated) return { data: null, tooLarge: true };
  if (r.code !== 0) return { data: null, tooLarge: false };
  return { data: r.out, tooLarge: false };
}

/** A working-folder file's bytes, read only if it really is inside the folder and isn't a link. */
function readWorking(ctx: GitCtx, rel: string): { data: Buffer | null; tooLarge: boolean; binary: boolean } {
  const root = realCwd(ctx.cwd);
  const abs = path.join(root, ...rel.split("/"));
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return { data: null, tooLarge: false, binary: false };
  }
  // A link's content is where it points, which may be anywhere: show nothing rather than follow it.
  if (st.isSymbolicLink() || !st.isFile()) return { data: null, tooLarge: false, binary: true };
  try {
    const real = fs.realpathSync(abs);
    if (real !== root && !real.startsWith(root + path.sep)) return { data: null, tooLarge: false, binary: true };
  } catch {
    return { data: null, tooLarge: false, binary: false };
  }
  if (st.size > MAX_DIFF_BYTES) return { data: null, tooLarge: true, binary: false };
  const data = fs.readFileSync(abs);
  return { data, tooLarge: false, binary: isBinary(data) };
}

/** The two texts a diff compares: what git has, and what the folder has (or what the index has, for a staged change). */
export async function diffSides(ctx: GitCtx, req: GitDiffRequest, hasCommits: boolean, conflicted = false): Promise<GitDiffSides> {
  const file = cleanRelPath(req.path);
  const from = req.from ? cleanRelPath(req.from) : file;
  const empty = (extra: Partial<GitDiffSides>): GitDiffSides => ({ original: "", modified: "", originalLabel: "", modifiedLabel: "", binary: false, tooLarge: false, ...extra });

  let originalBuf: Buffer | null;
  let modifiedBuf: Buffer | null;
  let originalLabel: string;
  let modifiedLabel: string;

  if (req.mode === "staged") {
    originalLabel = hasCommits ? "HEAD" : "Empty";
    modifiedLabel = "Staged";
    const [a, b] = await Promise.all([hasCommits ? blob(ctx, `HEAD:${from}`) : { data: null, tooLarge: false }, blob(ctx, `:0:${file}`)]);
    if (a.tooLarge || b.tooLarge) return empty({ tooLarge: true, originalLabel, modifiedLabel });
    originalBuf = a.data;
    modifiedBuf = b.data;
  } else {
    originalLabel = conflicted ? "Ours" : "Index";
    modifiedLabel = "Working Tree";
    const a = await blob(ctx, conflicted ? `:2:${file}` : `:0:${file}`);
    const w = readWorking(ctx, file);
    if (a.tooLarge || w.tooLarge) return empty({ tooLarge: true, originalLabel, modifiedLabel });
    if (w.binary) return empty({ binary: true, originalLabel, modifiedLabel });
    originalBuf = a.data;
    modifiedBuf = w.data;
  }
  if ((originalBuf && isBinary(originalBuf)) || (modifiedBuf && isBinary(modifiedBuf))) return empty({ binary: true, originalLabel, modifiedLabel });
  return { original: originalBuf?.toString("utf8") ?? "", modified: modifiedBuf?.toString("utf8") ?? "", originalLabel, modifiedLabel, binary: false, tooLarge: false };
}

// --- Changing -----------------------------------------------------------------------------------

export const DEFAULT_GITIGNORE = ["node_modules", "dist", ".env", ".env.*", "!.env.example", ".DS_Store", "Thumbs.db", "*.log", ""].join("\n");

/** Make the folder a repository on `main`, with a `.gitignore` if it has none. */
export async function init(ctx: GitCtx, branch = "main"): Promise<void> {
  if (await isRepoRoot(ctx)) return;
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.startsWith("-") || branch.includes("..")) throw new GitError("That isn't a branch name.");
  await ok(ctx, ["init", "--quiet"]);
  // `init -b` needs git 2.28; this works on every version and does the same on a repository with no commits.
  await ok(ctx, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
  const ignore = path.join(realCwd(ctx.cwd), ".gitignore");
  try {
    fs.writeFileSync(ignore, DEFAULT_GITIGNORE, { flag: "wx" });
  } catch {
    /* there is one already */
  }
}

export async function stage(ctx: GitCtx, paths: unknown): Promise<void> {
  const list = cleanPaths(paths);
  await ok(ctx, ["add", "-A", "--", ...list], { timeoutMs: 60_000 });
}

/**
 * Stage everything — except new files that look like credentials (`.env`, private keys). Those are
 * left for the person to stage on purpose, and are returned so the page can say so.
 */
export async function stageAll(ctx: GitCtx): Promise<string[]> {
  const before = await status(ctx);
  const risky = before.changes.filter((c) => c.sensitive && c.unstaged === "?").map((c) => c.path);
  await ok(ctx, ["add", "-A"], { timeoutMs: 120_000 });
  if (risky.length) await unstage(ctx, risky);
  return risky;
}

export async function unstage(ctx: GitCtx, paths: unknown): Promise<void> {
  const list = cleanPaths(paths);
  const r = await run(ctx, ["reset", "-q", "--", ...list], { timeoutMs: 60_000 });
  if (r.code === 0) return;
  // Before the first commit there is nothing to reset to; removing from the index is the same thing.
  await ok(ctx, ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...list], { timeoutMs: 60_000 });
}

export async function unstageAll(ctx: GitCtx): Promise<void> {
  const r = await run(ctx, ["reset", "-q"], { timeoutMs: 60_000 });
  if (r.code === 0) return;
  await ok(ctx, ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", "."], { timeoutMs: 60_000 });
}

// --- Branches -----------------------------------------------------------------------------------

/** A branch name git would accept, simplified: no spaces, no `..`, no leading dash or trailing slash/dot/`.lock`. */
export function validateBranch(name: unknown): string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 200 ||
    name.startsWith("-") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.endsWith(".") ||
    name.endsWith(".lock") ||
    name.includes("..") ||
    name.includes("//") ||
    name.includes("@{") ||
    name === "@" ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0020~^:?*[\\\u007f]/.test(name) ||
    name.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  ) {
    throw new GitError("That isn't a branch name git accepts. Use letters, numbers, dashes, dots and slashes.");
  }
  return name;
}

export async function branches(ctx: GitCtx): Promise<string[]> {
  const r = await run(ctx, ["for-each-ref", "--format=%(refname:short)", "--sort=-committerdate", "refs/heads"], { timeoutMs: 15_000 });
  return r.code === 0 ? text(r).split("\n").filter(Boolean) : [];
}

export async function checkout(ctx: GitCtx, branch: unknown, create: boolean, hasCommits: boolean): Promise<void> {
  const name = validateBranch(branch);
  if (create) {
    // With no commits there is no branch to create; naming the branch HEAD points at is the same thing.
    if (!hasCommits) await ok(ctx, ["symbolic-ref", "HEAD", `refs/heads/${name}`]);
    else await ok(ctx, ["checkout", "-b", name], { timeoutMs: 60_000 });
    return;
  }
  const r = await run(ctx, ["checkout", name, "--"], { timeoutMs: 60_000 });
  if (r.code !== 0) {
    const raw = r.err;
    if (/would be overwritten|Please commit your changes or stash/i.test(raw)) {
      throw new GitError("You have changes that would be overwritten by switching branches. Commit or discard them first.");
    }
    throw new GitError(cleanMessage(raw));
  }
}

/** Throw away changes to files in the working folder. A file git has never seen goes to the Trash, not oblivion. */
export async function discard(ctx: GitCtx, paths: unknown): Promise<void> {
  const list = cleanPaths(paths);
  const tracked = new Set(text(await ok(ctx, ["ls-files", "-z", "--", ...list])).split("\0").filter(Boolean));
  const keep = list.filter((p) => tracked.has(p));
  const loose = list.filter((p) => !tracked.has(p));
  if (keep.length) await ok(ctx, ["checkout", "--", ...keep], { timeoutMs: 60_000 });
  if (loose.length) {
    if (!ctx.trash) throw new GitError("Files git doesn't track can't be discarded here.");
    const root = realCwd(ctx.cwd);
    for (const rel of loose) {
      const abs = path.join(root, ...rel.split("/"));
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        continue;
      }
      // Never follow a link out of the folder: trash the link itself or nothing.
      if (!st.isSymbolicLink()) {
        const real = fs.realpathSync(abs);
        if (!real.startsWith(root + path.sep)) throw new GitError("That path isn't valid.");
      }
      await ctx.trash(abs);
    }
  }
}

function cleanIdentity(identity: { name: string; email: string }) {
  const name = String(identity.name ?? "").trim();
  const email = String(identity.email ?? "").trim();
  // eslint-disable-next-line no-control-regex
  const bad = /[\u0000-\u001f<>]/;
  if (!name || name.length > 200 || bad.test(name)) throw new GitError("Enter the name to put on your commits.");
  if (!email || email.length > 200 || bad.test(email) || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new GitError("Enter a valid email address for your commits.");
  return { name, email };
}

export interface CommitResult {
  hash: string;
  summary: string;
}

export async function commit(ctx: GitCtx, message: unknown, identity?: { name: string; email: string }): Promise<CommitResult> {
  if (typeof message !== "string" || message.trim().length === 0) throw new GitError("Write a message describing the change.");
  if (message.length > 20_000) throw new GitError("That message is too long.");
  const staged = await run(ctx, ["diff", "--cached", "--quiet", "--no-ext-diff"], { timeoutMs: 30_000 });
  if (staged.code === 0) throw new GitError("Nothing is staged to commit.", "nothing-staged");
  if (identity) {
    const who = cleanIdentity(identity);
    await ok(ctx, ["config", "--local", "user.name", who.name]);
    await ok(ctx, ["config", "--local", "user.email", who.email]);
  }
  // From stdin, so the text can't be mistaken for an option; whitespace-only cleanup so a line that starts with # is kept.
  const r = await run(ctx, ["commit", "--cleanup=whitespace", "-F", "-"], { input: message, timeoutMs: 120_000 });
  if (r.timedOut) throw new GitError("The commit took too long and was stopped (is a hook waiting for input?).");
  if (r.code !== 0) {
    const raw = `${r.err}\n${text(r)}`;
    if (/Author identity unknown|Please tell me who you are|unable to auto-detect email|empty ident name/i.test(raw)) {
      throw new GitError("Tell git who you are, so the commit can carry your name.", "identity");
    }
    throw new GitError(cleanMessage(r.err || text(r)));
  }
  const head = await run(ctx, ["rev-parse", "--short", "HEAD"], { timeoutMs: 8000 });
  const subject = message.trim().split("\n")[0].slice(0, 200);
  return { hash: text(head).trim(), summary: subject };
}

const REMOTE_HTTPS = /^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/[^\s@]+$/;
const REMOTE_SSH = /^ssh:\/\/([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(:\d{1,5})?\/[^\s]+$/;
const REMOTE_SCP = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/][^\s]*$/;

/** A repository address git is allowed to be pointed at. Not `ext::`, `file:`, or anything starting with a dash. */
export function validateRemoteUrl(url: unknown): string {
  if (typeof url !== "string") throw new GitError("That isn't a repository address.");
  const u = url.trim();
  if (u.length === 0 || u.length > 500 || u.startsWith("-") || !(REMOTE_HTTPS.test(u) || REMOTE_SSH.test(u) || REMOTE_SCP.test(u))) {
    throw new GitError("Use the repository's https:// address, or its SSH address (git@host:owner/name.git).");
  }
  return u;
}

export function validateRemoteName(name: unknown): string {
  if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(name) || name.includes("..") || name.endsWith(".lock")) throw new GitError("That isn't a remote name.");
  return name;
}

export async function setRemote(ctx: GitCtx, name: unknown, url: unknown): Promise<void> {
  const n = validateRemoteName(name);
  const u = validateRemoteUrl(url);
  const have = (await remotes(ctx)).some((r) => r.name === n);
  await ok(ctx, ["remote", have ? "set-url" : "add", n, u]);
}

/** Git's complaints about the network, in words a person can act on. */
export function explainNetworkError(raw: string): GitError {
  const msg = cleanMessage(raw);
  if (/Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey|HTTP Basic: Access denied|Invalid username or password|requested URL returned error: 40[13]/i.test(raw)) {
    return new GitError("The remote didn't accept your sign-in. Connect your GitHub account in Source Control, or set up git credentials (for SSH, add your key to ssh-agent).", "auth");
  }
  if (/non-fast-forward|fetch first|\(behind\)|Updates were rejected/i.test(raw)) {
    return new GitError("The remote has changes you don't have yet. Pull first, then push.", "behind");
  }
  if (/Not possible to fast-forward|diverging branches|have diverged/i.test(raw)) {
    return new GitError("Your copy and the remote have both changed, so they can't be joined automatically. Resolve it in the terminal (git pull --rebase, or git merge).", "diverged");
  }
  if (/Repository not found|does not appear to be a git repository|repository '[^']*' not found/i.test(raw)) {
    return new GitError("That repository wasn't found, or you don't have access to it.");
  }
  if (/Could not resolve host|unable to access|Connection (timed out|refused)|Network is unreachable/i.test(raw)) {
    return new GitError("Couldn't reach the remote. Check your internet connection.");
  }
  if (/Host key verification failed/i.test(raw)) {
    return new GitError("This computer doesn't know that server's SSH key yet. Run `git push` once in the terminal and accept it.");
  }
  return new GitError(msg);
}

export async function push(ctx: GitCtx, st: GitStatus, remote?: string): Promise<void> {
  if (!st.isRepo) throw new GitError("This project isn't a git repository yet.", "not-a-repo");
  if (!st.hasCommits) throw new GitError("Commit something first; there is nothing to push yet.");
  if (!st.branch) throw new GitError("You're not on a branch (HEAD is detached), so there is nothing to push to.");
  const name = remote ? validateRemoteName(remote) : (st.remotes.find((r) => r.name === "origin") ?? st.remotes[0])?.name;
  if (!name) throw new GitError("Add a remote repository first.", "no-remote");
  // With a branch already linked to a remote one, a plain push goes where git was told to send it.
  const args = st.upstream ? ["push"] : ["push", "--set-upstream", name, st.branch];
  const r = await run(ctx, args, { timeoutMs: 300_000, network: true });
  if (r.timedOut) throw new GitError("The push took too long and was stopped.");
  if (r.code !== 0) throw explainNetworkError(r.err);
}

export async function pull(ctx: GitCtx, st: GitStatus): Promise<void> {
  if (!st.isRepo) throw new GitError("This project isn't a git repository yet.", "not-a-repo");
  if (!st.upstream) throw new GitError("This branch isn't linked to a remote branch yet. Push it first.", "no-remote");
  const r = await run(ctx, ["pull", "--ff-only"], { timeoutMs: 300_000, network: true });
  if (r.timedOut) throw new GitError("The pull took too long and was stopped.");
  if (r.code !== 0) throw explainNetworkError(r.err);
}

export async function fetchRemote(ctx: GitCtx): Promise<void> {
  const r = await run(ctx, ["fetch", "--prune"], { timeoutMs: 120_000, network: true });
  if (r.timedOut) throw new GitError("The fetch took too long and was stopped.");
  if (r.code !== 0) throw explainNetworkError(r.err);
}
