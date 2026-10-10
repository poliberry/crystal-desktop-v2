"use client";

import { useState } from "react";

import { allClips } from "../../../convex/lib/motion";
import type { Project } from "@/studio/model/types";
import { artworkNodes } from "@/studio/model/motion-doc";
import { CanvasEditor } from "@/studio/shell/canvas-editor";
import { MotionStudio } from "@/studio/motion/motion-studio";
import { SubmitPanel } from "@/studio/shell/submit-panel";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

type View = "canvas" | "animate";

/**
 * A nameplate or profile effect: two editors on one design. *Canvas* is the whole canvas editor — pen, brushes, materials,
 * glow, everything — for drawing the artwork; *Animate* is the timeline editor that moves it. A layer drawn in the first
 * is a clip in the second, so the two are never out of step.
 */
export function MotionEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  // A design that already has something on its timeline opens on it; a new one opens on the canvas, to draw.
  const [view, setView] = useState<View>(() => (project.motion && allClips(project.motion.clips).length > 0 && artworkNodes(project.doc!).length === 0 ? "animate" : "canvas"));
  const [submitting, setSubmitting] = useState(false);
  const clips = project.motion ? allClips(project.motion.clips).length : 0;

  const tab = (id: View, label: string, hint: string) => (
    <button type="button" role="tab" aria-selected={view === id} title={hint} onClick={() => setView(id)} className={cn("h-full px-3 text-[12px]", view === id ? "bg-[var(--ai-body)] font-medium text-[var(--ai-text)] shadow-[inset_0_-2px_0_var(--ai-accent,#8b5cf6)]" : "text-[var(--ai-dim)] hover:text-[var(--ai-text)]")}>
      {label}
    </button>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div role="tablist" className="ai-edge-b flex h-7 shrink-0 items-stretch bg-[var(--ai-header)]">
        {tab("canvas", "Canvas", "Draw the artwork: shapes, pen, brushes, materials, text, pictures")}
        {tab("animate", clips ? `Animate · ${clips}` : "Animate", "Move it: timeline, keyframes, effects, transitions")}
        <span className="flex flex-1 items-center truncate px-3 text-[11px] text-[var(--ai-dim)]">
          {project.kind === "nameplate" ? "Nameplate — drawn faintly behind a name" : "Profile effect — plays over a whole profile card"}
        </span>
        {view === "animate" && (
          <button type="button" onClick={() => setSubmitting(true)} className="my-1 mr-2 rounded-full bg-[var(--ai-accent,#8b5cf6)] px-4 text-[12px] font-medium text-white hover:brightness-110" title="Check the design and send it to the Marketplace">
            Submit
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {view === "canvas" ? <CanvasEditor key={project.id} project={project} onChange={onChange} /> : <MotionStudio project={project} onChange={onChange} />}
      </div>
      {submitting && (
        <div className="absolute inset-0 z-50 flex items-start justify-end bg-black/40" onClick={() => setSubmitting(false)}>
          <div className="h-full w-[420px] max-w-full overflow-y-auto border-l border-border bg-background shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex h-9 items-center justify-between border-b border-border px-3 text-sm font-semibold">
              Submit
              <button type="button" aria-label="Close" onClick={() => setSubmitting(false)} className="rounded p-1 hover:bg-white/10"><X className="size-4" /></button>
            </div>
            <SubmitPanel project={project} onChange={onChange} />
          </div>
        </div>
      )}
    </div>
  );
}
