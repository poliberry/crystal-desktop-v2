"use client";

import { ChevronsUpDown } from "lucide-react";
import { useRef } from "react";

import { Swatch } from "@/studio/editor/swatch";
import { Grip, paintOf } from "@/studio/editor/toolbar";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { hasPaint, patchNodes } from "@/studio/model/doc";
import type { Node } from "@/studio/model/types";
import { cn } from "@/lib/utils";

/**
 * One panel group of the dock: a header strip of tabs on the darker grey, the active tab in the body
 * colour and bold so it joins the panel below it, and a ⇕ at the left that folds the group, as in
 * Illustrator. The groups are separated by the dark gutter, 3px.
 */
export function PanelGroup({
  tabs,
  active,
  onActive,
  collapsed,
  onCollapsed,
  children,
  grow,
  badge,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onActive: (id: string) => void;
  collapsed: boolean;
  onCollapsed: (c: boolean) => void;
  children: React.ReactNode;
  /** Takes the space left in the dock, instead of being as tall as its contents. */
  grow?: boolean;
  badge?: Record<string, number | undefined>;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", grow && !collapsed && "flex-1")}>
      <div className="ai-tabstrip" role="tablist">
        <button type="button" aria-label={collapsed ? "Expand panel" : "Collapse panel"} onClick={() => onCollapsed(!collapsed)} className="flex w-5 items-center justify-center text-[var(--ai-dim)] hover:text-foreground">
          <ChevronsUpDown className="size-3" strokeWidth={1.5} />
        </button>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => {
              onActive(t.id);
              onCollapsed(false);
            }}
            className="ai-ptab"
          >
            {t.label}
            {badge?.[t.id] ? <span className="ml-1 rounded-full bg-[var(--ai-select)]/30 px-1 text-[9px]">{badge[t.id]}</span> : null}
          </button>
        ))}
      </div>
      {!collapsed && <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--ai-body)]">{children}</div>}
    </div>
  );
}

export const DockGutter = () => <div aria-hidden className="h-[3px] shrink-0 ai-gutter" />;

// --- Colour -------------------------------------------------------------------------------------

function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${hex(f(5))}${hex(f(3))}${hex(f(1))}`;
}

/**
 * The Color panel: the fill and stroke boxes with their value, and the spectrum bar, whose hue runs
 * along it and which falls to black down its height, as Illustrator's does. Clicking the bar sets the
 * selected thing's fill. With nothing selected the boxes show nothing and the bar does nothing.
 */
export function ColorPanel({ editor, selected }: { editor: DocEditor; selected: Node | null }) {
  const { fill, stroke } = paintOf(selected);
  const editable = hasPaint(selected);
  const bar = useRef<HTMLDivElement>(null);
  const set = (c: string, which: "fill" | "stroke") => {
    if (!selected) return;
    const key = which === "stroke" ? "stroke" : selected.type === "text" ? "color" : "fill";
    editor.commit(patchNodes(editor.doc, editor.selection, { [key]: c } as Partial<Node>), key);
  };
  const pick = (e: React.PointerEvent) => {
    if (!editable || !bar.current) return;
    const r = bar.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    set(hsvToHex(x * 360, 1, 1 - y), "fill");
  };
  return (
    <div className="space-y-2 p-2">
      <div className="flex items-center gap-2">
        <div className="relative size-9 shrink-0">
          <div className="absolute top-3 left-3">
            <Swatch value={stroke} ring size={22} disabled={!editable} label="Stroke colour" onChange={(c) => set(c, "stroke")} />
          </div>
          <div className="absolute top-0 left-0">
            <Swatch value={fill} size={22} disabled={!editable} label="Fill colour" onChange={(c) => set(c, "fill")} />
          </div>
        </div>
        <span className="ai-link ml-auto text-[var(--ai-text)]">#</span>
        <label className="ai-field w-20">
          <input
            key={fill ?? "none"}
            defaultValue={fill && /^#[0-9a-f]{6}$/i.test(fill) ? fill.slice(1).toUpperCase() : ""}
            disabled={!editable}
            maxLength={6}
            spellCheck={false}
            className="uppercase"
            onChange={(e) => /^[0-9a-f]{6}$/i.test(e.target.value) && set(`#${e.target.value}`, "fill")}
          />
        </label>
      </div>
      <div
        ref={bar}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && pick(e)}
        className={cn("h-7 border border-[var(--ai-edge)]", editable ? "cursor-crosshair" : "opacity-60")}
        style={{ backgroundImage: "linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" }}
        aria-label="Colour spectrum"
      />
    </div>
  );
}

// --- Swatches -----------------------------------------------------------------------------------

/** Illustrator's default swatch row, in its order: black and white, then the primaries and their families. */
const SWATCHES = [
  "#ffffff", "#000000", "#ed1c24", "#fff200", "#00a651", "#00aeef", "#2e3192", "#ec008c",
  "#be1e2d", "#ef4136", "#f15a29", "#f7941d", "#fbb040", "#f9ed32", "#8dc63f", "#39b54a",
  "#009444", "#006838", "#00a99d", "#27aae1", "#1c75bc", "#2b3990", "#262262", "#662d91",
  "#92278f", "#9e1f63", "#da1c5c", "#ee2a7b", "#c2b59b", "#998675", "#736357", "#534741",
  "#c69c6d", "#a97c50", "#8b5e3c", "#754c29", "#603913", "#3c2415", "#808285", "#414042",
];

/** The Swatches panel: a grid of 16px cells with no gaps, each a click to set the fill (⌥-click the stroke). */
export function SwatchesPanel({ editor, selected }: { editor: DocEditor; selected: Node | null }) {
  const editable = hasPaint(selected);
  return (
    <div className="p-2">
      <div className="flex flex-wrap" style={{ width: 16 * 12 }}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            title={`${c} — click for fill, Alt-click for stroke`}
            aria-label={c}
            disabled={!editable}
            onClick={(e) => {
              if (!selected) return;
              const key = e.altKey ? "stroke" : selected.type === "text" ? "color" : "fill";
              editor.commit(patchNodes(editor.doc, editor.selection, { [key]: c } as Partial<Node>), key);
            }}
            className="size-4 shrink-0 border border-[var(--ai-edge)] hover:z-10 hover:outline hover:outline-1 hover:outline-white disabled:opacity-60"
            style={{ background: c }}
          />
        ))}
      </div>
      {!editable && <p className="mt-2 text-[10px] text-[var(--ai-dim)]">Select a shape or text to colour it.</p>}
    </div>
  );
}

export { Grip };
