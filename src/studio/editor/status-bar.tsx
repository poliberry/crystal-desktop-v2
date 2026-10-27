"use client";

import { AlertTriangle, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { toolLabel, type Tool } from "@/studio/editor/tools";
import type { ViewCommands } from "@/studio/editor/view-menu";

const ZOOMS = [6.25, 12.5, 25, 50, 66.67, 100, 150, 200, 300, 400, 800];

/** Illustrator writes the zoom with the platform's decimal mark; here, a plain point and no needless zeros. */
const fmt = (pct: number) => `${+pct.toFixed(pct < 10 ? 2 : 1)}%`;

/**
 * The status bar under the canvas: the zoom field (type a value, or pick one beside it), the artboard,
 * the pointer's position, and the name of the tool in use — and, at the right, how many problems the
 * design has, which opens the Problems panel.
 */
export function StatusBar({
  zoom,
  commands,
  tool,
  artboard,
  readout,
  problems,
  onProblems,
}: {
  zoom: number;
  commands: React.RefObject<ViewCommands | null>;
  tool: Tool;
  artboard: { w: number; h: number };
  readout: React.RefObject<HTMLSpanElement | null>;
  problems: { errors: number; warnings: number };
  onProblems: () => void;
}) {
  const pct = zoom * 100;
  const [text, setText] = useState(fmt(pct));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(pct));
  }, [pct, focused]);
  const apply = (raw: string) => {
    const n = parseFloat(raw.replace(",", ".").replace("%", ""));
    if (Number.isFinite(n) && n > 0) commands.current?.setZoom(Math.min(800, Math.max(5, n)) / 100);
  };
  return (
    <div className="flex h-5 shrink-0 items-center gap-3 border-t border-[var(--ai-edge)] bg-[var(--ai-body)] px-2 text-[11px]">
      <div className="flex items-center">
        <label className="ai-field w-[58px] !h-4" title="Zoom">
          <input
            value={text}
            aria-label="Zoom"
            onFocus={(e) => {
              setFocused(true);
              e.currentTarget.select();
            }}
            onBlur={() => {
              setFocused(false);
              apply(text);
              setText(fmt(pct));
            }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <div className="relative">
          <span className="ai-chev !h-4" aria-hidden>
            <ChevronDown className="size-3" />
          </span>
          <select aria-label="Zoom presets" value="" onChange={(e) => e.target.value && commands.current?.setZoom(Number(e.target.value) / 100)} className="absolute inset-0 cursor-pointer opacity-0">
            <option value="">Zoom to…</option>
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {fmt(z)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <span className="text-[var(--ai-dim)]">
        Artboard {artboard.w} × {artboard.h}
      </span>
      <span ref={readout} className="min-w-28 font-mono tabular-nums text-[var(--ai-dim)]" />
      <span className="mx-auto text-[var(--ai-text)]">{toolLabel(tool).replace(/ Tool$/, "")}</span>
      <button type="button" onClick={onProblems} className="flex items-center gap-1 text-[var(--ai-text)] hover:text-foreground" title="Show problems">
        <AlertTriangle className={problems.errors ? "size-3 text-red-400" : problems.warnings ? "size-3 text-amber-400" : "size-3 text-emerald-500"} />
        {problems.errors ? `${problems.errors} error${problems.errors === 1 ? "" : "s"}` : problems.warnings ? `${problems.warnings} warning${problems.warnings === 1 ? "" : "s"}` : "No problems"}
      </button>
    </div>
  );
}
