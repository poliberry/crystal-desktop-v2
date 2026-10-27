"use client";

import { CheckCircle2, CircleAlert, ExternalLink, Loader2, LockKeyhole, Globe } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { GitState } from "@/studio/code/use-git";
import { cn } from "@/lib/utils";
import type { GithubCreateRepoResult } from "../../../electron/gitTypes";

/** Where a person makes a token that can create repositories. Opened in their browser, never inside Studio. */
const NEW_TOKEN_URL = "https://github.com/settings/tokens/new?description=Crystal%20Studio&scopes=repo";

/** `My Cool Bot` → `my-cool-bot`: a name GitHub accepts. */
export function repoNameFor(projectName: string): string {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 100);
  return slug || "my-project";
}

type Stage = "form" | "working" | "done";

/**
 * "Publish to GitHub": make the project a repository on the person's GitHub account (or an
 * organisation of theirs), commit it if nothing is committed yet, and push.
 *
 * What it does and doesn't do is said in the dialog, because it puts the person's files on a
 * server: private is the default, the account it will use is named, and files that look like
 * secrets are listed as being left out of the first commit.
 */
export function PublishDialog({ open, onClose, git, projectName }: { open: boolean; onClose: () => void; git: GitState; projectName: string }) {
  const { account, loadAccount } = git;
  const [stage, setStage] = useState<Stage>("form");
  const [token, setToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [owner, setOwner] = useState("");
  const [commitMessage, setCommitMessage] = useState("Initial commit");
  const [who, setWho] = useState<{ name: string; email: string } | null>(null);
  const [result, setResult] = useState<GithubCreateRepoResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setStage("form");
    setProblem(null);
    setResult(null);
    setToken("");
    setName(repoNameFor(projectName));
    setWho(null);
    void loadAccount();
    // Read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const status = git.status;
  const hasCommits = !!status?.hasCommits;
  const willLeaveOut = (status?.changes ?? []).filter((c) => c.sensitive && c.unstaged === "?").map((c) => c.path);
  const needsWho = who !== null;
  const nameOk = /^[A-Za-z0-9._-]{1,100}$/.test(name) && !name.endsWith(".git") && name !== "." && name !== "..";
  const whoOk = !needsWho || (who.name.trim().length > 0 && /^[^\s@]+@[^\s@]+$/.test(who.email.trim()));

  async function connect() {
    setConnecting(true);
    setProblem(null);
    const r = await git.connectGithub(token);
    setConnecting(false);
    if (r.ok) setToken("");
    else setProblem(r.message);
  }

  async function publish() {
    setProblem(null);
    setStage("working");
    const r = await git.publish({
      name,
      description: description.trim() || undefined,
      private: isPrivate,
      owner: owner && owner !== account?.login ? owner : undefined,
      commitMessage: hasCommits ? undefined : commitMessage,
      identity: who && whoOk ? { name: who.name.trim(), email: who.email.trim() } : undefined,
    });
    if (r.ok) {
      setResult(r.value);
      setStage("done");
      return;
    }
    setStage("form");
    if (r.kind === "identity") {
      setWho({ name: status?.identity.name ?? "", email: status?.identity.email ?? "" });
      setProblem("Git needs a name and email to put on the first commit.");
    } else setProblem(r.message);
  }

  const busy = stage === "working";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => busy && e.preventDefault()}>
        {stage === "done" && result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[14px]">
                {result.pushError ? <CircleAlert className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
                {result.pushError ? "Repository created, but the push didn't finish" : "Published to GitHub"}
              </DialogTitle>
              <DialogDescription className="text-[12px] break-all">{result.url}</DialogDescription>
            </DialogHeader>
            {result.pushError && (
              <p role="alert" className="text-[12px] text-destructive">
                {result.pushError} The repository exists and this project is already linked to it, so the Push button in Source Control will finish the job once that&apos;s sorted out.
              </p>
            )}
            {result.skipped.length > 0 && (
              <p className="text-[12px] text-muted-foreground">
                Left out of the first commit because they look like secrets: <span className="font-mono">{result.skipped.join(", ")}</span>. Stage them yourself in Source Control if you really mean to publish them.
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
              <Button size="sm" onClick={() => window.open(result.url, "_blank", "noopener")}>
                <ExternalLink className="size-3.5" /> Open on GitHub
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-[14px]">Publish to GitHub</DialogTitle>
              <DialogDescription className="text-[12px]">Creates a repository for this project on GitHub and uploads it. Your files go to GitHub&apos;s servers.</DialogDescription>
            </DialogHeader>

            {account === undefined ? (
              <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin opacity-60" /></div>
            ) : account === null ? (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (token.trim() && !connecting) void connect();
                }}
              >
                <p className="text-[13px]">Connect your GitHub account first. Studio needs a personal access token that can create repositories.</p>
                <ol className="list-decimal space-y-1 pl-5 text-[12px] text-muted-foreground">
                  <li>
                    <button type="button" className="underline" onClick={() => window.open(NEW_TOKEN_URL, "_blank", "noopener")}>Create a token on GitHub</button> (the “repo” permission is already ticked).
                  </li>
                  <li>Copy it and paste it here. It&apos;s kept in your computer&apos;s secure storage and only ever sent to GitHub.</li>
                </ol>
                <Input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ghp_… or github_pat_…" aria-label="GitHub token" autoFocus />
                <p className="text-[12px] text-muted-foreground">Already use the GitHub CLI? Run <span className="font-mono">gh auth login</span> in the terminal and reopen this dialog; Studio will use that sign-in.</p>
                {problem && <p role="alert" className="text-[12px] text-destructive">{problem}</p>}
                <DialogFooter className="pt-1">
                  <Button type="button" variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={!token.trim() || connecting}>{connecting ? "Checking…" : "Connect"}</Button>
                </DialogFooter>
              </form>
            ) : (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameOk && whoOk && !busy) void publish();
                }}
              >
                <p className="text-[12px] text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">@{account.login}</span>
                  {account.source === "gh" ? " (through the GitHub CLI)" : ""}.{" "}
                  {account.source === "saved" && (
                    <button type="button" className="underline" onClick={() => void git.disconnectGithub()}>Disconnect</button>
                  )}
                </p>

                <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2">
                  {account.orgs.length > 0 && (
                    <>
                      <label className="text-[12px]" htmlFor="pub-owner">Owner</label>
                      <select id="pub-owner" value={owner || account.login} onChange={(e) => setOwner(e.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-[13px]">
                        <option value={account.login}>{account.login}</option>
                        {account.orgs.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <label className="text-[12px]" htmlFor="pub-name">Name</label>
                  <Input id="pub-name" value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!nameOk} spellCheck={false} />
                  <label className="text-[12px]" htmlFor="pub-desc">About</label>
                  <Input id="pub-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" maxLength={350} />
                </div>
                {!nameOk && <p className="text-[12px] text-destructive">Use letters, numbers, dots, dashes and underscores.</p>}

                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Visibility">
                  {[
                    { value: true, icon: LockKeyhole, title: "Private", text: "Only you, and people you invite." },
                    { value: false, icon: Globe, title: "Public", text: "Anyone on the internet can see it." },
                  ].map((o) => (
                    <button
                      key={o.title}
                      type="button"
                      role="radio"
                      aria-checked={isPrivate === o.value}
                      onClick={() => setIsPrivate(o.value)}
                      className={cn("flex items-start gap-2 rounded-md border p-2 text-left", isPrivate === o.value ? "border-primary bg-primary/10" : "hover:bg-muted/50")}
                    >
                      <o.icon className="mt-0.5 size-4 shrink-0" />
                      <span>
                        <span className="block text-[13px] font-medium">{o.title}</span>
                        <span className="block text-[12px] text-muted-foreground">{o.text}</span>
                      </span>
                    </button>
                  ))}
                </div>

                {!hasCommits && (
                  <div className="grid gap-1">
                    <label className="text-[12px]" htmlFor="pub-msg">Nothing is committed yet, so Studio will make the first commit:</label>
                    <Input id="pub-msg" value={commitMessage} onChange={(e) => setCommitMessage(e.target.value)} />
                  </div>
                )}
                {!hasCommits && willLeaveOut.length > 0 && (
                  <p className="flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                    <span>Left out of that commit because they look like secrets: <span className="font-mono">{willLeaveOut.join(", ")}</span>.</span>
                  </p>
                )}
                {hasCommits && (status?.changes.length ?? 0) > 0 && (
                  <p className="text-[12px] text-muted-foreground">Only what&apos;s already committed is published. {status!.changes.length} uncommitted change{status!.changes.length === 1 ? "" : "s"} stay on this computer until you commit them.</p>
                )}

                {needsWho && (
                  <div className="grid gap-2 rounded-md border p-2">
                    <p className="text-[12px]">Git puts a name and email on every commit. Saved for this project only.</p>
                    <Input value={who.name} onChange={(e) => setWho({ ...who, name: e.target.value })} placeholder="Your name" aria-label="Name" />
                    <Input value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} placeholder="you@example.com" type="email" aria-label="Email" />
                  </div>
                )}

                {problem && <p role="alert" className="text-[12px] text-destructive">{problem}</p>}
                <DialogFooter className="pt-1">
                  <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
                  <Button type="submit" size="sm" disabled={!nameOk || !whoOk || busy}>
                    {busy ? <><Loader2 className="size-3.5 animate-spin" /> Publishing…</> : `Create ${isPrivate ? "private" : "public"} repository`}
                  </Button>
                </DialogFooter>
              </form>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
