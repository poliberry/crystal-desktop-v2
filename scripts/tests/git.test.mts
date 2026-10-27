import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  GitError,
  branches,
  checkout,
  cleanMessage,
  cleanRelPath,
  commit,
  diffSides,
  discard,
  fetchRemote,
  init,
  isRepoRoot,
  looksSensitive,
  parseStatusV2,
  publicUrl,
  pull,
  push,
  scrubSecrets,
  setRemote,
  stage,
  stageAll,
  status,
  unstage,
  validateBranch,
  validateRemoteUrl,
  type GitCtx,
} from "../../electron/gitCore";
import { createGithubClient, githubAuthEnv, githubRepoOf, validateOwner, validateRepoName, validateToken } from "../../electron/github";
import { publishToGithub } from "../../electron/gitPublish";
import { detectTargets, launchPlan, publicTargets, type Probe } from "../../electron/openInCore";
import { findOnPath, mergePaths, parseMarkedPath } from "../../electron/shellEnv";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d))); };
const throws = async (n: string, fn: () => unknown, code?: string) => {
  try { await fn(); ok(n + " (should have thrown)", false); } catch (e) { ok(n, !code || (e instanceof GitError && e.code === code), e instanceof GitError ? { code: e.code, m: e.message } : String(e)); }
};

// git must exist to test git; without it say so loudly rather than pass.
try { execFileSync("git", ["--version"], { stdio: "pipe" }); } catch { console.log("git is not installed; cannot run these tests"); process.exit(1); }

const root = realpathSync(mkdtempSync(join(tmpdir(), "studio-git-")));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

/** Git's own settings are the user's; tests get none of them, and a fixed identity unless they ask for none. */
const cleanEnv = (identity: boolean): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: root,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  ...(identity
    ? { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.com" }
    : { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.useConfigOnly", GIT_CONFIG_VALUE_0: "true" }),
});
const trashed: string[] = [];
const ctxFor = (cwd: string, identity = true): GitCtx => ({ cwd, git: "git", env: cleanEnv(identity), trash: async (abs) => { trashed.push(abs); rmSync(abs, { recursive: true, force: true }); } });
const folder = (name: string) => { const d = join(root, name); mkdirSync(d, { recursive: true }); return d; };
const write = (dir: string, rel: string, text: string) => { const abs = join(dir, rel); mkdirSync(join(abs, ".."), { recursive: true }); writeFileSync(abs, text); };
const raw = (dir: string, ...args: string[]) => execFileSync("git", args, { cwd: dir, env: cleanEnv(true) as NodeJS.ProcessEnv, encoding: "utf8" }).trim();

// --- parseStatusV2 ------------------------------------------------------------------------------
{
  const z = (...r: string[]) => r.join("\0") + "\0";
  const s = parseStatusV2(z(
    "# branch.oid 1234567890abcdef",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 aaaa bbbb src/index.ts",
    "1 M. N... 100644 100644 100644 aaaa bbbb README.md",
    "1 AM N... 000000 100644 100644 0000 bbbb my notes.txt",
    "2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.ts", "old name.ts",
    "u UU N... 100644 100644 100644 100644 a b c conflict.ts",
    "1 .D N... 100644 100644 000000 aaaa bbbb gone.ts",
    "? .env",
    "? docs/new.md",
  ));
  ok("branch", s.branch === "main" && s.upstream === "origin/main", s);
  ok("ahead/behind", s.ahead === 2 && s.behind === 1);
  ok("has a head", s.oid === "1234567890abcdef");
  const by = (path: string) => s.changes.find((c) => c.path === path);
  ok("unstaged modification", by("src/index.ts")?.unstaged === "M" && by("src/index.ts")?.staged === null, by("src/index.ts"));
  ok("staged modification", by("README.md")?.staged === "M" && by("README.md")?.unstaged === null);
  ok("both sides, path with a space", by("my notes.txt")?.staged === "A" && by("my notes.txt")?.unstaged === "M");
  ok("rename keeps where it came from", by("new name.ts")?.staged === "R" && by("new name.ts")?.from === "old name.ts", by("new name.ts"));
  ok("the old name of a rename is not its own entry", !by("old name.ts"));
  ok("conflict", by("conflict.ts")?.conflicted === true);
  ok("deleted in the working folder", by("gone.ts")?.unstaged === "D");
  ok("untracked", by(".env")?.unstaged === "?" && by("docs/new.md")?.unstaged === "?");
  ok(".env is flagged as sensitive", by(".env")?.sensitive === true && by("docs/new.md")?.sensitive === false);

  const detached = parseStatusV2(z("# branch.oid abc", "# branch.head (detached)"));
  ok("detached HEAD has no branch", detached.branch === null && detached.oid === "abc");
  const fresh = parseStatusV2(z("# branch.oid (initial)", "# branch.head main"));
  ok("no commits yet", fresh.oid === null && fresh.branch === "main");
  const huge = parseStatusV2(z("# branch.head main", ...Array.from({ length: 2100 }, (_, i) => `? f${i}.txt`)));
  ok("a huge list is cut and says so", huge.truncated && huge.changes.length === 2000);
}

// --- Things from the page are checked ------------------------------------------------------------
{
  for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", ".git/config", "a/.GIT/hooks", "a\\b", "C:/x", "a\0b", "a/./b", "x".repeat(401)]) {
    await throws(`path ${JSON.stringify(bad.slice(0, 20))} refused`, () => cleanRelPath(bad));
  }
  ok("an ordinary path is fine", cleanRelPath("src/a b/c.ts") === "src/a b/c.ts");
  ok("a path that looks like a flag is a file, not a flag", cleanRelPath("-rf") === "-rf");

  for (const good of ["https://github.com/o/r.git", "https://gitlab.com/o/r", "git@github.com:o/r.git", "ssh://git@host.example:2222/o/r.git"]) ok(`remote ${good} allowed`, validateRemoteUrl(good) === good);
  for (const bad of ["ext::sh -c 'touch /tmp/x'", "file:///etc", "/local/path", "-oProxyCommand=evil", "--upload-pack=evil", "https://user:pw@github.com/o/r.git", "http://github.com/o/r.git", "https://github.com/o/r.git extra", "", "javascript:alert(1)", "git@github.com:o/r.git\nfoo"]) {
    await throws(`remote ${JSON.stringify(bad.slice(0, 30))} refused`, () => validateRemoteUrl(bad));
  }
  for (const bad of ["", "-x", "a b", "a..b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "/a", "a/", "a.", "a.lock", "a//b", "a@{b", "@", ".hidden", "a/.hidden", "x".repeat(201)]) {
    await throws(`branch ${JSON.stringify(bad.slice(0, 20))} refused`, () => validateBranch(bad));
  }
  ok("branch names with slashes and dots are fine", validateBranch("feature/new-thing_1.2") === "feature/new-thing_1.2");

  ok("a password in an address is hidden", publicUrl("https://me:secret@github.com/o/r.git") === "https://github.com/o/r.git");
  ok("a token in an address is hidden", publicUrl("https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r.git") === "https://github.com/o/r.git");
  ok("a token in text is hidden", !scrubSecrets("failed with ghp_abcdefghijklmnopqrstuvwxyz0123456789 ok").includes("ghp_"));
  ok("a fine-grained token is hidden", !scrubSecrets("github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz").includes("github_pat_"));
  ok("git's prefixes are dropped and hints removed", cleanMessage("fatal: not a thing\nhint: do something\nerror: it broke\n") === "not a thing\nit broke");

  for (const s of [".env", "app/.env", ".env.local", ".env.production", "id_rsa", "keys/server.pem", "x.key", "a/b/cert.p12", ".npmrc", "credentials.json"]) ok(`${s} is sensitive`, looksSensitive(s));
  for (const s of [".env.example", ".env.sample", "src/env.ts", "README.md", "monkey.ts", "keyboard.ts", "public.pub"]) ok(`${s} is not sensitive`, !looksSensitive(s));

  ok("repo names", validateRepoName("my-repo_1.0") === "my-repo_1.0");
  for (const bad of ["", ".", "..", "a b", "a/b", "x.git", "x".repeat(101), "é"]) await throws(`repo name ${JSON.stringify(bad.slice(0, 12))} refused`, () => validateRepoName(bad));
  ok("owner can be omitted", validateOwner(undefined) === undefined && validateOwner("") === undefined);
  for (const bad of ["a/b", "-x", "a b", "x".repeat(40)]) await throws(`owner ${JSON.stringify(bad.slice(0, 12))} refused`, () => validateOwner(bad));
  await throws("a token with a space is refused", () => validateToken("ghp_abc def"));
  await throws("a short token is refused", () => validateToken("abc"));
  ok("a token is trimmed", validateToken("  ghp_abcdefghijklmnopqrstuvwxyz0123  ") === "ghp_abcdefghijklmnopqrstuvwxyz0123");
  ok("github repo from address", githubRepoOf("https://github.com/o/r.git") === "o/r" && githubRepoOf("https://github.com/o/r") === "o/r" && githubRepoOf("git@github.com:o/r.git") === null && githubRepoOf("https://evil.com/github.com/o/r") === null);
  const env = githubAuthEnv("tok_abcdefghijklmnopqrstuvwxyz");
  ok("token goes to github.com only, via environment", env.GIT_CONFIG_KEY_0 === "http.https://github.com/.extraheader" && /^AUTHORIZATION: basic /.test(env.GIT_CONFIG_VALUE_0 ?? "") && env.GIT_CONFIG_COUNT === "2");
}

// --- A real repository, from nothing to committed -----------------------------------------------
{
  const dir = folder("project");
  write(dir, "src/index.ts", "export const a = 1;\n");
  write(dir, "README.md", "# hi\n");
  write(dir, ".env", "SECRET=1\n");
  const ctx = ctxFor(dir);

  const before = await status(ctx);
  ok("not a repository yet", before.git === "ok" && !before.isRepo && before.changes.length === 0);

  await init(ctx);
  ok("init makes the folder a repository", await isRepoRoot(ctx));
  ok(".gitignore added", existsSync(join(dir, ".gitignore")) && readFileSync(join(dir, ".gitignore"), "utf8").includes(".env"));
  await init(ctx); // twice is harmless
  ok("init is idempotent", (await status(ctx)).isRepo);

  let st = await status(ctx);
  ok("starts on main with no commits", st.branch === "main" && !st.hasCommits, st);
  ok("a .gitignored .env isn't listed", !st.changes.some((c) => c.path === ".env"));
  ok("new files are untracked", st.changes.some((c) => c.path === "src/index.ts" && c.unstaged === "?"));

  await throws("nothing staged can't be committed", () => commit(ctx, "x"), "nothing-staged");
  await stage(ctx, ["README.md"]);
  st = await status(ctx);
  ok("staging moves a file to staged", st.changes.find((c) => c.path === "README.md")?.staged === "A" && st.changes.find((c) => c.path === "README.md")?.unstaged === null, st.changes);
  await unstage(ctx, ["README.md"]);
  ok("unstaging before the first commit works", (await status(ctx)).changes.find((c) => c.path === "README.md")?.unstaged === "?");

  const lonely = ctxFor(dir, false);
  await stage(ctx, ["README.md"]);
  await throws("a commit with no identity asks who you are", () => commit(lonely, "first"), "identity");
  const made = await commit(lonely, "first", { name: "Ada", email: "ada@example.com" });
  ok("giving an identity lets the commit through", /^[0-9a-f]{4,}$/.test(made.hash) && made.summary === "first", made);
  ok("the identity is remembered for the project", (await status(ctx)).identity.name === "Ada");
  ok("author is recorded", raw(dir, "log", "-1", "--format=%an <%ae>") === "Ada <ada@example.com>");

  await throws("blank commit messages are refused", () => commit(ctx, "   "));
  ok("committed state", (await status(ctx)).hasCommits);

  // Modify, diff, discard.
  write(dir, "README.md", "# hi\nmore\n");
  st = await status(ctx);
  ok("modification is unstaged", st.changes.find((c) => c.path === "README.md")?.unstaged === "M");
  let d = await diffSides(ctx, { path: "README.md", mode: "unstaged" }, true);
  ok("unstaged diff: index vs folder", d.original === "# hi\n" && d.modified === "# hi\nmore\n" && d.originalLabel === "Index" && d.modifiedLabel === "Working Tree", d);
  await stage(ctx, ["README.md"]);
  d = await diffSides(ctx, { path: "README.md", mode: "staged" }, true);
  ok("staged diff: HEAD vs index", d.original === "# hi\n" && d.modified === "# hi\nmore\n" && d.originalLabel === "HEAD", d);
  write(dir, "README.md", "# hi\nmore\neven more\n");
  d = await diffSides(ctx, { path: "README.md", mode: "unstaged" }, true);
  ok("unstaged diff after staging compares the index", d.original === "# hi\nmore\n" && d.modified === "# hi\nmore\neven more\n", d);
  await discard(ctx, ["README.md"]);
  ok("discard restores the staged version", readFileSync(join(dir, "README.md"), "utf8") === "# hi\nmore\n");
  await commit(ctx, "more");

  // New and deleted files.
  write(dir, "scratch.txt", "temp\n");
  d = await diffSides(ctx, { path: "scratch.txt", mode: "unstaged" }, true);
  ok("an untracked file diffs against nothing", d.original === "" && d.modified === "temp\n");
  await discard(ctx, ["scratch.txt"]);
  ok("discarding an untracked file moves it to the Trash", !existsSync(join(dir, "scratch.txt")) && trashed.some((t) => t.endsWith("scratch.txt")), trashed);
  rmSync(join(dir, "README.md"));
  ok("deletion is seen", (await status(ctx)).changes.find((c) => c.path === "README.md")?.unstaged === "D");
  d = await diffSides(ctx, { path: "README.md", mode: "unstaged" }, true);
  ok("a deleted file diffs to nothing", d.original === "# hi\nmore\n" && d.modified === "");
  await discard(ctx, ["README.md"]);
  ok("discarding a deletion brings the file back", existsSync(join(dir, "README.md")));

  // Rename.
  raw(dir, "mv", "README.md", "GUIDE.md");
  st = await status(ctx);
  const ren = st.changes.find((c) => c.path === "GUIDE.md");
  ok("a rename is one change with its origin", ren?.staged === "R" && ren?.from === "README.md", st.changes);
  d = await diffSides(ctx, { path: "GUIDE.md", from: "README.md", mode: "staged" }, true);
  ok("a staged rename compares with the old name", d.original === "# hi\nmore\n" && d.modified === "# hi\nmore\n", d);
  raw(dir, "reset", "-q", "--hard");

  // Binary and big.
  writeFileSync(join(dir, "pic.bin"), Buffer.from([0x89, 0x50, 0x00, 0x01, 0x02]));
  d = await diffSides(ctx, { path: "pic.bin", mode: "unstaged" }, true);
  ok("binary files aren't shown", d.binary && d.original === "" && d.modified === "");
  writeFileSync(join(dir, "big.txt"), "x".repeat(2 * 1024 * 1024 + 10));
  d = await diffSides(ctx, { path: "big.txt", mode: "unstaged" }, true);
  ok("huge files aren't shown", d.tooLarge && d.modified === "");
  rmSync(join(dir, "pic.bin"));
  rmSync(join(dir, "big.txt"));

  // A link must never be followed out of the project.
  writeFileSync(join(root, "outside.txt"), "TOP SECRET\n");
  symlinkSync(join(root, "outside.txt"), join(dir, "link.txt"));
  d = await diffSides(ctx, { path: "link.txt", mode: "unstaged" }, true);
  ok("a symbolic link's target isn't read", !d.modified.includes("TOP SECRET") && !d.original.includes("TOP SECRET"), d);
  await discard(ctx, ["link.txt"]);
  ok("discarding a link removes the link, not what it points at", !existsSync(join(dir, "link.txt")) && existsSync(join(root, "outside.txt")));

  // Secrets are held back from "stage all".
  // (.env and .env.* are in the .gitignore init writes, so git never lists them; these are the ones it doesn't know to ignore.)
  write(dir, "id_rsa", "PRIVATE\n");
  write(dir, "key.pem", "-----BEGIN PRIVATE KEY-----\n");
  write(dir, "src/more.ts", "export {};\n");
  const held = await stageAll(ctx);
  st = await status(ctx);
  ok("stage all reports what it held back", held.sort().join() === "id_rsa,key.pem", held);
  ok("…and doesn't stage it", st.changes.find((c) => c.path === "id_rsa")?.staged === null && st.changes.find((c) => c.path === "key.pem")?.staged === null);
  ok("…but stages the rest", st.changes.find((c) => c.path === "src/more.ts")?.staged === "A");
  await stage(ctx, ["id_rsa"]);
  ok("a person can still stage one on purpose", (await status(ctx)).changes.find((c) => c.path === "id_rsa")?.staged === "A");
  await unstage(ctx, ["id_rsa", "key.pem"]);
  await stage(ctx, ["src/more.ts"]);
  await commit(ctx, "more files");
  rmSync(join(dir, "id_rsa"));
  rmSync(join(dir, "key.pem"));

  // Branches.
  await checkout(ctx, "feature/x", true, true);
  st = await status(ctx);
  ok("new branch is current", st.branch === "feature/x");
  ok("branches are listed", (await branches(ctx)).sort().join() === "feature/x,main", await branches(ctx));
  write(dir, "feat.txt", "f\n");
  await stage(ctx, ["feat.txt"]);
  await commit(ctx, "feat");
  await checkout(ctx, "main", false, true);
  ok("switching back", (await status(ctx)).branch === "main" && !existsSync(join(dir, "feat.txt")));
  write(dir, "src/index.ts", "export const a = 2;\n");
  await throws("an unknown branch is an error", () => checkout(ctx, "nope", false, true));
  await throws("a flag is not a branch", () => checkout(ctx, "--orphan", false, true));
  raw(dir, "checkout", "--", "src/index.ts");
}

// --- Folders that aren't a project's own repository ----------------------------------------------
{
  const parent = folder("parent");
  raw(parent, "init", "-q");
  const child = join(parent, "child");
  mkdirSync(child);
  write(child, "a.txt", "a\n");
  const st = await status(ctx(child));
  ok("a repository in a parent folder isn't this project's", !st.isRepo && st.changes.length === 0, st);
  await init(ctx(child));
  const st2 = await status(ctx(child));
  ok("…and init makes the project its own", st2.isRepo && st2.changes.some((c) => c.path === "a.txt"));
  function ctx(dir: string) { return ctxFor(dir); }
}

// --- A repository can't make reading it run code -------------------------------------------------
{
  const dir = folder("hostile");
  const c = ctxFor(dir);
  await init(c);
  write(dir, "a.txt", "a\n");
  await stage(c, ["a.txt"]);
  await commit(c, "a");
  const marker = join(root, "PWNED");
  write(dir, "evil.sh", `#!/bin/sh\ntouch "${marker}"\nexit 0\n`);
  execFileSync("chmod", ["+x", join(dir, "evil.sh")]);
  raw(dir, "config", "core.fsmonitor", join(dir, "evil.sh"));
  raw(dir, "config", "diff.external", join(dir, "evil.sh"));
  raw(dir, "config", "diff.evil.textconv", join(dir, "evil.sh"));
  write(dir, ".gitattributes", "*.txt diff=evil\n");
  write(dir, "a.txt", "changed\n");
  await status(c);
  await diffSides(c, { path: "a.txt", mode: "unstaged" }, true);
  ok("status and diff don't run a file-system monitor, external diff or text filter", !existsSync(marker));

  // A file named like pathspec magic is just a file.
  const lit = folder("literal");
  const lc = ctxFor(lit);
  await init(lc);
  write(lit, "a.txt", "a\n");
  write(lit, "*", "star\n");
  write(lit, ":(exclude)a.txt", "magic\n");
  await stage(lc, ["*"]);
  let ls = await status(lc);
  ok("'*' stages only the file called *", ls.changes.find((x) => x.path === "*")?.staged === "A" && ls.changes.find((x) => x.path === "a.txt")?.staged === null, ls.changes);
  await stage(lc, [":(exclude)a.txt"]);
  ls = await status(lc);
  ok("pathspec magic in a name is not interpreted", ls.changes.find((x) => x.path === ":(exclude)a.txt")?.staged === "A" && ls.changes.find((x) => x.path === "a.txt")?.staged === null, ls.changes);
}

// --- Remotes: push, fetch, pull -----------------------------------------------------------------
{
  const bare = folder("remote.git");
  raw(bare, "init", "-q", "--bare");
  raw(bare, "symbolic-ref", "HEAD", "refs/heads/main");
  const dir = folder("local");
  const c = ctxFor(dir);
  await init(c);
  write(dir, "a.txt", "1\n");
  await stageAll(c);
  await commit(c, "one");

  let st = await status(c);
  await throws("pushing with no remote says to add one", () => push(c, st), "no-remote");
  await throws("an address that runs a command is refused", () => setRemote(c, "origin", "ext::sh -c touch% /tmp/pwned"));
  await throws("a remote name that is a flag is refused", () => setRemote(c, "--upload-pack=x", "https://github.com/o/r.git"));
  await setRemote(c, "origin", "https://github.com/o/r.git");
  st = await status(c);
  ok("remote is listed", st.remotes.length === 1 && st.remotes[0].url === "https://github.com/o/r.git");
  await setRemote(c, "origin", "https://gitlab.com/o/r.git");
  ok("changing the remote replaces it", (await status(c)).remotes[0].url === "https://gitlab.com/o/r.git");
  raw(dir, "remote", "set-url", "origin", bare); // a local path stands in for a server

  await push(c, await status(c));
  st = await status(c);
  ok("first push links the branch", st.upstream === "origin/main" && st.ahead === 0 && st.behind === 0, st);
  ok("the remote has the commit", raw(bare, "log", "-1", "--format=%s", "main") === "one");

  write(dir, "a.txt", "2\n");
  await stageAll(c);
  await commit(c, "two");
  st = await status(c);
  ok("ahead after a local commit", st.ahead === 1);
  await push(c, st);
  ok("second push", raw(bare, "log", "-1", "--format=%s", "main") === "two" && (await status(c)).ahead === 0);

  // Someone else pushes.
  const other = folder("other");
  raw(root, "clone", "-q", bare, other);
  write(other, "b.txt", "b\n");
  raw(other, "add", "-A");
  execFileSync("git", ["-c", "user.name=O", "-c", "user.email=o@example.com", "commit", "-q", "-m", "theirs"], { cwd: other });
  raw(other, "push", "-q", "origin", "HEAD:main");

  await fetchRemote(c);
  st = await status(c);
  ok("fetch shows how far behind", st.behind === 1 && st.ahead === 0, st);
  await pull(c, st);
  ok("pull fast-forwards", existsSync(join(dir, "b.txt")) && (await status(c)).behind === 0);

  // Now diverge.
  write(other, "c.txt", "c\n");
  raw(other, "add", "-A");
  execFileSync("git", ["-c", "user.name=O", "-c", "user.email=o@example.com", "commit", "-q", "-m", "theirs 2"], { cwd: other });
  raw(other, "push", "-q", "origin", "HEAD:main");
  write(dir, "d.txt", "d\n");
  await stageAll(c);
  await commit(c, "mine");
  await fetchRemote(c);
  st = await status(c);
  ok("diverged: one ahead, one behind", st.ahead === 1 && st.behind === 1, st);
  await throws("a push the remote would reject is explained", () => push(c, st), "behind");
  await throws("a pull that can't fast-forward is explained", () => pull(c, st), "diverged");

  const nowhere = folder("nowhere");
  const nc = ctxFor(nowhere);
  await init(nc);
  write(nowhere, "a", "a");
  await stageAll(nc);
  await commit(nc, "x");
  raw(nowhere, "remote", "add", "origin", "https://127.0.0.1:1/o/r.git");
  try {
    await push(nc, await status(nc));
    ok("unreachable remote should fail", false);
  } catch (e) {
    ok("an unreachable remote is explained without credentials or stack", e instanceof GitError && /reach|wasn't found|access/i.test(e.message), e instanceof GitError ? e.message : String(e));
  }
}

// --- GitHub client against a stub ---------------------------------------------------------------
{
  const calls: { url: string; method: string; auth: string | null; body: unknown }[] = [];
  const reply = (status: number, json: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(json), { status, headers });
  let next: (url: string, method: string, body: unknown) => Response = () => reply(500, {});
  const fake = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", auth: new Headers(init?.headers).get("authorization"), body });
    return next(url, init?.method ?? "GET", body);
  }) as typeof fetch;
  const gh = createGithubClient(fake, "https://stub.test");
  const T = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";

  next = () => reply(200, { login: "octo" }, { "x-oauth-scopes": "repo, read:org" });
  const u = await gh.user(T);
  ok("user and scopes", u.login === "octo" && u.scopes?.join() === "repo,read:org", u);
  ok("token goes in the Authorization header", calls[0].auth === `Bearer ${T}` && calls[0].url === "https://stub.test/user");
  next = () => reply(200, { login: "octo" });
  ok("a fine-grained token reports no scopes", (await gh.user(T)).scopes === null);
  next = () => reply(401, { message: "Bad credentials" });
  await throws("a bad token is an auth error", () => gh.user(T), "auth");
  next = () => reply(200, [{ login: "acme" }, { login: "globex" }]);
  ok("orgs", (await gh.orgs(T)).join() === "acme,globex");
  next = () => reply(500, {});
  ok("orgs failing is an empty list", (await gh.orgs(T)).length === 0);

  calls.length = 0;
  next = () => reply(201, { full_name: "octo/app", clone_url: "https://github.com/octo/app.git", html_url: "https://github.com/octo/app" });
  const r = await gh.createRepo(T, { name: "app", description: "line1\nline2", private: true });
  ok("created", r.cloneUrl === "https://github.com/octo/app.git" && r.htmlUrl === "https://github.com/octo/app");
  ok("posted to the user's repos, private, one-line description", calls[0].url === "https://stub.test/user/repos" && calls[0].method === "POST" && (calls[0].body as { private: boolean; description: string }).private === true && (calls[0].body as { description: string }).description === "line1 line2", calls[0]);
  await gh.createRepo(T, { name: "app", private: false, owner: "acme" });
  ok("under an organisation", calls[1].url === "https://stub.test/orgs/acme/repos");
  next = () => reply(422, { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] });
  await throws("a taken name is explained", () => gh.createRepo(T, { name: "app", private: true }));
  next = () => reply(403, { message: "nope" });
  await throws("a token without the scope is explained", () => gh.createRepo(T, { name: "app", private: true }), "auth");
  await throws("a bad name never reaches GitHub", () => gh.createRepo(T, { name: "a/b", private: true }));
  ok("no request for a bad name", calls.length === 4, calls.length);

  // The whole publish, with the push going nowhere.
  const pubDir = folder("publish");
  write(pubDir, "src/index.ts", "export {};\n");
  write(pubDir, ".env", "SECRET=1\n");
  // .env is ignored by the .gitignore init makes, so use a name that isn't.
  write(pubDir, "server.pem", "KEY\n");
  const pc = ctxFor(pubDir, false);
  next = () => reply(201, { full_name: "octo/app", clone_url: "https://127.0.0.1:1/octo/app.git", html_url: "https://github.com/octo/app" });
  calls.length = 0;
  await throws("publishing with no identity asks for one", () => publishToGithub(pc, gh, T, { name: "app", private: true }), "identity");
  ok("…and nothing was created online", calls.length === 0);
  ok("…but the project is now a repository", await isRepoRoot(pc));
  const res = await publishToGithub(pc, gh, T, { name: "app", private: true, identity: { name: "Ada", email: "ada@example.com" }, commitMessage: "Start" });
  const after = await status(pc);
  ok("publish made the first commit", after.hasCommits && raw(pubDir, "log", "-1", "--format=%s") === "Start");
  ok("publish held back the key", res.skipped.includes("server.pem") && !raw(pubDir, "ls-files").includes("server.pem"), res);
  ok("publish created the repo and set origin", calls.length === 1 && after.remotes[0]?.name === "origin" && after.remotes[0].url === "https://127.0.0.1:1/octo/app.git", { calls: calls.length, remotes: after.remotes });
  ok("a failed push after creating is reported, not thrown", typeof res.pushError === "string" && res.url === "https://github.com/octo/app", res);
  ok("the token isn't in the saved repository settings", !readFileSync(join(pubDir, ".git", "config"), "utf8").includes(T));
  await throws("publishing again is refused: there's a remote", () => publishToGithub(pc, gh, T, { name: "app2", private: true }));

  const emptyDir = folder("empty-publish");
  await throws("an empty project can't be published", () => publishToGithub(ctxFor(emptyDir), gh, T, { name: "x", private: true }));
}

// --- Open in… -----------------------------------------------------------------------------------
{
  const has = (set: string[]) => (p: string) => set.includes(p);
  const probe = (over: Partial<Probe> & { files?: string[]; dirs?: Record<string, string[]> }): Probe => ({
    platform: "darwin",
    home: "/Users/me",
    pathVar: "/usr/bin:/Users/me/.local/bin",
    exists: has(over.files ?? []),
    list: (d) => over.dirs?.[d] ?? [],
    env: {},
    ...over,
  });

  const mac = detectTargets(probe({
    files: [
      "/Applications/Zed.app", "/Applications/Cursor.app", "/Users/me/Applications/Visual Studio Code.app", "/Applications/Codex.app",
      "/Users/me/.local/bin/claude", "/Users/me/.local/bin/codex",
    ],
    dirs: { "/Applications": ["Zed.app", "Cursor.app", "Codex.app", "T3 Code (Nightly).app", "Safari.app"] },
  }));
  const ids = mac.map((t) => t.id);
  ok("finds editors by bundle in either Applications folder", ["vscode", "cursor", "zed"].every((i) => ids.includes(i)), ids);
  ok("doesn't invent ones that aren't there", !ids.includes("windsurf") && !ids.includes("kiro"));
  ok("finds T3 Code by its channel name", mac.find((t) => t.id === "t3code")?.label === "T3 Code (Nightly)", mac.filter((t) => t.id.startsWith("t3")));
  ok("agents are found on PATH and run in a terminal", mac.find((t) => t.id === "claude")?.via === "terminal" && mac.find((t) => t.id === "claude")?.command === "claude");
  ok("agents that aren't installed are absent", !ids.includes("gemini") && !ids.includes("opencode"));
  ok("the Codex app is opened through `codex app` when the CLI is there", mac.find((t) => t.id === "codex-app") && launchPlan(mac.find((t) => t.id === "codex-app")!, "/Users/me/Documents/Crystal Studio/My Bot", "darwin").args.join("|") === "app|/Users/me/Documents/Crystal Studio/My Bot");
  const zed = launchPlan(mac.find((t) => t.id === "zed")!, "/Users/me/Documents/Crystal Studio/My Bot", "darwin");
  ok("a Mac app is opened with open -a, the folder one argument", zed.file === "/usr/bin/open" && zed.args.length === 3 && zed.args[0] === "-a" && zed.args[1] === "/Applications/Zed.app" && zed.args[2] === "/Users/me/Documents/Crystal Studio/My Bot", zed);
  ok("a folder with shell characters stays one argument", launchPlan(mac.find((t) => t.id === "zed")!, "/x/a; rm -rf ~ $(whoami)", "darwin").args[2] === "/x/a; rm -rf ~ $(whoami)");
  await throws("a terminal tool can't be launched as an app", () => launchPlan(mac.find((t) => t.id === "claude")!, "/x", "darwin"));
  await throws("a relative folder is refused", () => launchPlan(mac.find((t) => t.id === "zed")!, "relative/dir", "darwin"));
  ok("the page is told nothing about how to launch", publicTargets(mac).every((t) => !("launch" in t)));

  const two = detectTargets(probe({ dirs: { "/Applications": ["T3 Code.app", "T3 Code (Nightly).app"] } })).filter((t) => t.kind === "app");
  ok("two T3 Code channels are two entries with distinct ids", two.length === 2 && new Set(two.map((t) => t.id)).size === 2, two.map((t) => t.id));

  // Windows file names ignore case (`claude.exe` is found as `claude.EXE`), so the stand-in file system does too.
  const winFiles = ["C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe", "C:\\Program Files\\Microsoft VS Code\\Code.exe", "C:\\Tools\\claude.exe"].map((s) => s.toLowerCase());
  const win = detectTargets(probe({
    platform: "win32",
    pathVar: "C:\\Tools",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", ProgramFiles: "C:\\Program Files" },
    exists: (p) => winFiles.includes(p.toLowerCase()),
  }));
  ok("Windows: finds installed editors and agents", ["cursor", "vscode", "claude"].every((i) => win.some((t) => t.id === i)), win.map((t) => t.id));
  const wc = launchPlan(win.find((t) => t.id === "cursor")!, "C:\\Users\\me\\Documents\\Crystal Studio\\Bot", "win32");
  ok("Windows: runs the program itself, not a shell", wc.file.endsWith("Cursor.exe") && wc.args.length === 1);

  const lin = detectTargets(probe({ platform: "linux", home: "/home/me", pathVar: "/usr/bin:/usr/local/bin", files: ["/usr/bin/code", "/usr/local/bin/zed", "/usr/bin/opencode"] }));
  ok("Linux: commands on PATH", lin.some((t) => t.id === "vscode") && lin.some((t) => t.id === "zed") && lin.some((t) => t.id === "opencode") && !lin.some((t) => t.id === "t3code"), lin.map((t) => t.id));
  ok("Linux: the editor is run with the folder", launchPlan(lin.find((t) => t.id === "vscode")!, "/home/me/p", "linux").args.join() === "/home/me/p");
}

// --- Finding programs ---------------------------------------------------------------------------
{
  ok("marked PATH is read from noisy output", parseMarkedPath("Last login: today\n__CRYSTAL_PATH_START__/a:/b__CRYSTAL_PATH_END__\nbye") === "/a:/b");
  ok("no marker means no answer", parseMarkedPath("garbage") === null && parseMarkedPath("__CRYSTAL_PATH_START____CRYSTAL_PATH_END__") === null);
  ok("merged PATHs keep order and drop repeats", mergePaths("/a:/b", "/b:/c", undefined, "/a") === "/a:/b:/c");
  ok("find on PATH", findOnPath("git", "/x:/y", { platform: "linux", exists: (p) => p === "/y/git" }) === "/y/git");
  ok("find on Windows tries extensions", findOnPath("git", "C:\\a;C:\\b", { platform: "win32", pathExt: ".EXE;.CMD", exists: (p) => p.toLowerCase() === "c:\\b\\git.exe" }) === "C:\\b\\git.EXE");
  ok("a name with a slash is never searched for", findOnPath("../evil", "/x", { platform: "linux", exists: () => true }) === null);
}

console.log(f ? `\n${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
