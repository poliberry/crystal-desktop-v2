"use client";

import { Show } from "@clerk/react";
import { useQuery } from "convex/react";
import { FolderTree, Loader2, PanelLeftClose, PanelLeftOpen, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../../convex/_generated/api";
import AuthFlow from "@/components/auth/auth-flow";
import { WindowControls } from "@/components/window-controls";
import { useTrafficLightsInset } from "@/hooks/use-window-controls";
import { CanvasEditor } from "@/studio/shell/canvas-editor";
import { Explorer } from "@/studio/shell/explorer";
import { KIND_ICON, NewProjectDialog } from "@/studio/shell/new-project-dialog";
import { PackEditor } from "@/studio/shell/pack-editor";
import { PictureEditor } from "@/studio/shell/picture-editor";
import { SubmissionsView } from "@/studio/shell/submissions-view";
import { ThemePackEditor } from "@/studio/shell/theme-pack-editor";
import { forgetHistory } from "@/studio/editor/use-doc-editor";
import { KIND_LABEL, type Project, type ProjectKind } from "@/studio/model/types";
import { useProjects } from "@/studio/storage/use-projects";
import { cn } from "@/lib/utils";

const OPEN_KEY = "crystal-studio-open";
type Activity = "projects" | "submissions";

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
      return <PictureEditor key={project.id} project={project} onChange={onChange} />;
    case "themePack":
      return <ThemePackEditor key={project.id} project={project} onChange={onChange} />;
    case "pack":
      return <PackEditor key={project.id} project={project} all={all} onChange={onChange} onOpen={onOpen} />;
  }
}

function Workspace() {
  const trafficLights = useTrafficLightsInset();
  const { projects, update, create, duplicate, remove } = useProjects();
  const me = useQuery(api.users.getCurrentUser);
  const [activity, setActivity] = useState<Activity>("projects");
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

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

  const close = useCallback(
    (id: string) => {
      setOpenIds((prev) => {
        const next = prev.filter((x) => x !== id);
        setActiveId((cur) => (cur === id ? (next[Math.max(0, prev.indexOf(id) - 1)] ?? null) : cur));
        return next;
      });
    },
    [],
  );

  const all = useMemo(() => projects ?? [], [projects]);
  const active = all.find((p) => p.id === activeId) ?? null;
  const tabs = openIds.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Project[];

  const onCreate = async (kind: ProjectKind, name: string) => {
    const p = await create(kind, name);
    open(p.id);
  };

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
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setExplorerOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, close]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header
        style={{ WebkitAppRegion: "drag", paddingLeft: trafficLights || undefined } as React.CSSProperties}
        className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 pl-3"
      >
        <span className="truncate text-xs font-medium text-muted-foreground">Crystal Studio{active ? ` — ${active.name}` : ""}</span>
        <WindowControls />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* The activity bar. */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-card/40 py-2">
          {(
            [
              ["projects", FolderTree, "Projects"],
              ["submissions", Send, "Submissions"],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={activity === id}
              onClick={() => (activity === id && id === "projects" ? setExplorerOpen((o) => !o) : (setActivity(id), setExplorerOpen(true)))}
              className={cn("flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground", activity === id && "bg-primary/15 text-primary")}
            >
              <Icon className="size-5" />
            </button>
          ))}
          <button type="button" aria-label={explorerOpen ? "Hide the side bar" : "Show the side bar"} onClick={() => setExplorerOpen((o) => !o)} className="mt-auto flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground">
            {explorerOpen ? <PanelLeftClose className="size-5" /> : <PanelLeftOpen className="size-5" />}
          </button>
        </nav>

        {activity === "projects" && explorerOpen && (
          <aside className="w-64 shrink-0 border-r border-border/60 bg-card/30">
            <Explorer
              projects={projects}
              activeId={activeId}
              onOpen={open}
              onNew={() => setNewOpen(true)}
              onDuplicate={async (id) => {
                const copy = await duplicate(id);
                if (copy) open(copy.id);
              }}
              onDelete={async (id) => {
                close(id);
                forgetHistory(id);
                await remove(id);
              }}
            />
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col">
          {activity === "submissions" ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SubmissionsView />
            </div>
          ) : (
            <>
              <div className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border/60 bg-card/30">
                {tabs.map((t) => {
                  const Icon = KIND_ICON[t.kind];
                  return (
                    <div key={t.id} className={cn("group flex h-full max-w-56 min-w-0 items-center gap-1.5 border-r border-border/60 px-3 text-sm", t.id === activeId ? "bg-background" : "text-muted-foreground hover:bg-accent/40")}>
                      <button type="button" onClick={() => setActiveId(t.id)} className="flex min-w-0 items-center gap-1.5" title={`${t.name} — ${KIND_LABEL[t.kind]}`}>
                        <Icon className="size-3.5 shrink-0" />
                        <span className="truncate">{t.name}</span>
                      </button>
                      <button type="button" aria-label={`Close ${t.name}`} onClick={() => close(t.id)} className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent">
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
                  <EditorFor
                    project={active}
                    all={all}
                    onChange={(next) => update(active.id, () => next)}
                    onOpen={open}
                  />
                ) : (
                  <Welcome onNew={() => setNewOpen(true)} />
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border/60 bg-card/40 px-3 text-[11px] text-muted-foreground">
        <span>{me ? `Signed in as ${me.name}` : "Signing in…"}</span>
        <span>{projects ? `${projects.length} project${projects.length === 1 ? "" : "s"} on this device` : ""}</span>
        <span className="ml-auto">Autosaved</span>
      </footer>

      <NewProjectDialog open={newOpen} onOpenChange={setNewOpen} onCreate={onCreate} />
    </div>
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
        <div className="flex h-full items-center justify-center bg-background">
          <div className="w-full max-w-md">
            <AuthFlow />
          </div>
        </div>
      </Show>
    </>
  );
}
