import { GitError, scrubSecrets } from "./gitCore";

/**
 * The little of GitHub's API that "Publish to GitHub" needs: who a token belongs to, which
 * organisations they can create repositories in, and creating one.
 *
 * It talks to one address (`api.github.com`), over https, with a token the person gave Studio or
 * that their GitHub CLI already holds. The token is only ever sent to that address, is never
 * written into a repository's configuration, and never goes back to the page.
 */

export const GITHUB_API = "https://api.github.com";

type Fetch = typeof fetch;

export interface GithubUser {
  login: string;
  /** The scopes a classic token has; null for a fine-grained token, which doesn't report any. */
  scopes: string[] | null;
}

export interface CreatedRepo {
  fullName: string;
  /** The https address git pushes to. */
  cloneUrl: string;
  /** The page people see. */
  htmlUrl: string;
}

const TOKEN = /^[A-Za-z0-9_\-.=]{20,255}$/;
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function validateToken(token: unknown): string {
  if (typeof token !== "string" || !TOKEN.test(token.trim())) throw new GitError("That doesn't look like a GitHub token. Paste the whole token, with no spaces.");
  return token.trim();
}

export function validateRepoName(name: unknown): string {
  const n = typeof name === "string" ? name.trim() : "";
  if (!REPO_NAME.test(n) || n === "." || n === ".." || n.endsWith(".git")) {
    throw new GitError("A repository name can use letters, numbers, dots, dashes and underscores (up to 100), and can't end in .git.");
  }
  return n;
}

export function validateOwner(owner: unknown): string | undefined {
  if (owner === undefined || owner === null || owner === "") return undefined;
  if (typeof owner !== "string" || !OWNER.test(owner)) throw new GitError("That isn't an account or organisation name.");
  return owner;
}

export function createGithubClient(fetchFn: Fetch = fetch, base: string = GITHUB_API) {
  async function call(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown; headers: Headers }> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "CrystalStudio",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitError("Couldn't reach GitHub. Check your internet connection.");
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* no body */
    }
    return { status: res.status, json, headers: res.headers };
  }

  const message = (json: unknown): string => {
    const m = json && typeof json === "object" ? (json as { message?: unknown }).message : null;
    return typeof m === "string" ? scrubSecrets(m).slice(0, 300) : "";
  };

  return {
    async user(token: string): Promise<GithubUser> {
      const r = await call(token, "GET", "/user");
      if (r.status === 401) throw new GitError("GitHub didn't accept that token. It may be wrong, expired or revoked.", "auth");
      if (r.status !== 200) throw new GitError(`GitHub answered ${r.status}${message(r.json) ? `: ${message(r.json)}` : "."}`);
      const login = (r.json as { login?: unknown })?.login;
      if (typeof login !== "string") throw new GitError("GitHub's answer wasn't what was expected.");
      const header = r.headers.get("x-oauth-scopes");
      return { login, scopes: header === null ? null : header.split(",").map((s) => s.trim()).filter(Boolean) };
    },

    /** Organisations the token can see. A failure is an empty list: the person's own account always works. */
    async orgs(token: string): Promise<string[]> {
      try {
        const r = await call(token, "GET", "/user/orgs?per_page=100");
        if (r.status !== 200 || !Array.isArray(r.json)) return [];
        return (r.json as { login?: unknown }[]).map((o) => o.login).filter((l): l is string => typeof l === "string");
      } catch {
        return [];
      }
    },

    async createRepo(token: string, req: { name: string; description?: string; private: boolean; owner?: string }): Promise<CreatedRepo> {
      const name = validateRepoName(req.name);
      const owner = validateOwner(req.owner);
      const description = (req.description ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 350);
      const r = await call(token, "POST", owner ? `/orgs/${owner}/repos` : "/user/repos", { name, description: description || undefined, private: !!req.private, auto_init: false });
      if (r.status === 201) {
        const j = r.json as { full_name?: unknown; clone_url?: unknown; html_url?: unknown };
        if (typeof j.full_name !== "string" || typeof j.clone_url !== "string" || typeof j.html_url !== "string") throw new GitError("GitHub's answer wasn't what was expected.");
        return { fullName: j.full_name, cloneUrl: j.clone_url, htmlUrl: j.html_url };
      }
      if (r.status === 401) throw new GitError("GitHub didn't accept the token. Connect your account again.", "auth");
      if (r.status === 403 || r.status === 404) {
        throw new GitError(
          owner
            ? `GitHub won't let this token create repositories in ${owner}. Check that the token has access to that organisation.`
            : "GitHub won't let this token create repositories. A classic token needs the “repo” scope; a fine-grained one needs “Administration: write” on your account.",
          "auth",
        );
      }
      if (r.status === 422) {
        const errors = (r.json as { errors?: { message?: unknown }[] })?.errors;
        const first = Array.isArray(errors) ? errors.map((e) => e.message).find((m): m is string => typeof m === "string") : undefined;
        if (first && /already exists/i.test(first)) throw new GitError(`${owner ?? "Your account"} already has a repository called “${name}”. Choose another name.`);
        throw new GitError(first ? scrubSecrets(first) : "GitHub refused that repository name or description.");
      }
      throw new GitError(`GitHub answered ${r.status}${message(r.json) ? `: ${message(r.json)}` : "."}`);
    },
  };
}

export type GithubClient = ReturnType<typeof createGithubClient>;

/** `https://github.com/o/r(.git)` → `o/r`, for the places git should use a token on. */
export function githubRepoOf(url: string): string | null {
  const m = /^https:\/\/(?:[^/@]+@)?github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Environment that makes one git command send the token to github.com — and only there — without
 * it appearing in the command line, in `.git/config`, or in the saved remote address. (This is how
 * GitHub's own checkout action authenticates.)
 */
export function githubAuthEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    // Don't let a credential helper store or prompt for anything while this token is in use.
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
  };
}
