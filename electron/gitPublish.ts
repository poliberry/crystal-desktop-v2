import { GitError, commit, init, isRepoRoot, setRemote, stageAll, status, push, type GitCtx } from "./gitCore";
import { githubAuthEnv, validateOwner, validateRepoName, type GithubClient } from "./github";
import type { GithubCreateRepoRequest, GithubCreateRepoResult } from "./gitTypes";

/**
 * "Publish to GitHub": make the project a repository if it isn't, make sure there is a commit to
 * publish, create the repository on GitHub, point `origin` at it, and push.
 *
 * Each step leaves things in a state the person can carry on from, because any of them can fail:
 *
 *  - If git doesn't know who the commit is by, nothing has been created online; the page asks, and
 *    sends the same request again.
 *  - If GitHub refuses the name, nothing has been changed beyond the local commit.
 *  - If the repository was made but the push didn't go through, `origin` is already set, so the
 *    ordinary Push button finishes the job, and the result says exactly that.
 */
export async function publishToGithub(ctx: GitCtx, client: GithubClient, token: string, req: GithubCreateRepoRequest): Promise<GithubCreateRepoResult> {
  const name = validateRepoName(req.name);
  const owner = validateOwner(req.owner);

  if (!(await isRepoRoot(ctx))) await init(ctx);
  let st = await status(ctx);
  if (st.remotes.length > 0) throw new GitError(`This project already has a remote (${st.remotes[0].name}: ${st.remotes[0].url}). Use Push instead.`);

  let skipped: string[] = [];
  if (!st.hasCommits) {
    // (The .gitignore that `init` just wrote doesn't count as something to publish.)
    if (st.changes.every((c) => c.path === ".gitignore")) throw new GitError("There are no files in this project to publish yet.");
    skipped = await stageAll(ctx);
    const message = (req.commitMessage ?? "").trim() || "Initial commit";
    await commit(ctx, message, req.identity);
  }

  const repo = await client.createRepo(token, { name, description: req.description, private: req.private, owner });
  await setRemote(ctx, "origin", repo.cloneUrl);

  st = await status(ctx);
  try {
    await push({ ...ctx, secretEnv: githubAuthEnv(token) }, st, "origin");
  } catch (e) {
    const why = e instanceof GitError ? e.message : "The push failed.";
    return { url: repo.htmlUrl, skipped, pushError: why };
  }
  return { url: repo.htmlUrl, skipped };
}
