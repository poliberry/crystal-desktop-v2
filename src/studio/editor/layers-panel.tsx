"use client";

import { AlertTriangle, Armchair, Circle, Eye, Flame, ImageIcon, Link2, Lock, Minus, PenTool, Search, Square, Trash2, Tv, Type, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { expandGroups, moveToIndex, patchNodes, removeNodes } from "@/studio/model/doc";
import type { Problem } from "@/studio/model/compile";
import type { Node } from "@/studio/model/types";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { cn } from "@/lib/utils";

const ICON: Record<Node["type"], React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  shape: Square,
  text: Type,
  path: PenTool,
  screen: Tv,
  seat: Armchair,
  prop: Flame,
  floor: Minus,
};

/**
 * The Layers panel as Illustrator lays a row out, left to right: a visibility eye, a lock column, the
 * layer's colour bar, a 16px thumbnail on white, its name, and a target circle that is filled when the
 * layer is selected. The stack is shown top first. Drag a row to reorder; click to select, shift-click
 * to add; double-click a name to rename. The footer counts them and deletes the selection.
 */
export function LayersPanel({ editor }: { editor: DocEditor }) {
  const { doc, selection, setSelection, commit } = editor;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => [...doc.order].reverse(), [doc.order]);
  const q = query.trim().toLowerCase();

  return (
    <div className="flex h-full min-h-40 flex-col">
      <div className="p-1.5">
        <label className="ai-field gap-1.5 !rounded-[3px]">
          <Search className="size-3 shrink-0 text-[var(--ai-dim)]" strokeWidth={1.5} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search All" spellCheck={false} />
        </label>
      </div>

      <ul className="mx-1.5 min-h-0 flex-1 overflow-y-auto border border-[var(--ai-edge)] bg-[var(--ai-field)]" onDragLeave={() => setOver(null)}>
        {shown.length === 0 && <li className="p-3 text-center text-[11px] text-[var(--ai-dim)]">Nothing here yet. Pick a tool and draw, or drop a picture on the canvas.</li>}
        {shown.map((id, i) => {
          const n = doc.nodes[id];
          if (!n || (q && !n.name.toLowerCase().includes(q))) return null;
          const Icon = n.type === "shape" && n.shape === "ellipse" ? Circle : ICON[n.type];
          const selected = selection.includes(id);
          return (
            <li
              key={id}
              draggable={renaming !== id}
              onDragStart={() => setDragging(id)}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging) commit(moveToIndex(doc, dragging, doc.order.length - 1 - i));
                setDragging(null);
                setOver(null);
              }}
              onClick={(e) => setSelection(expandGroups(doc, e.shiftKey ? (selected ? selection.filter((s) => s !== id) : [...selection, id]) : [id], editor.scope))}
              className={cn(
                "flex h-[22px] cursor-default items-center border-b border-[var(--ai-line)] text-[11px]",
                selected ? "bg-[var(--ai-row-active)] text-foreground" : "hover:bg-[var(--ai-hover)]",
                over === i && dragging && dragging !== id && "shadow-[0_-2px_0_0_var(--ai-select)]",
              )}
            >
              <button
                type="button"
                aria-label={n.hidden ? "Show" : "Hide"}
                title={n.hidden ? "Show" : "Hide"}
                onClick={(e) => {
                  e.stopPropagation();
                  commit(patchNodes(doc, [id], { hidden: !n.hidden }));
                }}
                className="flex w-6 shrink-0 items-center justify-center text-[var(--ai-text)]"
              >
                {!n.hidden && <Eye className="size-3" strokeWidth={1.5} />}
              </button>
              <button
                type="button"
                aria-label={n.locked ? "Unlock" : "Lock"}
                title={n.locked ? "Unlock" : "Lock"}
                onClick={(e) => {
                  e.stopPropagation();
                  commit(patchNodes(doc, [id], { locked: !n.locked }));
                }}
                className="flex w-6 shrink-0 items-center justify-center border-l border-[var(--ai-line)] text-[var(--ai-text)]"
              >
                {n.locked && <Lock className="size-3" strokeWidth={1.5} />}
              </button>
              <span aria-hidden className="mx-1 h-full w-[3px] shrink-0 bg-[var(--ai-select)]" />
              {n.group && (
                <span className="mr-1 flex shrink-0 items-center text-[var(--ai-dim)]" style={{ marginLeft: (n.group.split("/").length - 1) * 8 }} title={n.group.split("/").length > 1 ? "In nested groups" : "In a group"}>
                  <Link2 aria-label="In a group" className="size-3" strokeWidth={1.5} />
                </span>
              )}
              <span aria-hidden className="mr-1.5 flex size-4 shrink-0 items-center justify-center border border-black bg-white text-black">
                <Icon className="size-2.5" />
              </span>
              {renaming === id ? (
                <input
                  autoFocus
                  defaultValue={n.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    commit(patchNodes(doc, [id], { name: e.target.value.trim() || n.name }));
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="min-w-0 flex-1 bg-[var(--ai-body)] px-1 outline outline-1 outline-[var(--ai-select)]"
                />
              ) : (
                <span className={cn("min-w-0 flex-1 truncate", n.hidden && "opacity-50")} onDoubleClick={() => setRenaming(id)}>
                  {n.name}
                </span>
              )}
              <span aria-hidden className="mx-1.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border border-[var(--ai-text)]">
                {selected && <span className="size-1.5 rounded-full bg-[var(--ai-text)]" />}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="flex h-7 shrink-0 items-center px-2 text-[11px]">
        <span className="text-[var(--ai-text)]">
          {doc.order.length} Layer{doc.order.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          aria-label="Delete selection"
          title="Delete selection"
          disabled={selection.length === 0}
          onClick={() => {
            commit(removeNodes(doc, selection.filter((id) => !doc.nodes[id]?.locked)));
            setSelection([]);
          }}
          className="ai-tool ml-auto !w-6"
        >
          <Trash2 className="size-3.5" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

/** What can't be submitted yet, and what is only a warning. Click one to find it. */
export function ProblemsPanel({ problems, onSelect }: { problems: Problem[]; onSelect: (id: string) => void }) {
  if (problems.length === 0) {
    return <p className="p-3 text-[11px] text-emerald-500">No problems. This is ready to submit.</p>;
  }
  return (
    <ul>
      {problems.map((p, i) => (
        <li key={i} className="border-b border-[var(--ai-line)]">
          <button type="button" onClick={() => p.nodeId && onSelect(p.nodeId)} className={cn("flex w-full items-start gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-[var(--ai-hover)]", !p.nodeId && "cursor-default")}>
            {p.severity === "error" ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-400" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />}
            <span>{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
