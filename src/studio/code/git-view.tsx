"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, CloudUpload, FileText, GitBranch, GitCommitVertical, Loader2, Minus, Plus, RefreshCw, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DiffTarget } from "@/studio/code/git-diff";
import { decorate, decorationFor } from "@/studio/code/git-decor";
import type { GitState } from "@/studio/code/use-git";
import { FileGlyph } from "@/studio/code/vscode-ui";
import { modKey } from "@/studio/code/vscode-theme";
import { baseOf, parentOf } from "@/studio/storage/workspace";
import type { GitFileChange } from "../../../electron/gitTypes";

/**
 * The Source Control side bar, laid out as VS Code's: a message box and a Commit button at the top,
 * then the staged changes and the other changes, each file one row that opens a comparison.
 * Everything that talks to git is in `useGit`; this is how it looks and what it asks first.
 */
export function GitView({
  git,
  onOpenDiff,
  onOpenFile,
  onPublish,
  onStatusChange,
}: {
  git: GitState;
  onOpenDiff: (t: DiffTarget) => void;
  onOpenFile: (path: string) => void;
  onPublish: () => void;
  /** Tell the workbench something worth saying ("Committed abc123"). */
  onStatusChange: (message: string) => void;
}) {
  const { status } = git;
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState({ staged: true, changes: true });
  const [confirmDiscard, setConfirmDiscard] = useState<GitFileChange[] | null>(null);
  const [identityFor, setIdentityFor] = useState<null | { all: boolean }>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const mod = modKey();
  const box = useRef<HTMLTextAreaElement>(null);

  // A one-line box that grows with what's typed, up to a limit, as VS Code's does.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(48, el.scrollHeight))}px`;
  }, [message]);

  const total = status?.changes.length ?? 0;
  const commitAll = git.staged.length === 0;
  const canCommit = !!status?.isRepo && !git.busy && message.trim().length > 0 && total > 0 && (git.staged.length > 0 || git.unstaged.length > 0);

  async function doCommit(identity?: { name: string; email: string }) {
    const all = commitAll;
    const r = await git.commit(message, { all, identity });
    if (r.ok) {
      setMessage("");
      setIdentityFor(null);
      onStatusChange(`Committed ${r.value.hash}: ${r.value.summary}${r.value.held.length ? `. Left out ${r.value.held.join(", ")} (looks like a secret; stage it yourself if you mean to commit it).` : ""}`);
    } else if (r.kind === "identity") {
      setIdentityFor({ all });
    }
  }

  const branchLabel = status?.branch ?? "(detached HEAD)";

  if (!git.available) {
    return <Shell><p className="px-5 py-2 text-[13px]" style={{ color: "var(--vsc-muted)" }}>Source control is part of the Crystal desktop app.</p></Shell>;
  }
  if (!status) {
    return <Shell><div className="flex justify-center py-6"><Loader2 className="size-4 animate-spin opacity-60" /></div></Shell>;
  }
  if (status.git === "missing") {
    return (
      <Shell>
        <div className="space-y-3 px-5 py-2 text-[13px]">
          <p>Git isn&apos;t installed on this computer, and source control needs it.</p>
          <p style={{ color: "var(--vsc-muted)" }}>Install it from git-scm.com{typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? " (or run xcode-select --install)" : ""}, then check again.</p>
          <VscBlock onClick={() => void git.refresh()}>Check again</VscBlock>
        </div>
      </Shell>
    );
  }
  if (!status.isRepo) {
    return (
      <Shell>
        <div className="space-y-3 px-5 py-2 text-[13px]">
          <p>This project isn&apos;t in a git repository yet. A repository keeps its history on this computer, so you can see what changed and go back.</p>
          <VscBlock onClick={() => void git.init()} disabled={!!git.busy}>{git.busy ? git.busy : "Initialize Repository"}</VscBlock>
          <VscBlock secondary onClick={onPublish} disabled={!!git.busy}><CloudUpload className="size-3.5" /> Publish to GitHub…</VscBlock>
          {git.error && <p role="alert" style={{ color: "var(--vsc-error)" }}>{git.error}</p>}
        </div>
      </Shell>
    );
  }

  const hasRemote = status.remotes.length > 0;
  return (
    <Shell
      actions={
        <>
          <Action label="Refresh" onClick={() => void (hasRemote ? git.fetch() : git.refresh())} disabled={!!git.busy}>
            <RefreshCw className={`size-4 ${git.busy === "Fetching…" ? "animate-spin" : ""}`} />
          </Action>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="space-y-2 px-3 pb-2">
          <textarea
            ref={box}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit) {
                e.preventDefault();
                void doCommit();
              }
              e.stopPropagation();
            }}
            rows={2}
            spellCheck
            placeholder={`Message (${mod}Enter to commit on “${branchLabel}”)`}
            aria-label="Commit message"
            className="block w-full resize-none border px-2 py-1.5 text-[13px] outline-none focus:border-[var(--vsc-accent)]"
            style={{ background: "var(--vsc-input)", borderColor: "var(--vsc-input-border)", color: "var(--vsc-input-fg)", minHeight: 48 }}
          />
          <VscBlock onClick={() => void doCommit()} disabled={!canCommit}>
            {git.busy === "Committing…" ? <Loader2 className="size-3.5 animate-spin" /> : <GitCommitVertical className="size-3.5" />}
            {commitAll ? "Commit All" : "Commit"}
            {git.staged.length > 0 ? ` (${git.staged.length})` : ""}
          </VscBlock>
          {commitAll && total > 0 && <p className="text-[12px]" style={{ color: "var(--vsc-muted)" }}>Nothing is staged, so Commit All stages and commits every change. Files that look like secrets are left out.</p>}

          {/* Getting it to a remote */}
          {!hasRemote ? (
            <div className="space-y-1.5 pt-1">
              <VscBlock secondary onClick={onPublish} disabled={!!git.busy}><CloudUpload className="size-3.5" /> Publish to GitHub…</VscBlock>
              <button type="button" className="text-[12px] underline opacity-80 hover:opacity-100" onClick={() => setRemoteOpen(true)}>…or connect another remote repository</button>
            </div>
          ) : (
            <div className="space-y-1.5 pt-1">
              <div className="flex gap-1.5">
                <VscBlock secondary onClick={() => void git.pull()} disabled={!!git.busy || !status.upstream} title={status.upstream ? `Pull from ${status.upstream}` : "Push first to link this branch to the remote"}>
                  {git.busy === "Pulling…" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDown className="size-3.5" />} Pull{status.behind ? ` ${status.behind}` : ""}
                </VscBlock>
                <VscBlock secondary onClick={() => void git.push()} disabled={!!git.busy || !status.hasCommits || !status.branch || (!!status.upstream && status.ahead === 0)} title={status.upstream ? `Push to ${status.upstream}` : `Publish “${branchLabel}” to ${status.remotes[0].name}`}>
                  {git.busy === "Pushing…" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUp className="size-3.5" />} {status.upstream ? "Push" : "Publish Branch"}{status.ahead ? ` ${status.ahead}` : ""}
                </VscBlock>
              </div>
              <p className="truncate text-[12px]" style={{ color: "var(--vsc-muted)" }} title={status.remotes.map((r) => `${r.name}: ${r.url}`).join("\n")}>
                {status.remotes[0].name}: {status.remotes[0].url.replace(/^https:\/\//, "")}
              </p>
            </div>
          )}
          {git.error && (
            <div role="alert" className="flex items-start gap-1.5 text-[12px]" style={{ color: "var(--vsc-error)" }}>
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{git.error}</span>
              <button type="button" className="shrink-0 underline" onClick={git.clearError}>Dismiss</button>
            </div>
          )}
        </div>

        {git.staged.length > 0 && (
          <Section
            title="Staged Changes"
            count={git.staged.length}
            open={open.staged}
            onToggle={() => setOpen((o) => ({ ...o, staged: !o.staged }))}
            actions={<Action label="Unstage All Changes" onClick={() => void git.unstageAll()}><Minus className="size-4" /></Action>}
          >
            {git.staged.map((c) => (
              <ChangeRow key={`s:${c.path}`} change={c} side="staged" git={git} onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} onDiscard={() => undefined} />
            ))}
          </Section>
        )}
        <Section
          title="Changes"
          count={git.unstaged.length}
          open={open.changes}
          onToggle={() => setOpen((o) => ({ ...o, changes: !o.changes }))}
          actions={git.unstaged.length > 0 ? <Action label="Stage All Changes" onClick={() => void git.stageAll()}><Plus className="size-4" /></Action> : null}
        >
          {git.unstaged.length === 0 && git.staged.length === 0 && <p className="px-5 py-1 text-[13px]" style={{ color: "var(--vsc-muted)" }}>No changes. Everything in this project is committed.</p>}
          {git.unstaged.map((c) => (
            <ChangeRow key={`u:${c.path}`} change={c} side="unstaged" git={git} onOpenDiff={onOpenDiff} onOpenFile={onOpenFile} onDiscard={() => setConfirmDiscard([c])} />
          ))}
        </Section>
        {status.truncated && <p className="px-5 py-1 text-[12px]" style={{ color: "var(--vsc-muted)" }}>Only the first 2000 changed files are listed. Is a folder like node_modules missing from .gitignore?</p>}
      </div>

      <DiscardDialog changes={confirmDiscard} onCancel={() => setConfirmDiscard(null)} onConfirm={(list) => { setConfirmDiscard(null); void git.discard(list.map((c) => c.path)); }} />
      <IdentityDialog
        open={!!identityFor}
        initial={status.identity}
        onCancel={() => setIdentityFor(null)}
        onSave={(who) => void doCommit(who)}
        busy={!!git.busy}
      />
      <RemoteDialog open={remoteOpen} onCancel={() => setRemoteOpen(false)} busy={!!git.busy} error={git.error} onSave={async (url) => { const r = await git.setRemote(url); if (r.ok) { setRemoteOpen(false); onStatusChange("Remote saved. Press Publish Branch to push to it."); } }} />
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[35px] shrink-0 items-center pl-5 pr-2 text-[11px] uppercase" style={{ color: "var(--vsc-sidebar-title-fg)" }}>
        <span className="flex-1">Source Control</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Action({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={(e) => (e.stopPropagation(), onClick())} className="flex size-[22px] items-center justify-center rounded hover:bg-[var(--vsc-list-hover)] disabled:opacity-40">
      {children}
    </button>
  );
}

function VscBlock({ onClick, disabled, secondary, title, children }: { onClick: () => void; disabled?: boolean; secondary?: boolean; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[26px] w-full items-center justify-center gap-1.5 rounded-[2px] px-3 text-[13px] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      style={secondary ? { background: "var(--vsc-list-inactive)", color: "var(--vsc-editor-fg)" } : { background: "var(--vsc-accent)", color: "var(--vsc-accent-fg)" }}
    >
      {children}
    </button>
  );
}

function Section({ title, count, open, onToggle, actions, children }: { title: string; count: number; open: boolean; onToggle: () => void; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="group flex h-[22px] cursor-pointer items-center gap-0.5 pr-1 text-[11px] font-bold uppercase" style={{ background: "var(--vsc-sidebar-section)", color: "var(--vsc-sidebar-title-fg)", borderTop: "1px solid var(--vsc-border)" }} onClick={onToggle}>
        {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="hidden items-center group-hover:flex">{actions}</span>
        <span className="ml-1 rounded-full px-1.5 text-[11px] leading-[16px] font-normal" style={{ background: "var(--vsc-badge)", color: "var(--vsc-badge-fg)" }}>{count}</span>
      </div>
      {open && children}
    </div>
  );
}

function ChangeRow({ change, side, git, onOpenDiff, onOpenFile, onDiscard }: { change: GitFileChange; side: "staged" | "unstaged"; git: GitState; onOpenDiff: (t: DiffTarget) => void; onOpenFile: (path: string) => void; onDiscard: () => void }) {
  const dec = side === "staged" ? decorate(change.staged ?? "M") : decorationFor(change);
  const deleted = (side === "staged" ? change.staged : change.unstaged) === "D";
  const hover = "hidden items-center group-hover:flex";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDiff({ path: change.path, from: change.from, mode: side })}
      onKeyDown={(e) => e.key === "Enter" && onOpenDiff({ path: change.path, from: change.from, mode: side })}
      title={`${change.path} — ${dec.title}${change.sensitive ? ". Looks like it holds a secret." : ""}`}
      className="group flex h-[22px] cursor-pointer items-center gap-1 pl-5 pr-2 text-[13px] hover:bg-[var(--vsc-list-hover)]"
    >
      <FileGlyph name={baseOf(change.path)} />
      <span className={`shrink-0 ${deleted ? "line-through" : ""}`} style={{ color: dec.color }}>{baseOf(change.path)}</span>
      <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: "var(--vsc-muted)" }}>{change.from ? `← ${change.from}` : parentOf(change.path)}</span>
      {change.sensitive && <CircleAlert className="size-3.5 shrink-0" style={{ color: "var(--vsc-warning)" }} aria-label="May contain a secret" />}
      <span className={hover}>
        {!deleted && <Action label="Open File" onClick={() => onOpenFile(change.path)}><FileText className="size-4" /></Action>}
        {side === "unstaged" && <Action label={change.unstaged === "?" ? "Delete File" : "Discard Changes"} onClick={onDiscard}><Undo2 className="size-4" /></Action>}
        {side === "unstaged" ? (
          <Action label="Stage Changes" onClick={() => void git.stage([change.path])}><Plus className="size-4" /></Action>
        ) : (
          <Action label="Unstage Changes" onClick={() => void git.unstage([change.path])}><Minus className="size-4" /></Action>
        )}
      </span>
      <span className="w-3 shrink-0 text-center text-[12px] font-medium group-hover:hidden" style={{ color: dec.color }}>{dec.letter}</span>
    </div>
  );
}

function DiscardDialog({ changes, onCancel, onConfirm }: { changes: GitFileChange[] | null; onCancel: () => void; onConfirm: (c: GitFileChange[]) => void }) {
  const untracked = changes?.every((c) => c.unstaged === "?");
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  return (
    <Dialog open={!!changes} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[13px] font-normal">
            {untracked ? `Delete “${changes?.[0] ? baseOf(changes[0].path) : ""}”?` : `Discard changes to “${changes?.[0] ? baseOf(changes[0].path) : ""}”?`}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {untracked ? `It isn't in git yet, so it'll be moved to the ${mac ? "Trash" : "Recycle Bin"}.` : "Your edits to it will be lost. This can't be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={() => changes && onConfirm(changes)}>{untracked ? "Delete File" : "Discard Changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdentityDialog({ open, initial, onCancel, onSave, busy }: { open: boolean; initial: { name: string | null; email: string | null }; onCancel: () => void; onSave: (who: { name: string; email: string }) => void; busy: boolean }) {
  const [name, setName] = useState(initial.name ?? "");
  const [email, setEmail] = useState(initial.email ?? "");
  const valid = name.trim().length > 0 && /^[^\s@]+@[^\s@]+$/.test(email.trim());
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Who are you?</DialogTitle>
          <DialogDescription className="text-[12px]">Git puts a name and email on every commit. Saved for this project only; change it later with git config.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ name: name.trim(), email: email.trim() }); }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Name" autoFocus />
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" type="email" />
          <DialogFooter className="pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!valid || busy}>{busy ? "Committing…" : "Save and commit"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoteDialog({ open, onCancel, onSave, busy, error }: { open: boolean; onCancel: () => void; onSave: (url: string) => void; busy: boolean; error: string | null }) {
  const [url, setUrl] = useState("");
  const valid = useMemo(() => /^(https:\/\/\S+|ssh:\/\/\S+|[\w.-]+@[\w.-]+:\S+)$/.test(url.trim()), [url]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[14px]">Connect a remote repository</DialogTitle>
          <DialogDescription className="text-[12px]">The address of an empty or existing repository on GitHub, GitLab or anywhere git can reach. Pushing uses your computer&apos;s own git sign-in (a credential helper, or an SSH key in ssh-agent).</DialogDescription>
        </DialogHeader>
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(url.trim()); }}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/you/project.git  or  git@github.com:you/project.git" aria-label="Repository address" autoFocus />
          {error && <p role="alert" className="text-[12px] text-destructive">{error}</p>}
          <DialogFooter className="pt-2">
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!valid || busy}>Save remote</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The branch shown in the status bar: its name, and how far ahead of or behind the remote it is. */
export function BranchLabel({ git }: { git: GitState }) {
  const s = git.status;
  if (!s?.isRepo) return null;
  return (
    <>
      {git.busy ? <Loader2 className="size-3.5 animate-spin" /> : <GitBranch className="size-3.5" />}
      {s.branch ?? "detached"}
      {s.changes.length > 0 ? "*" : ""}
      {(s.ahead > 0 || s.behind > 0) && (
        <span className="ml-1 flex items-center">
          {s.behind > 0 && <><ArrowDown className="size-3" />{s.behind}</>}
          {s.ahead > 0 && <><ArrowUp className="size-3" />{s.ahead}</>}
        </span>
      )}
    </>
  );
}
