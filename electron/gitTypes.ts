/**
 * The shapes Studio's source-control and "open in" features pass between the main process and the
 * page. No imports, so the page can `import type` them without pulling any Node code in.
 */

/** One letter per kind of change, as `git status` writes them. `?` is a file git doesn't know yet. */
export type GitCode = "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?";

export interface GitFileChange {
  /** Relative to the project folder, with `/`. */
  path: string;
  /** For a rename or copy, where it came from. */
  from?: string;
  /** Its state in the index (what the next commit will contain), or null if that is unchanged. */
  staged: GitCode | null;
  /** Its state in the working folder compared with the index, or null if unchanged. `?` is untracked. */
  unstaged: GitCode | null;
  /** Both sides changed it and a merge left it for the person to settle. */
  conflicted: boolean;
  /** Looks like a secret (`.env`, a private key): never swept into a commit without being asked. */
  sensitive: boolean;
}

export interface GitRemote {
  name: string;
  /** With any password or token in the address removed. */
  url: string;
}

export interface GitStatus {
  /** `missing` when there is no usable git on this computer. */
  git: "ok" | "missing";
  /** The project folder itself holds a repository (a repository in a parent folder doesn't count). */
  isRepo: boolean;
  /** The branch, or null when HEAD is detached or there is no repository. */
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  hasCommits: boolean;
  remotes: GitRemote[];
  changes: GitFileChange[];
  /** More changed files than are listed. */
  truncated: boolean;
  /** Who a commit would be made as, from git's own settings; null parts are unset. */
  identity: { name: string | null; email: string | null };
}

export type GitDiffMode = "unstaged" | "staged";

export interface GitDiffRequest {
  path: string;
  /** Where a renamed file came from, so a staged rename compares against the old name. */
  from?: string;
  mode: GitDiffMode;
}

export interface GitDiffSides {
  original: string;
  modified: string;
  originalLabel: string;
  modifiedLabel: string;
  /** Either side isn't text; the sides are empty. */
  binary: boolean;
  /** Either side is too big to show; the sides are empty. */
  tooLarge: boolean;
}

/** Where the GitHub login Studio is using came from: a token pasted into Studio, or the GitHub CLI's. */
export type GithubTokenSource = "saved" | "gh";

export interface GithubAccount {
  login: string;
  source: GithubTokenSource;
  /** Organisations the login can also create repositories in. */
  orgs: string[];
}

export interface GithubCreateRepoRequest {
  name: string;
  description?: string;
  private: boolean;
  /** An organisation to create it under; omitted for the person's own account. */
  owner?: string;
  /** Used if the project has no commits yet and one has to be made to have anything to publish. */
  commitMessage?: string;
  /** Who the first commit is by, if git doesn't know. */
  identity?: { name: string; email: string };
}

/** Why something failed, for the few cases the page does something about. */
export type GitFailure = "identity" | "nothing-staged" | "no-remote" | "auth" | "behind" | "not-a-repo" | "diverged" | "missing" | "failed";

export type GitResult<T> = { ok: true; value: T } | { ok: false; kind: GitFailure; message: string };

export interface GithubCreateRepoResult {
  url: string;
  /** Files deliberately left out of the first commit because they look like secrets. */
  skipped: string[];
  /** The repository was made but the push didn't go through; the message says why. */
  pushError?: string;
}

/** How an entry in "Open in…" is started. */
export type OpenInKind = "editor" | "app" | "agent";

export interface OpenInTarget {
  id: string;
  label: string;
  kind: OpenInKind;
  /**
   * `app` starts a program with the folder; `terminal` means it is a command-line tool, which is
   * started by typing `command` into a terminal opened in the project.
   */
  via: "app" | "terminal";
  /** What to type into a terminal (agents only). */
  command?: string;
}

export interface OpenInResult {
  /** Something to tell the person, when just opening the thing wasn't the whole story. */
  message?: string;
}
