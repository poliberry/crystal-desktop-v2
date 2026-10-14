import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { app, clipboard, ipcMain, safeStorage, shell, type IpcMainInvokeEvent, type WebContents } from "electron";

import {
  GitError,
  branches as listBranches,
  checkout,
  commit,
  diffSides,
  discard,
  emptyStatus,
  fetchRemote,
  gitVersion,
  init,
  pull,
  push,
  setRemote,
  stage,
  stageAll,
  status,
  unstage,
  unstageAll,
  type GitCtx,
} from "./gitCore";
import { createGithubClient, githubAuthEnv, validateToken } from "./github";
import { publishToGithub } from "./gitPublish";
import { detectTargets, launchPlan, publicTargets, type Detected, type Probe } from "./openInCore";
import { findOnPath, loginPath } from "./shellEnv";
import type { GitDiffRequest, GitFailure, GitResult, GithubAccount, GithubCreateRepoRequest, GithubTokenSource, OpenInResult } from "./gitTypes";

/**
 * Source control and "Open in…" for Studio's code workbench: the IPC handlers.
 *
 * The rules, because this is where the page asks the computer to run programs:
 *
 *  - Only the Studio window can ask. Every folder arrives as a name relative to Studio's folder and
 *    is resolved by `studioFs` (which refuses anything outside it) before anything is run in it.
 *  - The page never supplies a program, a command or an argument for one. It sends an operation
 *    (`commit`, `push`), file names git is shown after `--`, and ids from lists made here.
 *  - Everything runs as a list of arguments, never through a shell, with a time limit.
 *  - Things that run on their own (status, diff) are hardened in `gitCore.ts`; things that change
 *    something, or touch the network, only run because a person pressed a button.
 *  - A GitHub token is held in the operating system's encrypted storage, only used to talk to
 *    GitHub, and never sent to the page: it sees who it belongs to, not the token.
 */

const TOKEN_FILE = "studio-github-token.bin";

function failure(e: unknown): { ok: false; kind: GitFailure; message: string } {
  if (e instanceof GitError) return { ok: false, kind: e.code ?? "failed", message: e.message };
  const message = e instanceof Error ? e.message : "";
  // Messages from the file layer ("That path isn't valid.") are written for people; anything else isn't shown.
  if (/^That (path|isn't a folder)/.test(message)) return { ok: false, kind: "failed", message };
  return { ok: false, kind: "failed", message: "That didn't work." };
}

export function registerStudioGit(dirPath: (rel: string) => string, isStudio: (sender: WebContents) => boolean) {
  const tokenPath = () => path.join(app.getPath("userData"), TOKEN_FILE);
  const github = createGithubClient();

  // --- Finding git -----------------------------------------------------------------------------

  let gitCache: { path: string | null; at: number } | null = null;
  async function locateGit(): Promise<string | null> {
    if (gitCache && (gitCache.path || Date.now() - gitCache.at < 15_000)) return gitCache.path;
    const pathVar = await loginPath();
    let found = findOnPath("git", pathVar);
    // On a Mac without the developer tools, /usr/bin/git is a stub that pops up an install dialog
    // every time it is run. Studio polls git, so it must not run the stub.
    if (found === "/usr/bin/git" && process.platform === "darwin") {
      const ok = await new Promise<boolean>((resolve) => execFile("/usr/bin/xcode-select", ["-p"], { timeout: 4000 }, (err) => resolve(!err)));
      if (!ok) found = null;
    }
    if (found && !(await gitVersion({ cwd: os.homedir(), git: found, env: { ...process.env, PATH: pathVar } }))) found = null;
    gitCache = { path: found, at: Date.now() };
    return found;
  }

  async function toolEnv(): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: await loginPath() };
    for (const k of Object.keys(env)) if (k.startsWith("ELECTRON_") || k === "NODE_OPTIONS") delete env[k];
    return env;
  }

  async function context(rel: string, secretEnv?: NodeJS.ProcessEnv): Promise<GitCtx> {
    const git = await locateGit();
    if (!git) throw new GitError("Git isn't installed on this computer. Install it from git-scm.com, then try again.", "missing");
    return {
      cwd: dirPath(rel),
      git,
      env: await toolEnv(),
      secretEnv,
      trash: (abs) => shell.trashItem(abs),
    };
  }

  // Two commands changing the same repository at once is how `index.lock` errors happen.
  const queues = new Map<string, Promise<unknown>>();
  function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    queues.set(key, tail);
    void tail.then(() => queues.get(key) === tail && queues.delete(key));
    return next;
  }

  // --- GitHub login ----------------------------------------------------------------------------

  function readSavedToken(): string | null {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(fs.readFileSync(tokenPath()));
    } catch {
      return null;
    }
  }

  async function ghCliToken(): Promise<string | null> {
    const gh = findOnPath("gh", await loginPath());
    if (!gh) return null;
    return new Promise((resolve) => {
      execFile(gh, ["auth", "token"], { timeout: 6000, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } }, (err, stdout) => {
        const t = String(stdout ?? "").trim();
        resolve(!err && /^[A-Za-z0-9_\-.=]{20,255}$/.test(t) ? t : null);
      });
    });
  }

  async function currentToken(): Promise<{ token: string; source: GithubTokenSource } | null> {
    const saved = readSavedToken();
    if (saved) return { token: saved, source: "saved" };
    const cli = await ghCliToken();
    return cli ? { token: cli, source: "gh" } : null;
  }

  async function account(): Promise<GithubAccount | null> {
    const t = await currentToken();
    if (!t) return null;
    try {
      const user = await github.user(t.token);
      return { login: user.login, source: t.source, orgs: await github.orgs(t.token) };
    } catch (e) {
      // A saved token that no longer works is the same as none.
      if (e instanceof GitError && e.code === "auth") return null;
      throw e;
    }
  }

  /** Run a network git command with the GitHub login if there is one; if GitHub turns it down, once more with the person's own git credentials. */
  async function withNetwork<T>(rel: string, fn: (ctx: GitCtx) => Promise<T>): Promise<T> {
    const t = await currentToken();
    if (t) {
      try {
        return await fn(await context(rel, githubAuthEnv(t.token)));
      } catch (e) {
        if (!(e instanceof GitError) || e.code !== "auth") throw e;
      }
    }
    return fn(await context(rel));
  }

  // --- Handlers --------------------------------------------------------------------------------

  const handle = <A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<R>) =>
    ipcMain.handle(channel, async (event, ...args: A): Promise<GitResult<R>> => {
      if (!isStudio(event.sender)) return { ok: false, kind: "failed", message: "Not allowed." };
      try {
        return { ok: true, value: await fn(event, ...args) };
      } catch (e) {
        return failure(e);
      }
    });

  const str = (v: unknown, max = 500): string => {
    if (typeof v !== "string" || v.length > max) throw new GitError("That isn't valid.");
    return v;
  };

  handle("studio:git:status", async (_e, folder: string) => {
    const git = await locateGit();
    if (!git) return emptyStatus("missing");
    return status(await context(str(folder)));
  });
  handle("studio:git:init", async (_e, folder: string) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, async () => {
      await init(ctx);
    });
  });
  handle("studio:git:diff", async (_e, folder: string, req: GitDiffRequest) => {
    const ctx = await context(str(folder));
    if (!req || (req.mode !== "staged" && req.mode !== "unstaged")) throw new GitError("That isn't valid.");
    const st = await status(ctx);
    const entry = st.changes.find((c) => c.path === req.path);
    return diffSides(ctx, { path: str(req.path, 400), from: req.from === undefined ? undefined : str(req.from, 400), mode: req.mode }, st.hasCommits, !!entry?.conflicted);
  });
  handle("studio:git:stage", async (_e, folder: string, paths: string[]) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => stage(ctx, paths));
  });
  handle("studio:git:stageAll", async (_e, folder: string) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => stageAll(ctx));
  });
  handle("studio:git:unstage", async (_e, folder: string, paths: string[]) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => unstage(ctx, paths));
  });
  handle("studio:git:unstageAll", async (_e, folder: string) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => unstageAll(ctx));
  });
  handle("studio:git:discard", async (_e, folder: string, paths: string[]) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => discard(ctx, paths));
  });
  handle("studio:git:commit", async (_e, folder: string, message: string, identity?: { name: string; email: string }) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => commit(ctx, message, identity));
  });
  handle("studio:git:push", async (_e, folder: string) => {
    const probe = await context(str(folder));
    return serial(probe.cwd, () =>
      withNetwork(folder, async (ctx) => {
        await push(ctx, await status(ctx));
      }),
    );
  });
  handle("studio:git:pull", async (_e, folder: string) => {
    const probe = await context(str(folder));
    return serial(probe.cwd, () =>
      withNetwork(folder, async (ctx) => {
        await pull(ctx, await status(ctx));
      }),
    );
  });
  handle("studio:git:fetch", async (_e, folder: string) => {
    const probe = await context(str(folder));
    return serial(probe.cwd, () => withNetwork(folder, (ctx) => fetchRemote(ctx)));
  });
  handle("studio:git:setRemote", async (_e, folder: string, url: string) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => setRemote(ctx, "origin", url));
  });
  handle("studio:git:branches", async (_e, folder: string) => listBranches(await context(str(folder))));
  handle("studio:git:checkout", async (_e, folder: string, branch: string, create: boolean) => {
    const ctx = await context(str(folder));
    return serial(ctx.cwd, async () => {
      const st = await status(ctx);
      await checkout(ctx, branch, !!create, st.hasCommits);
    });
  });

  handle("studio:github:account", async () => account());
  handle("studio:github:connect", async (_e, token: string) => {
    const clean = validateToken(token);
    // Check it works before keeping it, so a typo is caught here and not at the next push.
    const user = await github.user(clean);
    if (!safeStorage.isEncryptionAvailable()) {
      throw new GitError("This computer can't store the token securely. Sign in with the GitHub CLI instead (gh auth login), or set it up in your terminal.");
    }
    fs.mkdirSync(path.dirname(tokenPath()), { recursive: true });
    fs.writeFileSync(tokenPath(), safeStorage.encryptString(clean), { mode: 0o600 });
    const result: GithubAccount = { login: user.login, source: "saved", orgs: await github.orgs(clean) };
    return result;
  });
  handle("studio:github:disconnect", async () => {
    fs.rmSync(tokenPath(), { force: true });
  });
  handle("studio:github:publish", async (_e, folder: string, req: GithubCreateRepoRequest) => {
    const t = await currentToken();
    if (!t) throw new GitError("Connect your GitHub account first.", "auth");
    if (!req || typeof req !== "object") throw new GitError("That isn't valid.");
    const clean: GithubCreateRepoRequest = {
      name: str(req.name, 120),
      description: req.description === undefined ? undefined : str(req.description, 500),
      private: !!req.private,
      owner: req.owner === undefined ? undefined : str(req.owner, 60),
      commitMessage: req.commitMessage === undefined ? undefined : str(req.commitMessage, 2000),
      identity: req.identity ? { name: str(req.identity.name, 200), email: str(req.identity.email, 200) } : undefined,
    };
    const ctx = await context(str(folder));
    return serial(ctx.cwd, () => publishToGithub(ctx, github, t.token, clean));
  });

  // --- Open in… --------------------------------------------------------------------------------

  const probe = async (): Promise<Probe> => ({
    platform: process.platform,
    home: os.homedir(),
    pathVar: await loginPath(),
    exists: (p) => fs.existsSync(p),
    list: (dir) => {
      try {
        return fs.readdirSync(dir);
      } catch {
        return [];
      }
    },
    env: { LOCALAPPDATA: process.env.LOCALAPPDATA, ProgramFiles: process.env.ProgramFiles, "ProgramFiles(x86)": process.env["ProgramFiles(x86)"] },
  });

  let targetCache: { at: number; list: Detected[] } | null = null;
  async function targets(): Promise<Detected[]> {
    if (targetCache && Date.now() - targetCache.at < 20_000) return targetCache.list;
    const list = detectTargets(await probe());
    targetCache = { at: Date.now(), list };
    return list;
  }

  handle("studio:openIn:list", async () => publicTargets(await targets()));
  handle("studio:openIn:open", async (_e, folder: string, id: string): Promise<OpenInResult> => {
    const abs = dirPath(str(folder));
    const chosen = (await targets()).find((t) => t.id === id);
    if (!chosen) throw new GitError("That program isn't available any more.");
    if (chosen.launch.how === "terminal") throw new GitError(`${chosen.label} runs in a terminal inside Studio.`);
    const { file, args } = launchPlan(chosen, abs, process.platform);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(file, args, { detached: true, stdio: "ignore", windowsHide: true, env: plainEnv() });
      child.once("error", () => reject(new GitError(`${chosen.label} couldn't be started.`)));
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    if (chosen.launch.how === "open-app" && chosen.launch.copiesPath) {
      clipboard.writeText(abs);
      return { message: `${chosen.label} has no way to be opened on a folder, so the folder's path is on your clipboard: use Add project there and paste it.` };
    }
    return {};
  });

  /** A plain environment for starting someone else's program: not Electron's own variables. */
  function plainEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("ELECTRON_") || k === "NODE_OPTIONS") delete env[k];
    return env;
  }
}
