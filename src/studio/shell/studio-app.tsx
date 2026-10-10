"use client";

import { editorsToMount } from "@/studio/shell/mounted-editors";
import { Show } from "@clerk/react";
import { useQuery } from "convex/react";
import { AlertTriangle, BookOpen, Compass, FolderOpen, Save, FolderTree, Loader2, PanelLeftClose, PanelLeftOpen, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { AccountMenu } from "@/studio/shell/account-menu";
import { StudioSignIn } from "@/studio/shell/signin/studio-sign-in";
import { WindowControls } from "@/components/window-controls";
import { useTrafficLightsInset } from "@/hooks/use-window-controls";
import "@/studio/editor/illustrator.css";
import { CanvasEditor } from "@/studio/shell/canvas-editor";
import { EditorActiveContext, StudioChromeContext } from "@/studio/shell/chrome";
import { ReferenceView } from "@/studio/shell/reference-view";
import { TitleBar } from "@/studio/shell/title-bar";
import { Explorer } from "@/studio/shell/explorer";
import { KIND_ICON, NewProjectDialog } from "@/studio/shell/new-project-dialog";
import { BotEditor } from "@/studio/shell/bot-editor";
import { ExtensionEditor } from "@/studio/shell/extension-editor";
import { PackEditor } from "@/studio/shell/pack-editor";
import { PictureEditor } from "@/studio/shell/picture-editor";
import { MotionEditor } from "@/studio/motion/motion-editor";
import { ExploreView } from "@/studio/shell/explore-view";
import { SubmissionsView } from "@/studio/shell/submissions-view";
import { ThemePackEditor } from "@/studio/shell/theme-pack-editor";
import { forgetHistory } from "@/studio/editor/use-doc-editor";
import { KIND_LABEL, type Project, type ProjectKind } from "@/studio/model/types";
import { revealStorage, storageInfo } from "@/studio/storage/db";
import { UnsavedDialog } from "@/studio/shell/unsaved-dialog";
import { autosaves, useProjects } from "@/studio/storage/use-projects";
import { cn } from "@/lib/utils";

const OPEN_KEY = "crystal-studio-open";
type Activity = "projects" | "submissions" | "explore" | "reference";

function readOpen(): { open: string[]; active: string | null } {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "") as { open: string[]; active: string | null };
  } catch {
    return { open: [], active: null };
  }
}

function Welcome({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Crystal Studio</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Design avatar decorations, profile stickers, nameplates, effects, lounge scenes and theme packs — on this device, with your Crystal account — and send them to the Marketplace.
      </p>
      <button type="button" onClick={onNew} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
        New project
      </button>
    </div>
  );
}

function EditorFor({ project, all, onChange, onOpen }: { project: Project; all: Project[]; onChange: (p: Project) => void; onOpen: (id: string) => void }) {
  switch (project.kind) {
    case "decoration":
    case "sticker":
    case "scene":
      return <CanvasEditor key={project.id} project={project} onChange={onChange} />;
    case "nameplate":
    case "effect":
      // Made in the canvas and timeline editors; an older one that is only a picture keeps the picture editor.
      return project.doc ? <MotionEditor key={project.id} project={project} onChange={onChange} /> : <PictureEditor key={project.id} project={project} onChange={onChange} />;
    case "themePack":
      return <ThemePackEditor key={project.id} project={project} onChange={onChange} />;
    case "extension":
      return <ExtensionEditor key={project.id} project={project} onChange={onChange} />;
    case "bot":
      return <BotEditor key={project.id} project={project} onChange={onChange} />;
    case "pack":
      return <PackEditor key={project.id} project={project} all={all} onChange={onChange} onOpen={onOpen} />;
  }
}

function Workspace() {
  const trafficLights = useTrafficLightsInset();
  const { projects, loadErrors, dirty, update, save, revert, create, duplicate, remove } = useProjects();
  // A code project's unsaved *files* are inside its editor; it reports them here (see StudioChrome).
  const unsavedFiles = useRef(new Map<string, { dirty: boolean; save: () => Promise<void> }>());
  const [, bumpUnsaved] = useState(0);
  const registerUnsaved = useCallback((id: string, source: { dirty: boolean; save: () => Promise<void> } | null) => {
    const before = unsavedFiles.current.get(id)?.dirty ?? false;
    if (source) unsavedFiles.current.set(id, source);
    else unsavedFiles.current.delete(id);
    if (before !== (source?.dirty ?? false)) bumpUnsaved((n) => n + 1);
  }, []);
  const isDirty = useCallback((id: string) => dirty.has(id) || (unsavedFiles.current.get(id)?.dirty ?? false), [dirty]);
  /** Everything about a project: its files if it has an editor holding some, and its settings. */
  const saveProject = useCallback(async (id: string) => {
    const files = unsavedFiles.current.get(id);
    if (files) await files.save();
    await save(id);
  }, [save]);
  /** Whether anything is unsaved, in a project's settings or in a code project's files. */
  const anyUnsaved = useCallback(() => dirty.size > 0 || [...unsavedFiles.current.values()].some((f) => f.dirty), [dirty]);
  const [closing, setClosing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [issuesHidden, setIssuesHidden] = useState(false);
  const storage = projects ? storageInfo() : null;
  const me = useQuery(api.users.getCurrentUser);
  const [activity, setActivity] = useState<Activity>("projects");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [exploreTopic, setExploreTopic] = useState("start");
  const [referenceAnchor, setReferenceAnchor] = useState("bot/Client");
  // Studio's own tab icon and title on the web (in the desktop app the window's icon is set by the main process). A page
  // that is a client component can't export Next metadata, so it is set here, and put back if Studio is left.
  //
  // The icon links in <head> belong to Next and React: React removes them itself the next time it updates the head, and
  // throws ("Cannot read properties of null (reading 'removeChild')") if one has already been taken out from under it. So
  // they are only ever *edited* here, never removed or replaced.
  useEffect(() => {
    const before = document.title;
    document.title = "Crystal Studio";
    const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
    const saved = links.map((l) => ({ href: l.getAttribute("href"), sizes: l.getAttribute("sizes") }));
    for (const l of links) {
      l.setAttribute("href", "/studio-icon-32.png");
      l.setAttribute("sizes", "32x32");
    }
    return () => {
      document.title = before;
      links.forEach((l, i) => {
        if (!l.isConnected) return;
        if (saved[i].href !== null) l.setAttribute("href", saved[i].href);
        if (saved[i].sizes !== null) l.setAttribute("sizes", saved[i].sizes);
        else l.removeAttribute("sizes");
      });
    };
  }, []);
  const [menuHost, setMenuHost] = useState<HTMLElement | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLElement | null>(null);
  const [barHost, setBarHost] = useState<HTMLElement | null>(null);

  // Come back to what was open.
  useEffect(() => {
    if (!projects || restored) return;
    const saved = readOpen();
    const ids = saved.open.filter((id) => projects.some((p) => p.id === id));
    setOpenIds(ids);
    setActiveId(saved.active && ids.includes(saved.active) ? saved.active : (ids[0] ?? null));
    setRestored(true);
  }, [projects, restored]);
  useEffect(() => {
    if (restored) localStorage.setItem(OPEN_KEY, JSON.stringify({ open: openIds, active: activeId }));
  }, [openIds, activeId, restored]);

  const open = useCallback((id: string) => {
    setOpenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
    setActivity("projects");
  }, []);

  /** Open Explore at a guide — what the editors' Help menus call. */
  const openGuides = useCallback((topic?: string) => {
    if (topic) setExploreTopic(topic);
    setActivity("explore");
  }, []);

  /** Open the SDK reference at an item (`bot/Client`, `bot/Client.on`). */
  const openReference = useCallback((anchor?: string) => {
    if (anchor) setReferenceAnchor(anchor);
    setActivity("reference");
  }, []);

  const closeNow = useCallback(
    (id: string) => {
      setOpenIds((prev) => {
        const next = prev.filter((x) => x !== id);
        setActiveId((cur) => (cur === id ? (next[Math.max(0, prev.indexOf(id) - 1)] ?? null) : cur));
        return next;
      });
    },
    [],
  );

  /** Close a project's tab; if it has unsaved changes, ask first. */
  const close = useCallback(
    (id: string) => {
      if (isDirty(id)) setClosing(id);
      else closeNow(id);
    },
    [isDirty, closeNow],
  );
  const answerClose = async (answer: "save" | "discard" | "cancel") => {
    const id = closing;
    if (!id || answer === "cancel") return setClosing(null);
    if (answer === "save") await saveProject(id); // throws to the dialog, which stays up, if it can't
    else {
      revert(id);
      forgetHistory(id);
    }
    setClosing(null);
    closeNow(id);
  };

  const all = useMemo(() => projects ?? [], [projects]);
  const active = all.find((p) => p.id === activeId) ?? null;
  const tabs = openIds.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Project[];
  // Editors on screen: the active project's, plus every open code project. A code project's state lives in its
  // editor — unsaved files, and the shells running in its terminals — so unmounting it on a switch of tab would
  // throw that away (a terminal's process is killed when it unmounts). It stays mounted, hidden, until its tab is closed.
  const mounted = editorsToMount(tabs, activeId);

  const failed = (what: string) => (e: unknown) =>
    setActionError(`${what}: ${e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "something went wrong."}`);

  const onCreate = async (kind: ProjectKind, name: string) => {
    try {
      const p = await create(kind, name);
      open(p.id);
    } catch (e) {
      failed("Couldn't create the project")(e);
    }
  };

  const canvasOpen = activity === "projects" && !!active && (active.kind === "decoration" || active.kind === "sticker" || active.kind === "scene" || ((active.kind === "nameplate" || active.kind === "effect") && !!active.doc));

  // Escape-hatch shortcuts for the workspace itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setNewOpen(true);
      } else if (mod && e.key.toLowerCase() === "w" && activeId) {
        e.preventDefault();
        close(activeId);
      } else if (mod && e.key.toLowerCase() === "b" && !e.shiftKey && !canvasOpen) {
        // ⌘B is Paste in Back in a design (as in Illustrator); the side bar button still toggles the Explorer there.
        e.preventDefault();
        setExplorerOpen((o) => !o);
      } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s" && activeId) {
        // The code editor's own ⌘S (Monaco) does the same; this is for focus anywhere else.
        e.preventDefault();
        void saveProject(activeId).catch((err) => failed("Couldn't save")(err));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, close, canvasOpen, saveProject]);

  // Closing the window over unsaved work: say so. In Electron the main process turns this into a
  // "Leave / Stay" question; in a browser it is the browser's own prompt.
  const anyDirty = dirty.size > 0 || [...unsavedFiles.current.values()].some((u) => u.dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  return (
    <StudioChromeContext.Provider value={{ menuHost, actionsHost, barHost, openGuides, openReference, saveSettings: save, saveProject, isDirty, registerUnsaved }}>
    <div className="ai flex h-full flex-col bg-[var(--ai-body)] text-[var(--ai-text)]">
      <TitleBar title={activity === "projects" && active ? active.name : null} inset={trafficLights} setMenuHost={setMenuHost} setActionsHost={setActionsHost} account={<AccountMenu hasUnsaved={anyUnsaved} />} />
      {/* ...and its control bar here. */}
      <div ref={setBarHost} className="flex shrink-0 empty:hidden" />

      <div className="flex min-h-0 flex-1">
        {/* The activity bar. */}
        <nav className="flex w-10 shrink-0 flex-col items-center gap-px ai-edge-r bg-[var(--ai-body)] py-1.5">
          {(
            [
              ["projects", FolderTree, "Projects"],
              ["submissions", Send, "Submissions"],
              ["explore", Compass, "Explore"],
              ["reference", BookOpen, "Reference"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={activity === id}
              onClick={() => (activity === id && id === "projects" ? setExplorerOpen((o) => !o) : (setActivity(id), setExplorerOpen(true)))}
              className="ai-tool !h-8 !w-8" data-active={activity === id}
            >
              <Icon className="size-[18px]" strokeWidth={1.5} />
            </button>
          ))}
          <button type="button" aria-label={explorerOpen ? "Hide the side bar" : "Show the side bar"} onClick={() => setExplorerOpen((o) => !o)} className="ai-tool mt-auto !h-8 !w-8">
            {explorerOpen ? <PanelLeftClose className="size-[18px]" strokeWidth={1.5} /> : <PanelLeftOpen className="size-[18px]" strokeWidth={1.5} />}
          </button>
        </nav>

        {activity === "projects" && explorerOpen && (
          <aside className="w-60 shrink-0 ai-edge-r bg-[var(--ai-body)]">
            <Explorer
              projects={projects}
              activeId={activeId}
              onOpen={open}
              onNew={() => setNewOpen(true)}
              onDuplicate={async (id) => {
                try {
                  const copy = await duplicate(id);
                  if (copy) open(copy.id);
                } catch (e) {
                  failed("Couldn't duplicate the project")(e);
                }
              }}
              onDelete={async (id) => {
                // Removed first, closed after: if it can't be moved to the Trash it stays open.
                try {
                  await remove(id);
                  closeNow(id);
                  forgetHistory(id);
                } catch (e) {
                  failed("Couldn't delete the project")(e);
                }
              }}
            />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {activity === "explore" && (
            <div className="min-h-0 flex-1">
              <ExploreView topic={exploreTopic} onTopic={setExploreTopic} onNew={(kind, name) => void onCreate(kind, name)} />
            </div>
          )}
          {activity === "reference" && (
            <div className="min-h-0 flex-1">
              <ReferenceView anchor={referenceAnchor} onAnchor={setReferenceAnchor} />
            </div>
          )}
          {activity === "submissions" && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SubmissionsView />
            </div>
          )}
          {/* Always mounted, hidden while another activity is showing, so what is open in the editors isn't lost. */}
          <div className={cn("flex min-h-0 flex-1 flex-col", activity !== "projects" && "hidden")}>
            <>
              {(actionError || (!issuesHidden && loadErrors.length > 0)) && (
                <div role="alert" className="shrink-0 space-y-1 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                  {actionError && (
                    <p className="flex items-start gap-2 text-destructive">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1">{actionError}</span>
                      <button type="button" aria-label="Dismiss" onClick={() => setActionError(null)}><X className="size-3.5" /></button>
                    </p>
                  )}
                  {!issuesHidden &&
                    loadErrors.map((e, i) => (
                      <p key={i} className="flex items-start gap-2">
                        <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", e.level === "error" ? "text-destructive" : "text-amber-500")} />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{e.folder}</span> — {e.level === "error" ? "couldn't be opened: " : ""}
                          {e.message}
                        </span>
                        {i === 0 && (
                          <button type="button" aria-label="Dismiss" onClick={() => setIssuesHidden(true)}><X className="size-3.5" /></button>
                        )}
                      </p>
                    ))}
                </div>
              )}
              <div role="tablist" className="flex h-7 shrink-0 items-stretch overflow-x-auto bg-[var(--ai-header)]">
                {tabs.map((t) => {
                  const Icon = KIND_ICON[t.kind];
                  return (
                    <div key={t.id} role="tab" aria-selected={t.id === activeId} className="ai-doctab group max-w-72 min-w-0 border-r border-[var(--ai-edge)]">
                      <button type="button" onClick={() => setActiveId(t.id)} className="flex min-w-0 items-center gap-1.5" title={`${t.name} — ${KIND_LABEL[t.kind]}`}>
                        <Icon className="size-3 shrink-0" strokeWidth={1.5} />
                        <span className="truncate">{t.name}</span>
                        {isDirty(t.id) && <span aria-label="Unsaved changes" title="Unsaved changes (⌘S saves)" className="size-1.5 shrink-0 rounded-full bg-current" />}
                      </button>
                      <button type="button" aria-label={`Close ${t.name}`} onClick={() => close(t.id)} className="rounded-[2px] p-0.5 opacity-60 hover:bg-[var(--ai-hover)] hover:opacity-100">
                        <X className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="min-h-0 flex-1">
                {projects === null ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : active ? (
                  <>
                    {mounted.map((p) => (
                      <div key={p.id} className={p.id === active.id ? "h-full" : "hidden"} aria-hidden={p.id !== active.id}>
                        <EditorActiveContext.Provider value={activity === "projects" && p.id === active.id}>
                          <EditorFor project={p} all={all} onChange={(next) => update(p.id, () => next)} onOpen={open} />
                        </EditorActiveContext.Provider>
                      </div>
                    ))}
                  </>
                ) : (
                  <Welcome onNew={() => setNewOpen(true)} />
                )}
              </div>
            </>
          </div>
        </main>
      </div>

      <footer className="flex h-5 shrink-0 items-center gap-4 border-t border-[var(--ai-edge)] bg-[var(--ai-body)] px-3 text-[11px] text-[var(--ai-dim)]">
        <span>{me ? `Signed in as ${me.name}` : "Signing in…"}</span>
        <span>{projects ? `${projects.length} project${projects.length === 1 ? "" : "s"}` : ""}</span>
        {storage?.kind === "disk" ? (
          <button type="button" onClick={() => void revealStorage()} title="Show in the file manager" className="flex min-w-0 items-center gap-1 truncate hover:text-foreground">
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate">{storage.root}</span>
          </button>
        ) : storage ? (
          <span>Saved in this browser</span>
        ) : null}
        {active && autosaves(active) ? (
          <span className="ml-auto">Autosaved</span>
        ) : active && isDirty(active.id) ? (
          <button type="button" onClick={() => void saveProject(active.id).catch((err) => failed("Couldn't save")(err))} className="ml-auto flex items-center gap-1 text-[var(--ai-accent)] hover:underline" title="Save (⌘S)">
            <Save className="size-3" /> Unsaved changes — Save
          </button>
        ) : (
          <span className="ml-auto">{active ? "All changes saved" : ""}</span>
        )}
      </footer>

      <UnsavedDialog name={closing ? (all.find((p) => p.id === closing)?.name ?? "this project") : null} onAnswer={answerClose} />
      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreate={onCreate} />
    </div>
    </StudioChromeContext.Provider>
  );
}

/** Studio uses the account the rest of Crystal does — signed out, it asks you to sign in. */
export function StudioApp() {
  return (
    <>
      <Show when="signed-in">
        <Workspace />
      </Show>
      <Show when="signed-out">
        <StudioSignIn />
      </Show>
    </>
  );
}
