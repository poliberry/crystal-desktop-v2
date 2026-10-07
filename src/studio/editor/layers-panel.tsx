"use client";

import { AlertTriangle, Armchair, Circle, Eye, EyeOff, Flame, ImageIcon, Lock, Minus, Square, Tv, Type, Unlock, XCircle } from "lucide-react";
import { useState } from "react";

import { moveToIndex, patchNodes } from "@/studio/model/doc";
import type { Problem } from "@/studio/model/compile";
import type { Node } from "@/studio/model/types";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { cn } from "@/lib/utils";

const ICON: Record<Node["type"], React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  shape: Square,
  text: Type,
  screen: Tv,
  seat: Armchair,
  prop: Flame,
  floor: Minus,
};

/** The stack, top first. Drag a row to reorder; click to select, shift-click to add. */
export function LayersPanel({ editor }: { editor: DocEditor }) {
  const { doc, selection, setSelection, commit } = editor;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const shown = [...doc.order].reverse();

  if (shown.length === 0) {
    return <p className="p-4 text-center text-xs text-muted-foreground">Nothing here yet. Pick a tool and draw, or drop a picture on the canvas.</p>;
  }

  return (
    <ul className="space-y-px p-1.5" onDragLeave={() => setOver(null)}>
      {shown.map((id, i) => {
        const n = doc.nodes[id];
        if (!n) return null;
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
            onClick={(e) => setSelection(e.shiftKey ? (selected ? selection.filter((s) => s !== id) : [...selection, id]) : [id])}
            className={cn(
              "group flex h-8 cursor-default items-center gap-1.5 rounded-md px-1.5 text-sm",
              selected ? "bg-primary/15 text-foreground" : "hover:bg-accent/60",
              over === i && dragging && dragging !== id && "shadow-[0_-2px_0_0_var(--color-primary)]",
              n.hidden && "opacity-50",
            )}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
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
                className="min-w-0 flex-1 rounded bg-background px-1 text-sm outline-none ring-1 ring-primary"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate" onDoubleClick={() => setRenaming(id)}>
                {n.name}
              </span>
            )}
            <button
              type="button"
              aria-label={n.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                commit(patchNodes(doc, [id], { locked: !n.locked }));
              }}
              className={cn("rounded p-0.5 text-muted-foreground hover:text-foreground", !n.locked && "opacity-0 group-hover:opacity-100")}
            >
              {n.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
            </button>
            <button
              type="button"
              aria-label={n.hidden ? "Show" : "Hide"}
              onClick={(e) => {
                e.stopPropagation();
                commit(patchNodes(doc, [id], { hidden: !n.hidden }));
              }}
              className={cn("rounded p-0.5 text-muted-foreground hover:text-foreground", !n.hidden && "opacity-0 group-hover:opacity-100")}
            >
              {n.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** What can't be submitted yet, and what is only a warning. Click one to find it. */
export function ProblemsPanel({ problems, onSelect }: { problems: Problem[]; onSelect: (id: string) => void }) {
  if (problems.length === 0) {
    return <p className="p-3 text-xs text-emerald-500">No problems. This is ready to submit.</p>;
  }
  return (
    <ul className="space-y-px p-1.5">
      {problems.map((p, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => p.nodeId && onSelect(p.nodeId)}
            className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60", !p.nodeId && "cursor-default")}
          >
            {p.severity === "error" ? <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-400" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />}
            <span>{p.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
