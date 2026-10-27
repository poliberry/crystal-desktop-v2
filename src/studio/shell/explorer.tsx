"use client";

import { Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { KIND_ICON } from "@/studio/shell/new-project-dialog";
import { KIND_LABEL, type Project } from "@/studio/model/types";
import { cn } from "@/lib/utils";

const ago = (ms: number) => {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};

/** Projects on this device, newest first, like a file tree. */
export function Explorer({
  projects,
  activeId,
  onOpen,
  onNew,
  onDuplicate,
  onDelete,
}: {
  projects: Project[] | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 pr-1.5 pl-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Projects</span>
        <Button size="icon" variant="ghost" className="size-7" onClick={onNew} aria-label="New project" title="New project">
          <Plus className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {projects === null ? null : projects.length === 0 ? (
          <div className="space-y-3 p-4 text-center">
            <p className="text-sm text-muted-foreground">No projects yet.</p>
            <Button size="sm" onClick={onNew}>
              <Plus /> New project
            </Button>
          </div>
        ) : (
          <ul className="space-y-px">
            {projects.map((p) => {
              const Icon = KIND_ICON[p.kind];
              return (
                <li key={p.id}>
                  <div className={cn("group flex items-center gap-2 rounded-md px-2 py-1.5", p.id === activeId ? "bg-primary/15" : "hover:bg-accent/60")}>
                    <button type="button" onClick={() => onOpen(p.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{p.name}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {KIND_LABEL[p.kind]} · {ago(p.updatedAt)}
                        </span>
                      </span>
                    </button>
                    <div className="flex opacity-0 group-hover:opacity-100">
                      <button type="button" aria-label="Duplicate" title="Duplicate" onClick={() => onDuplicate(p.id)} className="rounded p-1 text-muted-foreground hover:text-foreground">
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Delete"
                        title="Delete"
                        onClick={() => window.confirm(`Delete “${p.name}” and its files from this device? This can't be undone.`) && onDelete(p.id)}
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="shrink-0 border-t border-border/60 p-2.5 text-[11px] text-muted-foreground">Stored on this device only, until you submit.</p>
    </div>
  );
}
