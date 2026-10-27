"use client";

import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getDesktopAPI } from "@/lib/desktop";
import { lintExtension } from "@/studio/code/crystal-lint";
import { registerSnippets } from "@/studio/code/crystal-snippets";
import { NODE_SHIM_DTS } from "@/studio/model/code-templates";
import type { Project } from "@/studio/model/types";
import { configureTypeScript, diagnose, isCodeFile, languageFor, loadMonaco, replaceModelText, uriFor, type MonacoApi, type Problem } from "@/studio/code/monaco";
import { useStudioChrome } from "@/studio/shell/chrome";
import { ensureScaffold, openWorkspace, parentOf, type Workspace } from "@/studio/storage/workspace";

/**
 * The state behind a code project's workbench: which files are open, what has changed, what is
 * saved, and what the TypeScript service thinks of it all.
 *
 * The files on disk are the truth and the editor is a view of them. Two things follow:
 *
 *  - **Nothing is written until the person saves** (⌘S, File ▸ Save, Build, Run). Before writing, the
 *    file's modification time is compared with what was last read or written: if something else
 *    changed it (VS Code, git, a script run in the terminal) Studio does *not* overwrite it, and
 *    says so, leaving the choice to the person. Closing a file with unsaved edits asks first
 *    (`closeRequest`), and so does closing the project (the dirty state is reported to Studio).
 *  - **Nothing is lost to an outside edit.** Open files are checked every couple of seconds. A file
 *    that hasn't been touched here is reloaded quietly, keeping undo; one that has is flagged.
 */

const POLL_MS = 2000;
const MAX_FILES = 300;
const SITE = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "https://YOUR-DEPLOYMENT.convex.site";

export type BuildState =
  | { status: "idle" }
  | { status: "building" }
  | { status: "ok"; bytes: number; files: number; at: number }
  | { status: "failed"; errors: { file?: string; line?: number; column?: number; text: string }[] };

interface Meta {
  /** Modification time at the last read or write by this window. */
  mtime: number | null;
  /** The model's version id when last saved: differs from now ⇒ unsaved changes. */
  savedVersion: number;
}

export interface CodeWorkbench {
  available: boolean;
  /** The folder can't be reached, Monaco failed to load, or a save failed. */
  error: string | null;
  clearError(): void;
  ready: boolean;
  monaco: MonacoApi | null;
  ws: Workspace | null;
  open: string[];
  active: string | null;
  dirty: Set<string>;
  /** Files changed on disk by something else while edits here were pending. */
  conflicts: Set<string>;
  /** Files that vanished from disk while open. */
  missing: Set<string>;
  problems: Problem[];
  build: BuildState;
  /** Open a file (and switch to it). */
  openFile(path: string, at?: { line: number; column: number }): Promise<void>;
  closeFile(path: string): void;
  setActive(path: string | null): void;
  saveFile(path: string): Promise<void>;
  saveAll(): Promise<void>;
  /** Throw away this window's version of a changed file and take the disk's. */
  reloadFromDisk(path: string): Promise<void>;
  /** A file the person tried to close while it has unsaved edits: the view asks what to do. */
  closeRequest: string | null;
  answerClose(answer: "save" | "discard" | "cancel"): Promise<void>;
  /** Keep this window's version and write it over the disk's. */
  overwriteDisk(path: string): Promise<void>;
  /** After a rename or delete from the tree. */
  pathChanged(from: string, to: string | null): Promise<void>;
  /** Check the project with the TypeScript service. */
  check(): Promise<Problem[]>;
  /** Save, then bundle `src/` into `dist/extension.js` (extensions only). */
  buildExtension(): Promise<{ ok: true; code: string } | { ok: false }>;
  /** The model behind a path, for the editor to show. */
  modelFor(path: string): Monaco.editor.ITextModel | null;
  /** How many files the project's TypeScript service is looking at. */
  tsFiles(): string[];
  /** Every text file in the project (not node_modules, dist or .git), for Quick Open and search. */
  allFiles(): Promise<string[]>;
}

export function useCodeWorkbench(project: Project): CodeWorkbench {
  const kind = project.kind as "extension" | "bot";
  const ws = useMemo(() => openWorkspace(project.id), [project.id]);
  const [monaco, setMonaco] = useState<MonacoApi | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [conflicts, setConflicts] = useState<Set<string>>(new Set());
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [problems, setProblems] = useState<Problem[]>([]);
  const [build, setBuild] = useState<BuildState>({ status: "idle" });

  const models = useRef(new Map<string, Monaco.editor.ITextModel>());
  const meta = useRef(new Map<string, Meta>());
  const saving = useRef(new Set<string>());
  const subs = useRef<Monaco.IDisposable[]>([]);
  const chrome = useStudioChrome();
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const projectRef = useRef(project);
  projectRef.current = project;
  const shim = useRef<Monaco.IDisposable | null>(null);

  const mark = (set: React.Dispatch<React.SetStateAction<Set<string>>>, path: string, on: boolean) =>
    set((prev) => {
      if (prev.has(path) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });

  const isDirty = useCallback((path: string) => {
    const m = models.current.get(path);
    const info = meta.current.get(path);
    return !!m && !!info && m.getAlternativeVersionId() !== info.savedVersion;
  }, []);

  // --- models ----------------------------------------------------------------------------------
  const attach = useCallback(
    (mon: MonacoApi, path: string, text: string, mtime: number | null) => {
      const existing = models.current.get(path);
      if (existing) return existing;
      const model = mon.editor.createModel(text, languageFor(path), uriFor(mon, path));
      models.current.set(path, model);
      meta.current.set(path, { mtime, savedVersion: model.getAlternativeVersionId() });
      subs.current.push(
        model.onDidChangeContent(() => {
          mark(setDirty, path, isDirty(path));
        }),
      );
      return model;
    },
    [isDirty],
  );

  /**
   * The project's TypeScript files — its own and the SDK's — so the language service can resolve
   * imports whether or not a tab is open.
   *
   * Every file is read first and the models are made together, with nothing awaited in between.
   * Monaco checks a file as soon as its model exists and doesn't check it again when a file it
   * imports turns up later, so loading them one at a time leaves stale "Cannot find module"
   * errors behind; and once they are all there it is asked to check everything once more, which
   * also covers files added to the folder while the editor is open.
   */
  const loadSources = useCallback(
    async (mon: MonacoApi, w: Workspace) => {
      const found: { path: string; text: string; mtime: number }[] = [];
      let count = 0;
      const walk = async (dir: string, depth: number) => {
        if (depth > 6 || count >= MAX_FILES) return;
        for (const e of await w.list(dir).catch(() => [])) {
          if (e.isDir) {
            if (!["node_modules", "dist", ".git"].includes(e.name)) await walk(e.path, depth + 1);
          } else if (isCodeFile(e.path) && e.size < 1024 * 1024 && ++count <= MAX_FILES && !models.current.has(e.path)) {
            found.push({ path: e.path, text: await w.read(e.path).catch(() => ""), mtime: e.mtimeMs });
          }
        }
      };
      for (const top of ["src", `.crystal/sdk/${kind}`]) await walk(top, 0);
      if (found.length === 0) return;
      for (const f of found) attach(mon, f.path, f.text, f.mtime);
      // Same options, set again: that is what makes the language service re-check every model.
      const ts = mon.languages.typescript;
      for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) defaults.setDiagnosticsOptions({ ...defaults.getDiagnosticsOptions() });
    },
    [attach, kind],
  );

  /** For a bot: Node's real types, once `npm install` has put them in the project. Until then, a small stand-in. */
  const loadNodeTypes = useCallback(async (mon: MonacoApi, w: Workspace) => {
    const root = "node_modules/@types/node";
    if (!(await w.exists(`${root}/index.d.ts`).catch(() => false))) return false;
    const libs: { content: string; filePath: string }[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 3 || libs.length > 400) return;
      for (const e of await w.list(dir).catch(() => [])) {
        if (e.isDir) await walk(e.path, depth + 1);
        else if (e.name.endsWith(".d.ts") && e.size < 1024 * 1024) libs.push({ content: await w.read(e.path).catch(() => ""), filePath: `file:///${e.path}` });
      }
    };
    await walk(root, 0);
    shim.current?.dispose();
    shim.current = null;
    mon.languages.typescript.typescriptDefaults.setExtraLibs(libs);
    return true;
  }, []);

  // --- start up --------------------------------------------------------------------------------
  useEffect(() => {
    if (!ws) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureScaffold(ws, projectRef.current, SITE);
        const mon = await loadMonaco();
        if (cancelled) return;
        configureTypeScript(mon, kind);
        subs.current.push(registerSnippets(mon, kind));
        await loadSources(mon, ws);
        if (kind === "bot") {
          if (!(await loadNodeTypes(mon, ws))) shim.current = mon.languages.typescript.typescriptDefaults.addExtraLib(NODE_SHIM_DTS, "file:///node-shim.d.ts");
        }
        if (cancelled) return;
        setMonaco(mon);
        setReady(true);
        const first = "src/index.ts";
        if (models.current.has(first)) {
          setOpen([first]);
          setActiveState(first);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "The editor couldn't start.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, kind]);

  // Everything is let go when the workbench closes, so the next project starts clean. Unsaved edits
  // are *not* written on the way out: Studio asks before it closes a project that has any.
  useEffect(
    () => () => {
      for (const s of subs.current) s.dispose();
      for (const m of models.current.values()) m.dispose();
      shim.current?.dispose();
      models.current.clear();
      meta.current.clear();
      subs.current = [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws],
  );

  // --- saving ----------------------------------------------------------------------------------
  const conflictsRef = useRef(conflicts);
  conflictsRef.current = conflicts;

  const doSave = useCallback(
    async (path: string, force = false) => {
      const model = models.current.get(path);
      const info = meta.current.get(path);
      if (!ws || !model || !info || saving.current.has(path)) return;
      if (!force && conflictsRef.current.has(path)) return;
      saving.current.add(path);
      try {
        const version = model.getAlternativeVersionId();
        const current = await ws.stat(path);
        // Something else wrote this file since it was last read or written here: don't overwrite it.
        if (!force && current && info.mtime !== null && current.mtimeMs !== info.mtime) {
          mark(setConflicts, path, true);
          return;
        }
        const mtime = await ws.write(path, model.getValue());
        info.mtime = mtime;
        info.savedVersion = version;
        mark(setDirty, path, isDirty(path));
        mark(setConflicts, path, false);
        mark(setMissing, path, false);
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "Couldn't save.");
      } finally {
        saving.current.delete(path);
      }
    },
    [ws, isDirty],
  );
  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  const saveFile = useCallback((path: string) => doSave(path), [doSave]);
  /** The files, and the project's settings: what ⌘S means in a code project. */
  const saveAll = useCallback(async () => {
    for (const path of models.current.keys()) if (isDirty(path)) await doSave(path);
    await chromeRef.current.saveSettings?.(projectRef.current.id);
  }, [doSave, isDirty]);

  // Studio asks before closing a project with unsaved files, so it has to be able to know.
  const saveAllRef = useRef(saveAll);
  saveAllRef.current = saveAll;
  const hasUnsaved = dirty.size > 0;
  const projectId = project.id;
  useEffect(() => {
    chromeRef.current.registerUnsaved?.(projectId, { dirty: hasUnsaved, save: () => saveAllRef.current() });
  }, [projectId, hasUnsaved]);
  useEffect(() => () => chromeRef.current.registerUnsaved?.(projectId, null), [projectId]);

  // --- changes made outside Studio ---------------------------------------------------------------
  useEffect(() => {
    if (!ws || !monaco) return;
    let stop = false;
    let busy = false;
    const tick = async () => {
      if (busy || stop) return;
      busy = true;
      try {
        // One listing per folder, not one per file.
        const byDir = new Map<string, string[]>();
        for (const path of models.current.keys()) byDir.set(parentOf(path), [...(byDir.get(parentOf(path)) ?? []), path]);
        for (const [dir, paths] of byDir) {
          const listing = await ws.list(dir).catch(() => null);
          if (!listing) continue;
          for (const path of paths) {
            const info = meta.current.get(path);
            const model = models.current.get(path);
            if (!info || !model || saving.current.has(path)) continue;
            const entry = listing.find((e) => e.path === path);
            if (!entry) {
              mark(setMissing, path, true);
              continue;
            }
            mark(setMissing, path, false);
            if (info.mtime === null || entry.mtimeMs === info.mtime) continue;
            if (isDirty(path)) {
              mark(setConflicts, path, true);
            } else {
              replaceModelText(monaco, model, await ws.read(path));
              info.mtime = entry.mtimeMs;
              info.savedVersion = model.getAlternativeVersionId();
              mark(setDirty, path, false);
            }
          }
        }
        // A new .ts file made outside Studio (or by the terminal) joins the language service.
        await loadSources(monaco, ws);
        // A bot still on the stand-in types picks up the real ones as soon as `npm install` has run.
        if (kind === "bot" && shim.current) await loadNodeTypes(monaco, ws);
      } finally {
        busy = false;
      }
    };
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [ws, monaco, kind, isDirty, loadSources, loadNodeTypes]);

  // --- Crystal's own checks, live ------------------------------------------------------------------
  // For an extension: powers used but not asked for, code that builds code, packages the sandbox
  // can't load, sites off the list. They are markers like TypeScript's, so they underline in the
  // editor and join the Problems list; they are re-run when the code or the declared powers change.
  const powers = project.extension?.capabilities.join(",") ?? "";
  const sites = project.extension?.network.join(",") ?? "";
  useEffect(() => {
    if (!monaco || kind !== "extension") return;
    const opts = { capabilities: powers ? powers.split(",") : [], network: sites ? sites.split(",") : [] };
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const run = (path: string, model: Monaco.editor.ITextModel) => {
      if (model.isDisposed()) return;
      const found = lintExtension(model.getValue(), opts);
      monaco.editor.setModelMarkers(
        model,
        "crystal",
        found.map((f) => {
          const a = model.getPositionAt(f.start);
          const b = model.getPositionAt(f.end);
          return {
            severity: f.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            message: f.message,
            source: "Crystal",
            code: f.code,
            startLineNumber: a.lineNumber,
            startColumn: a.column,
            endLineNumber: b.lineNumber,
            endColumn: b.column,
          };
        }),
      );
    };
    const watched = new Set<string>();
    const watch = () => {
      for (const [path, model] of models.current) {
        // Only the author's own code: the SDK is Crystal's, and is allowed to touch the host.
        if (!path.startsWith("src/") || !isCodeFile(path)) continue;
        run(path, model);
        if (watched.has(path)) continue;
        watched.add(path);
        subs.current.push(
          model.onDidChangeContent(() => {
            clearTimeout(timers.get(path));
            timers.set(path, setTimeout(() => run(path, model), 250));
          }),
        );
      }
    };
    watch();
    // Files that appear later (a new file, one made in the terminal) are picked up on the same beat.
    const again = setInterval(watch, POLL_MS);
    return () => {
      clearInterval(again);
      for (const t of timers.values()) clearTimeout(t);
      for (const model of models.current.values()) if (!model.isDisposed()) monaco.editor.setModelMarkers(model, "crystal", []);
    };
  }, [monaco, kind, powers, sites]);

  // --- problems, live ----------------------------------------------------------------------------
  useEffect(() => {
    if (!monaco) return;
    const read = () => {
      const out: Problem[] = [];
      for (const m of monaco.editor.getModelMarkers({})) {
        if (m.severity < monaco.MarkerSeverity.Warning) continue;
        const path = m.resource.path.replace(/^\//, "");
        // The SDK is Crystal's code, not the author's: its models are loaded so imports resolve, but a
        // problem inside it isn't something they can fix, so it doesn't appear in their list.
        if (!models.current.has(path) || path.startsWith(".crystal/")) continue;
        out.push({ file: path, line: m.startLineNumber, column: m.startColumn, message: m.message, severity: m.severity === monaco.MarkerSeverity.Error ? "error" : "warning" });
      }
      out.sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning") || a.file.localeCompare(b.file) || a.line - b.line);
      setProblems(out);
    };
    read();
    const d = monaco.editor.onDidChangeMarkers(read);
    return () => d.dispose();
  }, [monaco]);

  // --- tabs --------------------------------------------------------------------------------------
  const openFile = useCallback(
    async (path: string) => {
      if (!ws || !monaco) return;
      if (!models.current.has(path)) {
        const st = await ws.stat(path);
        if (!st || st.isDir) return;
        if (st.size > 2 * 1024 * 1024) {
          setError(`${path} is too large to edit here.`);
          return;
        }
        attach(monaco, path, await ws.read(path), st.mtimeMs);
      }
      setOpen((o) => (o.includes(path) ? o : [...o, path]));
      setActiveState(path);
    },
    [ws, monaco, attach],
  );

  const [closeRequest, setCloseRequest] = useState<string | null>(null);
  const finishClose = useCallback((path: string) => {
    setOpen((o) => {
      const next = o.filter((p) => p !== path);
      setActiveState((cur) => (cur === path ? (next[Math.max(0, o.indexOf(path) - 1)] ?? null) : cur));
      return next;
    });
    // TypeScript sources stay loaded as models (the service needs them); other files are let go.
    if (!isCodeFile(path)) {
      models.current.get(path)?.dispose();
      models.current.delete(path);
      meta.current.delete(path);
    }
  }, []);
  /** Close a tab. A file with unsaved edits asks first: see `closeRequest` and `answerClose`. */
  const closeFile = useCallback(
    (path: string) => {
      if (isDirty(path)) setCloseRequest(path);
      else finishClose(path);
    },
    [isDirty, finishClose],
  );

  const reloadFromDisk = useCallback(
    async (path: string) => {
      const model = models.current.get(path);
      const info = meta.current.get(path);
      if (!ws || !monaco || !model || !info) return;
      const st = await ws.stat(path);
      if (!st) return;
      replaceModelText(monaco, model, await ws.read(path));
      info.mtime = st.mtimeMs;
      info.savedVersion = model.getAlternativeVersionId();
      mark(setDirty, path, false);
      mark(setConflicts, path, false);
    },
    [ws, monaco],
  );
  const overwriteDisk = useCallback((path: string) => doSave(path, true), [doSave]);
  const answerClose = useCallback(
    async (answer: "save" | "discard" | "cancel") => {
      const path = closeRequest;
      setCloseRequest(null);
      if (!path || answer === "cancel") return;
      if (answer === "save") await doSave(path, conflictsRef.current.has(path));
      else await reloadFromDisk(path);
      // A save that didn't go through (a conflict) leaves the file open and unsaved.
      if (answer === "discard" || !models.current.get(path) || !isDirty(path)) finishClose(path);
    },
    [closeRequest, doSave, reloadFromDisk, isDirty, finishClose],
  );

  const pathChanged = useCallback(
    async (from: string, to: string | null) => {
      if (!monaco || !ws) return;
      // Everything at or under `from`: a renamed folder moves all its open files.
      for (const path of [...models.current.keys()]) {
        if (path !== from && !path.startsWith(`${from}/`)) continue;
        const text = models.current.get(path)!.getValue();
        const wasOpen = open.includes(path);
        models.current.get(path)!.dispose();
        models.current.delete(path);
        meta.current.delete(path);
        mark(setDirty, path, false);
        setOpen((o) => o.filter((p) => p !== path));
        setActiveState((cur) => (cur === path ? null : cur));
        if (to) {
          const next = to + path.slice(from.length);
          const st = await ws.stat(next);
          if (st) {
            attach(monaco, next, text, st.mtimeMs);
            if (wasOpen) setOpen((o) => [...o, next]);
          }
        }
      }
      if (to) await loadSources(monaco, ws);
    },
    [monaco, ws, open, attach, loadSources],
  );

  // --- checking and building ------------------------------------------------------------------
  const tsFiles = useCallback(() => [...models.current.keys()].filter(isCodeFile), []);
  const allFiles = useCallback(async () => {
    if (!ws) return [];
    const out: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 8 || out.length > 2000) return;
      for (const e of await ws.list(dir).catch(() => [])) {
        if (e.isDir) {
          if (!["node_modules", "dist", ".git", "assets", ".crystal"].includes(e.name)) await walk(e.path, depth + 1);
        } else if (e.size < 1024 * 1024 && !/\.crysproj$/.test(e.name)) out.push(e.path);
      }
    };
    await walk("", 0);
    return out.sort();
  }, [ws]);
  const check = useCallback(async () => {
    if (!monaco) return [];
    return diagnose(monaco, tsFiles());
  }, [monaco, tsFiles]);

  const buildExtension = useCallback(async (): Promise<{ ok: true; code: string } | { ok: false }> => {
    const api = getDesktopAPI()?.studio;
    if (!ws || !api) return { ok: false };
    setBuild({ status: "building" });
    try {
      await saveAll();
      const folder = await ws.folder();
      const result = await api.build.extension(folder);
      if (!result.ok) {
        setBuild({ status: "failed", errors: result.errors });
        return { ok: false };
      }
      setBuild({ status: "ok", bytes: result.bytes, files: result.files, at: Date.now() });
      return { ok: true, code: result.code };
    } catch (e) {
      setBuild({ status: "failed", errors: [{ text: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "The build failed." }] });
      return { ok: false };
    }
  }, [ws, saveAll]);

  return {
    available: !!ws,
    error,
    clearError: () => setError(null),
    ready,
    monaco,
    ws,
    open,
    active,
    dirty,
    conflicts,
    missing,
    problems,
    build,
    openFile,
    closeFile,
    setActive: setActiveState,
    closeRequest,
    answerClose,
    saveFile,
    saveAll,
    reloadFromDisk,
    overwriteDisk,
    pathChanged,
    check,
    buildExtension,
    modelFor: (p) => models.current.get(p) ?? null,
    tsFiles,
    allFiles,
  };
}
