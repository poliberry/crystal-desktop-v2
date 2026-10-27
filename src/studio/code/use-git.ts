"use client";

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getDesktopAPI } from "@/lib/desktop";
import type { CodeWorkbench } from "@/studio/code/use-code-workbench";
import { EditorActiveContext } from "@/studio/shell/chrome";
import type { DesktopAPI } from "@/types/desktop-api";
import type {
  GitDiffRequest,
  GitDiffSides,
  GitFileChange,
  GitResult,
  GitStatus,
  GithubAccount,
  GithubCreateRepoRequest,
  GithubCreateRepoResult,
  OpenInResult,
  OpenInTarget,
} from "../../../electron/gitTypes";

/**
 * Source control for a code project: git's view of its folder, kept fresh, and the things a person
 * does with it. All of it goes through the main process (`electron/studioGit.ts` says what that may
 * and may not do); this hook is state and wiring.
 *
 * Status is asked for every few seconds while the project is the one being looked at, which is how
 * a change made in the terminal, by another editor or by an AI agent shows up without anyone asking.
 * Anything that changes something, and anything that touches the network, only happens because a
 * person pressed a button.
 */

type GitApi = NonNullable<DesktopAPI["studio"]["git"]>;
const POLL_MS = 4000;

/** Failures the view handles itself (by asking), so they aren't also shown as an error. */
const HANDLED = new Set(["identity"]);

const clean = (message: string) => message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");

export interface CommitOutcome {
  hash: string;
  summary: string;
  /** Files that look like secrets and were deliberately not included. */
  held: string[];
}

export interface GitState {
  /** This build of the app can do git at all. */
  available: boolean;
  status: GitStatus | null;
  /** What it's doing right now ("Pushing…"), or null. */
  busy: string | null;
  error: string | null;
  clearError(): void;
  /** Staged and unstaged halves of the change list. */
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  /** Change by path, for marking files in the Explorer. */
  byPath: Map<string, GitFileChange>;
  refresh(): Promise<void>;
  init(): Promise<GitResult<void>>;
  stage(paths: string[]): Promise<GitResult<void>>;
  stageAll(): Promise<GitResult<string[]>>;
  unstage(paths: string[]): Promise<GitResult<void>>;
  unstageAll(): Promise<GitResult<void>>;
  discard(paths: string[]): Promise<GitResult<void>>;
  /** Commit what is staged; with `all`, stage everything first. */
  commit(message: string, opts?: { all?: boolean; identity?: { name: string; email: string } }): Promise<GitResult<CommitOutcome>>;
  push(): Promise<GitResult<void>>;
  pull(): Promise<GitResult<void>>;
  fetch(): Promise<GitResult<void>>;
  setRemote(url: string): Promise<GitResult<void>>;
  branches(): Promise<GitResult<string[]>>;
  checkout(branch: string, create: boolean): Promise<GitResult<void>>;
  diff(req: GitDiffRequest): Promise<GitResult<GitDiffSides>>;
  /** The GitHub login Studio can use: undefined while unknown, null if there is none. */
  account: GithubAccount | null | undefined;
  loadAccount(): Promise<GithubAccount | null>;
  connectGithub(token: string): Promise<GitResult<GithubAccount>>;
  disconnectGithub(): Promise<void>;
  publish(req: GithubCreateRepoRequest): Promise<GitResult<GithubCreateRepoResult>>;
}

const sameStatus = (a: GitStatus | null, b: GitStatus) => a !== null && JSON.stringify(a) === JSON.stringify(b);

export function useGit(wb: CodeWorkbench): GitState {
  const api: GitApi | undefined = getDesktopAPI()?.studio?.git;
  const visible = useContext(EditorActiveContext);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<GithubAccount | null | undefined>(undefined);

  const wbRef = useRef(wb);
  wbRef.current = wb;
  const busyRef = useRef<string | null>(null);
  const inflight = useRef(false);

  const folder = useCallback(async () => {
    const ws = wbRef.current.ws;
    if (!ws) throw new Error("This project isn't open yet.");
    return ws.folder();
  }, []);

  const refresh = useCallback(async () => {
    if (!api || !wbRef.current.ws || inflight.current) return;
    inflight.current = true;
    try {
      const r = await api.status(await folder());
      if (r.ok) setStatus((prev) => (sameStatus(prev, r.value) ? prev : r.value));
    } catch {
      /* the project has no folder yet, or the window is closing */
    } finally {
      inflight.current = false;
    }
  }, [api, folder]);

  useEffect(() => {
    if (!api || !visible || !wb.ready) return;
    void refresh();
    const id = setInterval(() => {
      if (!document.hidden && !busyRef.current) void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [api, visible, wb.ready, refresh]);

  /** Run something that changes git, showing what it's doing and any failure, and looking again afterwards. */
  const act = useCallback(
    async <T,>(label: string, fn: (api: GitApi, folder: string) => Promise<GitResult<T>>, opts: { save?: boolean } = {}): Promise<GitResult<T>> => {
      if (!api) return { ok: false, kind: "failed", message: "Source control is part of the Crystal desktop app." };
      setBusy(label);
      busyRef.current = label;
      setError(null);
      try {
        // What is committed should be what is on screen: write unsaved edits first, as Build does.
        if (opts.save) await wbRef.current.saveAll();
        const r = await fn(api, await folder());
        if (!r.ok && !HANDLED.has(r.kind)) setError(r.message);
        return r;
      } catch (e) {
        const message = e instanceof Error ? clean(e.message) : "That didn't work.";
        setError(message);
        return { ok: false, kind: "failed", message };
      } finally {
        busyRef.current = null;
        setBusy(null);
        await refresh();
      }
    },
    [api, folder, refresh],
  );

  const direct = useCallback(
    async <T,>(fn: (api: GitApi, folder: string) => Promise<GitResult<T>>): Promise<GitResult<T>> => {
      if (!api) return { ok: false, kind: "failed", message: "Source control is part of the Crystal desktop app." };
      try {
        return await fn(api, await folder());
      } catch (e) {
        return { ok: false, kind: "failed", message: e instanceof Error ? clean(e.message) : "That didn't work." };
      }
    },
    [api, folder],
  );

  const loadAccount = useCallback(async () => {
    if (!api) return null;
    const r = await api.github.account().catch(() => null);
    const value = r && r.ok ? r.value : null;
    setAccount(value);
    return value;
  }, [api]);

  const derived = useMemo(() => {
    const changes = status?.changes ?? [];
    return {
      staged: changes.filter((c) => c.staged !== null && !c.conflicted),
      unstaged: changes.filter((c) => c.unstaged !== null || c.conflicted),
      byPath: new Map(changes.map((c) => [c.path, c] as const)),
    };
  }, [status]);

  return {
    available: !!api,
    status,
    busy,
    error,
    clearError: () => setError(null),
    ...derived,
    refresh,
    init: () => act("Initializing…", (a, f) => a.init(f)),
    stage: (paths) => act("Staging…", (a, f) => a.stage(f, paths), { save: true }),
    stageAll: () => act("Staging…", (a, f) => a.stageAll(f), { save: true }),
    unstage: (paths) => act("Unstaging…", (a, f) => a.unstage(f, paths)),
    unstageAll: () => act("Unstaging…", (a, f) => a.unstageAll(f)),
    discard: (paths) => act("Discarding…", (a, f) => a.discard(f, paths)),
    commit: (message, opts = {}) =>
      act(
        "Committing…",
        async (a, f): Promise<GitResult<CommitOutcome>> => {
          let held: string[] = [];
          if (opts.all) {
            const s = await a.stageAll(f);
            if (!s.ok) return s;
            held = s.value;
          }
          const c = await a.commit(f, message, opts.identity);
          return c.ok ? { ok: true, value: { ...c.value, held } } : c;
        },
        { save: true },
      ),
    push: () => act("Pushing…", (a, f) => a.push(f)),
    pull: () => act("Pulling…", (a, f) => a.pull(f)),
    fetch: () => act("Fetching…", (a, f) => a.fetch(f)),
    setRemote: (url) => act("Saving…", (a, f) => a.setRemote(f, url)),
    branches: () => direct((a, f) => a.branches(f)),
    checkout: (branch, create) => act("Switching branch…", (a, f) => a.checkout(f, branch, create), { save: true }),
    diff: (req) => direct((a, f) => a.diff(f, req)),
    account,
    loadAccount,
    connectGithub: async (token) => {
      if (!api) return { ok: false, kind: "failed", message: "Source control is part of the Crystal desktop app." };
      const r = await api.github.connect(token).catch((e): GitResult<GithubAccount> => ({ ok: false, kind: "failed", message: e instanceof Error ? clean(e.message) : "That didn't work." }));
      if (r.ok) setAccount(r.value);
      return r;
    },
    disconnectGithub: async () => {
      await api?.github.disconnect();
      setAccount(undefined);
      await loadAccount();
    },
    publish: (req) => act("Publishing…", (a, f) => a.github.publish(f, req), { save: true }),
  };
}

// --- Open in… -----------------------------------------------------------------------------------

export interface OpenInState {
  available: boolean;
  targets: OpenInTarget[];
  /** Ask again which programs are installed (cheap; the menu does it when it opens). */
  refresh(): Promise<void>;
  /** Start a program on the project. Terminal tools are started by the caller, not here. */
  open(id: string): Promise<GitResult<OpenInResult>>;
}

export function useOpenIn(wb: CodeWorkbench): OpenInState {
  const api = getDesktopAPI()?.studio?.openIn;
  const [targets, setTargets] = useState<OpenInTarget[]>([]);
  const wbRef = useRef(wb);
  wbRef.current = wb;

  const refresh = useCallback(async () => {
    if (!api) return;
    const r = await api.list().catch(() => null);
    if (r && r.ok) setTargets((prev) => (JSON.stringify(prev) === JSON.stringify(r.value) ? prev : r.value));
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (id: string): Promise<GitResult<OpenInResult>> => {
      const ws = wbRef.current.ws;
      if (!api || !ws) return { ok: false, kind: "failed", message: "This project isn't open yet." };
      try {
        return await api.open(await ws.folder(), id);
      } catch (e) {
        return { ok: false, kind: "failed", message: e instanceof Error ? clean(e.message) : "That didn't work." };
      }
    },
    [api],
  );

  return { available: !!api, targets, refresh, open };
}
