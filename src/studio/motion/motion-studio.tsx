"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Clip } from "../../../convex/lib/motion";
import { newMotionId } from "../../../convex/lib/motion";
import type { Project } from "@/studio/model/types";
import { useProjectAssets } from "@/studio/storage/assets";
import { Browser } from "@/studio/motion/browser";
import { Inspector } from "@/studio/motion/inspector";
import { Timeline } from "@/studio/motion/timeline";
import { useLayerPictures } from "@/studio/motion/use-layer-pictures";
import { MAX_ZOOM, MIN_ZOOM, MOTION_TOOLS, useMotionEditor } from "@/studio/motion/use-motion-editor";
import { Viewer } from "@/studio/motion/viewer";
import { FRAME, addClip, endOf, snapFrame } from "@/studio/motion/ops";
import { cn } from "@/lib/utils";

/** Copied clips, shared between timelines so something copied in one design can be pasted in another. */
let clipboard: Clip[] = [];

const typing = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);

/**
 * The timeline editor for a nameplate's or profile effect's animation, laid out as Final Cut Pro's window is: the
 * Browser at the left, the Viewer in the middle, the Inspector at the right, and the timeline across the bottom.
 */
export function MotionStudio({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const editor = useMotionEditor(project, onChange);
  const { assets } = useProjectAssets(project.id);
  const pictures = useLayerPictures(project.doc!, assets);
  const [notice, setNotice] = useState<string | null>(null);
  const [split, setSplit] = useState(0.58);
  const root = useRef<HTMLDivElement>(null);
  const say = useCallback((m: string) => {
    setNotice(m);
    window.setTimeout(() => setNotice((c) => (c === m ? null : c)), 4000);
  }, []);

  const ed = useRef(editor);
  ed.current = editor;

  // --- Keyboard: Final Cut's, where it has one -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(document.activeElement) || !root.current || root.current.offsetParent === null) return;
      const x = ed.current;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const edges = () => [...new Set([0, x.scope.duration, ...x.scope.clips.flatMap((c) => [c.start, endOf(c)])])].sort((a, b) => a - b);
      const done = () => e.preventDefault();

      if (k === " ") { done(); x.togglePlay(); }
      else if (!mod && !e.altKey && k === "k") { done(); x.stop(); }
      else if (!mod && k === "l") { done(); x.shuttle(1); }
      else if (!mod && k === "j") { done(); x.shuttle(-1); }
      else if (k === "arrowleft") { done(); x.step(e.shiftKey ? -10 : -1); }
      else if (k === "arrowright") { done(); x.step(e.shiftKey ? 10 : 1); }
      else if (k === "arrowup" || k === "arrowdown") {
        // Up and down jump between edits, as they do in Final Cut.
        done();
        const t = x.clock.value;
        const pts = edges();
        const target = k === "arrowup" ? [...pts].reverse().find((p) => p < t - FRAME / 2) : pts.find((p) => p > t + FRAME / 2);
        if (target !== undefined) { x.stop(); x.seek(target); }
      }
      else if (k === "home") { done(); x.seek(0); }
      else if (k === "end") { done(); x.seek(x.scope.duration); }
      else if (k === "delete" || k === "backspace") { if (x.selection.length) { done(); x.remove(e.shiftKey); } }
      else if (mod && k === "z") { done(); e.shiftKey ? x.redo() : x.undo(); }
      else if (mod && k === "b") { done(); x.split(); }
      else if (mod && k === "d") { done(); x.duplicate(); }
      else if (mod && k === "g") { done(); e.shiftKey ? x.ungroup() : x.group(); }
      else if (mod && k === "a") { done(); x.setSelection(x.scope.clips.map((c) => c.id)); }
      else if (mod && k === "c") { if (x.selected.length) { done(); clipboard = JSON.parse(JSON.stringify(x.selected)); say(`Copied ${clipboard.length} clip${clipboard.length > 1 ? "s" : ""}.`); } }
      else if (mod && k === "v") {
        if (!clipboard.length) return;
        done();
        const at = snapFrame(x.clock.value);
        const lo = Math.min(...clipboard.map((c) => c.start));
        const ids: string[] = [];
        x.commitClips((clips, dur) => {
          let out = clips;
          for (const c of clipboard) {
            const copy = JSON.parse(JSON.stringify(c)) as Clip;
            copy.id = newMotionId();
            copy.start = Math.max(0, Math.min(dur - copy.duration, Math.round((at + c.start - lo) * 1000) / 1000));
            ids.push(copy.id);
            out = addClip(out, copy);
          }
          return out;
        });
        x.setSelection(ids);
      }
      else if (mod && (k === "=" || k === "+")) { done(); x.setZoom(Math.min(MAX_ZOOM, x.zoom * 1.5)); }
      else if (mod && k === "-") { done(); x.setZoom(Math.max(MIN_ZOOM, x.zoom / 1.5)); }
      else if (!mod && k === "n") { done(); x.setSnapping(!x.snapping); }
      // Option+K types a different character on a Mac, so this reads the physical key.
      else if (e.altKey && e.code === "KeyK") { done(); x.setAutoKey(!x.autoKey); }
      else if (!mod && k === "enter") { const one = x.selected.length === 1 ? x.selected[0] : null; if (one?.source.type === "compound") { done(); x.open(one.id); } }
      else if (k === "escape") { if (x.path.length) { done(); x.close(); } else if (x.selection.length) { done(); x.setSelection([]); } }
      else if (!mod && !e.altKey) {
        const tool = MOTION_TOOLS.find((t) => t.key.toLowerCase() === k);
        if (tool) { done(); x.setTool(tool.id); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [say]);

  // Dragging the divider between the viewer and the timeline.
  const dragSplit = (e: React.PointerEvent) => {
    const el = root.current!;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      setSplit(Math.min(0.8, Math.max(0.25, (ev.clientY - r.top) / r.height)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={root} className="ai flex h-full min-h-0 flex-col" tabIndex={-1}>
      <div className="grid min-h-0 grid-cols-[232px_minmax(0,1fr)_300px]" style={{ height: `${split * 100}%` }}>
        <aside className="ai-edge-r min-h-0 overflow-hidden"><Browser editor={editor} doc={project.doc!} assets={assets} say={say} /></aside>
        <section className="min-h-0 min-w-0"><Viewer editor={editor} images={pictures.images} version={pictures.version} kind={project.kind === "effect" ? "effect" : "nameplate"} name={project.name} /></section>
        <aside className="ai-edge-l min-h-0 overflow-hidden"><Inspector editor={editor} /></aside>
      </div>
      <div role="separator" aria-orientation="horizontal" aria-label="Resize the timeline" onPointerDown={dragSplit} className="ai-edge-t ai-edge-b h-1.5 shrink-0 cursor-row-resize bg-[var(--ai-body)] hover:bg-[var(--ai-accent,#8b5cf6)]/40" />
      <div className="min-h-0 flex-1"><Timeline editor={editor} doc={project.doc!} /></div>
      {notice && <div role="status" className={cn("pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-neutral-900/95 px-3 py-1.5 text-[12px] text-white shadow-lg")}>{notice}</div>}
    </div>
  );
}
