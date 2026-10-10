"use client";

import { File as FileIcon, Info } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/** A drag handle between two regions, as VS Code's sashes: invisible until hovered, then the accent colour. */
export function Sash({ orientation, onDrag }: { orientation: "vertical" | "horizontal"; onDrag: (deltaPx: number) => void }) {
  const [active, setActive] = useState(false);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const origin = orientation === "vertical" ? e.clientX : e.clientY;
    let last = origin;
    setActive(true);
    const move = (ev: PointerEvent) => {
      const now = orientation === "vertical" ? ev.clientX : ev.clientY;
      onDrag(now - last);
      last = now;
    };
    const up = () => {
      setActive(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = orientation === "vertical" ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      onPointerDown={start}
      className={cn("z-20 shrink-0 transition-colors hover:delay-300", orientation === "vertical" ? "-mx-[2px] w-[4px] cursor-col-resize" : "-my-[2px] h-[4px] cursor-row-resize", active ? "bg-[var(--vsc-accent)]" : "hover:bg-[var(--vsc-accent)]")}
    />
  );
}

/** The small coloured glyph VS Code's Seti icon theme puts before a file name. */
export function FileGlyph({ name, className }: { name: string; className?: string }) {
  const base = "inline-flex size-4 shrink-0 items-center justify-center text-[9px] font-bold leading-none";
  if (/\.d\.ts$/.test(name)) return <span className={cn(base, className)} style={{ color: "#519aba" }}>TS</span>;
  if (/\.(ts|tsx|mts|cts)$/.test(name)) return <span className={cn(base, className)} style={{ color: "#519aba" }}>TS</span>;
  if (/\.(js|mjs|cjs|jsx)$/.test(name)) return <span className={cn(base, className)} style={{ color: "#cbcb41" }}>JS</span>;
  if (/\.json$/.test(name)) return <span className={cn(base, className)} style={{ color: "#cbcb41" }}>{"{}"}</span>;
  if (/\.md$/.test(name)) return <Info className={cn("size-3.5 shrink-0", className)} style={{ color: "#519aba" }} />;
  if (/^\.env/.test(name)) return <span className={cn(base, className)} style={{ color: "#e5a00d" }}>⚙</span>;
  if (/^\.gitignore$/.test(name)) return <span className={cn(base, className)} style={{ color: "#e37933" }}>◆</span>;
  return <FileIcon className={cn("size-3.5 shrink-0", className)} style={{ color: "var(--vsc-muted)" }} />;
}

export interface PickItem {
  id: string;
  label: string;
  /** Dimmed text after the label (a folder, a keybinding). */
  detail?: string;
  /** Shown at the right, like a keybinding. */
  hint?: string;
  icon?: React.ReactNode;
  run: () => void;
}

/** Characters of `query` appearing in order in `text`: where they matched, or null. VS Code's fuzzy match, simplified. */
export function fuzzy(query: string, text: string): number[] | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const hits: number[] = [];
  let at = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    hits.push(i);
    at = i + 1;
  }
  return hits;
}

const score = (hits: number[], text: string) => {
  // Tighter, earlier matches and matches in the file's own name rank first.
  const nameStart = text.lastIndexOf("/") + 1;
  const span = hits[hits.length - 1] - hits[0];
  return span * 2 + hits[0] - hits.filter((h) => h >= nameStart).length * 3;
};

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  const set = new Set(hits);
  return (
    <>
      {[...text].map((c, i) => (set.has(i) ? <b key={i} className="font-semibold" style={{ color: "var(--vsc-info)" }}>{c}</b> : <span key={i}>{c}</span>))}
    </>
  );
}

/**
 * VS Code's Quick Input: a box at the top centre of the editor with a filter field and a list.
 * Used for "Go to File" (⌘P) and the Command Palette (⇧⌘P).
 */
export function QuickPick({ items, placeholder, prefix = "", onClose }: { items: PickItem[]; placeholder: string; prefix?: string; onClose: () => void }) {
  const [query, setQuery] = useState(prefix);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = prefix && query.startsWith(prefix) ? query.slice(prefix.length) : query;
    if (!q.trim()) return items.slice(0, 80).map((it) => ({ it, hits: [] as number[] }));
    return items
      .map((it) => {
        const hits = fuzzy(q, it.label);
        return hits ? { it, hits, s: score(hits, it.label) } : null;
      })
      .filter((x): x is { it: PickItem; hits: number[]; s: number } => x !== null)
      .sort((a, b) => a.s - b.s)
      .slice(0, 80);
  }, [items, query, prefix]);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (i: number) => {
    const pick = shown[i];
    if (!pick) return;
    onClose();
    // After the box has closed, so focus goes back to the editor before the action runs.
    setTimeout(pick.it.run, 0);
  };

  return (
    <div className="absolute inset-0 z-50" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 top-0 w-[600px] max-w-[92%] -translate-x-1/2 overflow-hidden rounded-b-md border border-t-0 shadow-[0_0_8px_2px_rgba(0,0,0,0.36)]"
        style={{ background: "var(--vsc-widget)", borderColor: "var(--vsc-widget-border)", color: "var(--vsc-editor-fg)" }}
      >
        <div className="p-1.5 pb-1">
          <input
            ref={input}
            value={query}
            placeholder={placeholder}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(shown.length - 1, i + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
              else if (e.key === "Enter") (e.preventDefault(), choose(index));
            }}
            spellCheck={false}
            className="h-[26px] w-full rounded-[2px] border px-1.5 text-[13px] outline-none placeholder:opacity-60 focus:border-[var(--vsc-accent)]"
            style={{ background: "var(--vsc-input)", borderColor: "var(--vsc-input-border)", color: "var(--vsc-input-fg)" }}
            aria-label={placeholder}
          />
        </div>
        <div ref={list} role="listbox" className="max-h-[320px] overflow-y-auto pb-1">
          {shown.length === 0 ? (
            <p className="px-3 py-1 text-[13px]" style={{ color: "var(--vsc-muted)" }}>No matching results</p>
          ) : (
            shown.map(({ it, hits }, i) => (
              <div
                key={it.id}
                data-index={i}
                role="option"
                aria-selected={i === index}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(i)}
                className="flex h-[22px] cursor-pointer items-center gap-2 px-3 text-[13px]"
                style={i === index ? { background: "var(--vsc-list-active)", color: "var(--vsc-list-active-fg)" } : undefined}
              >
                {it.icon}
                <span className="min-w-0 truncate"><Highlight text={it.label} hits={hits} /></span>
                {it.detail && <span className="min-w-0 truncate text-[12px] opacity-60">{it.detail}</span>}
                {it.hint && <span className="ml-auto shrink-0 text-[11px] opacity-70">{it.hint}</span>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
