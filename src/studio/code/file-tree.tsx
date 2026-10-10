"use client";

import { EditorActiveContext } from "@/studio/shell/chrome";
import { ChevronDown, ChevronRight, FilePlus, FolderPlus, RefreshCw, ChevronsDownUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useContext } from "react";

import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EXPLORER_EVENT, type ExplorerRequest } from "@/studio/code/code-menu-bar";
import type { CodeWorkbench } from "@/studio/code/use-code-workbench";
import { FileGlyph } from "@/studio/code/vscode-ui";
import { baseOf, parentOf, type FileInfo } from "@/studio/storage/workspace";
import { cn } from "@/lib/utils";

/** Folders that are listed but not opened up: huge, generated, or not the author's. */
const COLLAPSED_ALWAYS = new Set(["node_modules", ".git"]);
const REFRESH_MS = 2500;
const ROW = 22;
const INDENT = 8;

function NameInput({ initial = "", onSubmit, onCancel }: { initial?: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    // Rename selects the name without its extension, as VS Code does.
    const dot = initial.lastIndexOf(".");
    ref.current?.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCancel}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value);
        if (e.key === "Escape") onCancel();
        e.stopPropagation();
      }}
      className="h-[20px] min-w-0 flex-1 border px-1 text-[13px] outline-none"
      style={{ background: "var(--vsc-input)", borderColor: "var(--vsc-accent)", color: "var(--vsc-input-fg)" }}
      aria-label="Name"
    />
  );
}

/**
 * The Explorer, laid out as VS Code's: an EXPLORER title, a section for the project with actions
 * that appear when the pointer is over it, 22px rows with a chevron, an icon and the name, and a
 * thin guide line down each open folder. Folders are read as they are opened and looked at again
 * every couple of seconds, so a file made by `npm init` in the terminal or by another editor
 * shows up without anyone asking.
 */
export function FileTree({ wb, projectName }: { wb: CodeWorkbench; projectName: string }) {
  const ws = wb.ws;
  const [children, setChildren] = useState<Record<string, FileInfo[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["src"]));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState<{ dir: string; folder: boolean } | null>(null);
  const [deleting, setDeleting] = useState<FileInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const refresh = useCallback(async () => {
    if (!ws) return;
    const next: Record<string, FileInfo[]> = {};
    for (const d of ["", ...expandedRef.current]) {
      const list = await ws.list(d).catch(() => null);
      if (list) next[d] = list;
    }
    setChildren((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [ws]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [refresh, expanded]);

  // The file being edited is the one highlighted, and its folders are opened to show it.
  useEffect(() => {
    if (!wb.active) return;
    setSelected(wb.active);
    const parts = wb.active.split("/").slice(0, -1);
    if (parts.length) {
      setExpanded((prev) => {
        const next = new Set(prev);
        parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join("/")));
        return next.size === prev.size ? prev : next;
      });
    }
  }, [wb.active]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "") : "That didn't work.");
    }
  };

  const startCreate = (dir: string, folder: boolean) => {
    setSectionOpen(true);
    if (dir) setExpanded((prev) => new Set(prev).add(dir));
    setCreating({ dir, folder });
  };
  /** New things go where the selection is: in the folder, or beside the file. */
  const targetDir = () => {
    const s = selected ?? wb.active;
    if (!s) return "";
    const entry = Object.values(children).flat().find((e) => e.path === s);
    return entry?.isDir ? entry.path : parentOf(s);
  };

  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

  // The workbench's File menu asks for the same things the buttons above do.
  const startCreateRef = useRef(startCreate);
  startCreateRef.current = startCreate;
  const targetDirRef = useRef(targetDir);
  targetDirRef.current = targetDir;
  // Studio keeps every open code project mounted (hidden), and this is a window-wide event: only the one being looked at answers.
  const visible = useContext(EditorActiveContext);
  useEffect(() => {
    if (!visible) return;
    const onRequest = (e: Event) => {
      const { action } = (e as CustomEvent<ExplorerRequest>).detail ?? {};
      if (action === "new-file") startCreateRef.current(targetDirRef.current(), false);
      else if (action === "new-folder") startCreateRef.current(targetDirRef.current(), true);
      else if (action === "refresh") void refresh();
      else if (action === "collapse") setExpanded(new Set());
    };
    window.addEventListener(EXPLORER_EVENT, onRequest);
    return () => window.removeEventListener(EXPLORER_EVENT, onRequest);
  }, [refresh, visible]);

  const row = (e: FileInfo, depth: number): React.ReactNode => {
    const isOpen = e.isDir && expanded.has(e.path);
    const collapsedAlways = e.isDir && COLLAPSED_ALWAYS.has(e.name);
    const active = selected === e.path;
    const unsaved = wb.dirty.has(e.path);
    return (
      <div key={e.path}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="treeitem"
              aria-expanded={e.isDir ? isOpen : undefined}
              aria-selected={active}
              style={{ paddingLeft: 4 + depth * INDENT + (e.isDir ? 0 : 16), height: ROW, ...(active ? { background: "var(--vsc-list-inactive)" } : {}) }}
              className={cn("relative flex cursor-pointer items-center gap-1 pr-2 text-[13px] hover:bg-[var(--vsc-list-hover)]", active && "!bg-[var(--vsc-list-inactive)]")}
              onClick={() => {
                setSelected(e.path);
                if (e.isDir) {
                  if (!collapsedAlways) toggle(e.path);
                } else void wb.openFile(e.path);
              }}
            >
              {/* The guide line down an open folder, drawn at each ancestor's indent. */}
              {Array.from({ length: depth }).map((_, i) => (
                <span key={i} className="pointer-events-none absolute top-0 bottom-0 w-px opacity-60" style={{ left: 11 + i * INDENT, background: "var(--vsc-border)" }} />
              ))}
              {e.isDir && (isOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />)}
              {e.isDir ? null : <FileGlyph name={e.name} />}
              {renaming === e.path ? (
                <NameInput
                  initial={e.name}
                  onCancel={() => setRenaming(null)}
                  onSubmit={(name) => {
                    setRenaming(null);
                    if (name.trim() === e.name) return;
                    void run(async () => {
                      const to = await ws!.rename(e.path, name);
                      await wb.pathChanged(e.path, to);
                      if (e.isDir) setExpanded((prev) => new Set([...prev].map((p) => (p === e.path || p.startsWith(`${e.path}/`) ? to + p.slice(e.path.length) : p))));
                    });
                  }}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate" style={collapsedAlways ? { color: "var(--vsc-muted)" } : undefined}>
                  {e.name}
                </span>
              )}
              {unsaved && <span className="size-2 shrink-0 rounded-full" style={{ background: "var(--vsc-editor-fg)" }} aria-label="Unsaved changes" />}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="min-w-52 text-[13px]">
            {e.isDir && (
              <>
                <ContextMenuItem onSelect={() => startCreate(e.path, false)}>New File…</ContextMenuItem>
                <ContextMenuItem onSelect={() => startCreate(e.path, true)}>New Folder…</ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuItem onSelect={() => void ws?.reveal(e.path)}>
              {mac ? "Reveal in Finder" : "Reveal in File Explorer"}
              <ContextMenuShortcut>{mac ? "⌥⌘R" : "Shift+Alt+R"}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => navigator.clipboard.writeText(e.path).catch(() => undefined)}>Copy Relative Path</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => setRenaming(e.path)}>
              Rename…<ContextMenuShortcut>{mac ? "↩" : "F2"}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setDeleting(e)}>
              Delete<ContextMenuShortcut>{mac ? "⌘⌫" : "Del"}</ContextMenuShortcut>
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isOpen && dir(e.path, depth + 1)}
      </div>
    );
  };

  const dir = (path: string, depth: number): React.ReactNode => (
    <>
      {creating?.dir === path && (
        <div style={{ paddingLeft: 4 + depth * INDENT + (creating.folder ? 0 : 16), height: ROW }} className="flex items-center gap-1 pr-2">
          {creating.folder ? <ChevronRight className="size-4 shrink-0" /> : <FileGlyph name="" />}
          <NameInput
            onCancel={() => setCreating(null)}
            onSubmit={(name) => {
              const c = creating;
              setCreating(null);
              if (!name.trim()) return;
              void run(async () => {
                if (c.folder) {
                  const made = await ws!.createFolder(c.dir, name);
                  setExpanded((prev) => new Set(prev).add(made));
                } else {
                  await wb.openFile(await ws!.createFile(c.dir, name));
                }
              });
            }}
          />
        </div>
      )}
      {(children[path] ?? []).map((e) => row(e, depth))}
    </>
  );

  // Keyboard, as in VS Code's Explorer: F2 / Enter renames (Enter on a Mac), Delete removes.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selected || renaming || creating) return;
    const entry = Object.values(children).flat().find((x) => x.path === selected);
    if (!entry) return;
    if ((e.key === "F2" && !mac) || (e.key === "Enter" && mac)) (e.preventDefault(), setRenaming(selected));
    else if (e.key === "Delete" || (mac && e.metaKey && e.key === "Backspace")) (e.preventDefault(), setDeleting(entry));
    else if (e.key === "ArrowRight" && entry.isDir && !expanded.has(entry.path)) (e.preventDefault(), toggle(entry.path));
    else if (e.key === "ArrowLeft" && entry.isDir && expanded.has(entry.path)) (e.preventDefault(), toggle(entry.path));
  };

  const action = "flex size-[22px] items-center justify-center rounded hover:bg-[var(--vsc-list-hover)]";
  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="flex h-[35px] shrink-0 items-center pl-5 pr-2 text-[11px] uppercase" style={{ color: "var(--vsc-sidebar-title-fg)" }}>
        Explorer
      </div>
      <div
        className="group flex h-[22px] shrink-0 cursor-pointer items-center gap-0.5 pr-1 text-[11px] font-bold uppercase"
        style={{ background: "var(--vsc-sidebar-section)", color: "var(--vsc-sidebar-title-fg)", borderTop: "1px solid var(--vsc-border)" }}
        onClick={() => setSectionOpen((o) => !o)}
      >
        {sectionOpen ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{projectName}</span>
        <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <button type="button" aria-label="New File…" title="New File…" className={action} onClick={() => startCreate(targetDir(), false)}><FilePlus className="size-4" /></button>
          <button type="button" aria-label="New Folder…" title="New Folder…" className={action} onClick={() => startCreate(targetDir(), true)}><FolderPlus className="size-4" /></button>
          <button type="button" aria-label="Refresh Explorer" title="Refresh Explorer" className={action} onClick={() => void refresh()}><RefreshCw className="size-4" /></button>
          <button type="button" aria-label="Collapse Folders in Explorer" title="Collapse Folders in Explorer" className={action} onClick={() => setExpanded(new Set())}><ChevronsDownUp className="size-4" /></button>
        </span>
      </div>
      {sectionOpen && (
        <div role="tree" aria-label="Project files" className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
          {dir("", 0)}
        </div>
      )}
      {error && (
        <button type="button" onClick={() => setError(null)} className="shrink-0 border-t px-3 py-1.5 text-left text-[12px]" style={{ borderColor: "var(--vsc-border)", color: "var(--vsc-error)" }}>
          {error}
        </button>
      )}

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[13px] font-normal">Are you sure you want to delete &apos;{deleting ? baseOf(deleting.path) : ""}&apos;{deleting?.isDir ? " and its contents" : ""}?</DialogTitle>
            <DialogDescription className="text-[12px]">You can restore this file from the {mac ? "Trash" : "Recycle Bin"}.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="sm" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => {
                const target = deleting!;
                setDeleting(null);
                void run(async () => {
                  await ws!.trash(target.path);
                  await wb.pathChanged(target.path, null);
                });
              }}
            >
              Move to {mac ? "Trash" : "Recycle Bin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
