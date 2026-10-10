"use client";

import { Copy, Diamond, Eye, EyeOff, Group, Magnet, Maximize2, Redo2, Scissors, Trash2, Undo2, Ungroup, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Clip } from "../../../convex/lib/motion";
import { CLIP_COLOUR } from "@/studio/motion/library";
import {
  FRAME, animatedProps, canBreakApart, endOf, fitDuration, moveClips, parseTimecode, setDuration, setLane, snapFrame, snapPoints, snapTime, splitAt, timecode, trimEnd, trimStart,
} from "@/studio/motion/ops";
import { MAX_ZOOM, MIN_ZOOM, MOTION_TOOLS, useClockValue, type MotionEditor } from "@/studio/motion/use-motion-editor";
import { layerNames } from "@/studio/model/motion-doc";
import type { Doc } from "@/studio/model/types";
import { cn } from "@/lib/utils";

const LANE_H = 38;
const RULER_H = 24;
const HEAD_W = 92;
const EDGE = 7;

type Drag =
  | { kind: "move"; ids: Set<string>; x0: number; y0: number; orig: Clip[]; avoid: boolean; moved: boolean }
  | { kind: "trimL" | "trimR"; id: string; x0: number; orig: Clip[]; ripple: boolean }
  | { kind: "slip"; id: string; x0: number; orig: Clip[] }
  | { kind: "scrub" }
  | { kind: "range"; a: number }
  | { kind: "pan"; x0: number; scroll: number };

/** A tick spacing, in seconds, that keeps the labels at least ~70 px apart. */
function tickStep(zoom: number): number {
  for (const s of [FRAME * 2, FRAME * 5, FRAME * 10, 0.5, 1, 2, 5, 10, 30]) if (s * zoom >= 70) return s;
  return 30;
}

export function Timeline({ editor, doc }: { editor: MotionEditor; doc: Doc }) {
  const { spec, scope, path, clock, playing, selection, setSelection, tool, setTool, snapping, setSnapping, zoom, setZoom, commit, commitClips, range, setRange, animation, seek, setPlaying } = editor;
  const t = useClockValue(clock, playing, 30);
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guide, setGuide] = useState<number | null>(null);
  const [bladeAt, setBladeAt] = useState<number | null>(null);
  const names = useMemo(() => layerNames(doc), [doc]);

  const clips = scope.clips;
  const duration = scope.duration;
  const maxTrack = clips.reduce((m, c) => Math.max(m, c.track), 0);
  const lanes = Math.min(32, Math.max(4, maxTrack + 2));
  const width = Math.max(640, duration * zoom + 120);
  const laneTop = (track: number) => (lanes - 1 - track) * LANE_H;

  const xToTime = useCallback(
    (clientX: number) => {
      const r = scroller.current!.getBoundingClientRect();
      return (clientX - r.left + scroller.current!.scrollLeft - HEAD_W) / zoom;
    },
    [zoom],
  );

  const tol = 8 / zoom;
  const snapList = (exclude: Set<string>) => snapPoints(clips, { playhead: clock.value, duration, exclude });

  // Keep the playhead in view while playing.
  useEffect(() => {
    if (!playing) return;
    const el = scroller.current;
    if (!el) return;
    const x = HEAD_W + clock.value * zoom;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEAD_W) el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
  }, [t, playing, zoom, clock]);

  // --- Pointer ----------------------------------------------------------------------------------
  const startClip = (e: React.PointerEvent, c: Clip) => {
    e.stopPropagation();
    (scroller.current as HTMLElement).setPointerCapture(e.pointerId);
    const time = xToTime(e.clientX);
    if (tool === "blade") {
      commitClips((cs) => splitAt(cs, snapFrame(time), new Set([c.id])));
      return;
    }
    if (tool === "zoom") return zoomAt(e, time);
    if (tool === "hand") return startPan(e);
    if (tool === "range") return startRange(e, time);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const sel = selection.includes(c.id) ? (additive ? selection.filter((id) => id !== c.id) : selection) : additive ? [...selection, c.id] : [c.id];
    setSelection(sel);
    if (!sel.includes(c.id)) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const nearL = px <= EDGE;
    const nearR = rect.width - px <= EDGE;
    if ((tool === "select" || tool === "trim") && (nearL || nearR)) drag.current = { kind: nearL ? "trimL" : "trimR", id: c.id, x0: e.clientX, orig: clips, ripple: tool === "trim" };
    else if (tool === "trim") drag.current = { kind: "slip", id: c.id, x0: e.clientX, orig: clips };
    else drag.current = { kind: "move", ids: new Set(sel), x0: e.clientX, y0: e.clientY, orig: clips, avoid: tool !== "position", moved: false };
  };

  const startScrub = (e: React.PointerEvent) => {
    (scroller.current as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "scrub" };
    setPlaying(false);
    seek(snapFrame(xToTime(e.clientX)));
  };
  const startPan = (e: React.PointerEvent) => {
    drag.current = { kind: "pan", x0: e.clientX, scroll: scroller.current!.scrollLeft };
  };
  const startRange = (e: React.PointerEvent, time: number) => {
    const a = snapFrame(Math.max(0, time));
    drag.current = { kind: "range", a };
    setRange(null);
    void e;
  };
  const zoomAt = (e: React.PointerEvent, time: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.altKey ? 0.6 : 1.7)));
    setZoom(next);
    requestAnimationFrame(() => {
      const el = scroller.current;
      if (el) el.scrollLeft = Math.max(0, HEAD_W + time * next - (e.clientX - el.getBoundingClientRect().left));
    });
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    (scroller.current as HTMLElement).setPointerCapture(e.pointerId);
    const time = xToTime(e.clientX);
    if (tool === "zoom") return zoomAt(e, time);
    if (tool === "hand") return startPan(e);
    if (tool === "range") return startRange(e, time);
    if (!(e.shiftKey || e.metaKey)) setSelection([]);
    // A click on empty lane moves the playhead there, as clicking the timeline does in Final Cut.
    startScrub(e);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const time = xToTime(e.clientX);
    if (tool === "blade" && !d) setBladeAt(snapFrame(Math.max(0, time)));
    if (!d) return;
    if (d.kind === "scrub") return seek(snapFrame(Math.max(0, Math.min(duration, time))));
    if (d.kind === "pan") {
      scroller.current!.scrollLeft = d.scroll - (e.clientX - d.x0);
      return;
    }
    if (d.kind === "range") {
      setRange({ a: d.a, b: snapFrame(Math.max(0, Math.min(duration, time))) });
      return;
    }
    const dt = (e.clientX - d.x0) / zoom;
    if (d.kind === "move") {
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3) return;
      d.moved = true;
      const group = d.orig.filter((c) => d.ids.has(c.id));
      const lo = Math.min(...group.map((c) => c.start));
      const hi = Math.max(...group.map(endOf));
      let adj = dt;
      let snapped: number | null = null;
      if (snapping && !e.altKey) {
        const pts = snapList(d.ids);
        const a = snapTime(lo + dt, pts, tol);
        const b = snapTime(hi + dt, pts, tol);
        if (a.snapped !== null && (b.snapped === null || Math.abs(a.t - (lo + dt)) <= Math.abs(b.t - (hi + dt)))) {
          adj = a.t - lo;
          snapped = a.snapped;
        } else if (b.snapped !== null) {
          adj = b.t - hi;
          snapped = b.snapped;
        } else adj = snapFrame(lo + dt) - lo;
      } else adj = snapFrame(lo + dt) - lo;
      setGuide(snapped);
      const lanesMoved = Math.round(-(e.clientY - d.y0) / LANE_H);
      commitClips(() => moveClips(d.orig, d.ids, adj, lanesMoved, duration, d.avoid), "drag");
      return;
    }
    const clip = d.orig.find((c) => c.id === d.id);
    if (!clip) return;
    if (d.kind === "slip") {
      const s0 = typeof clip.speed === "number" ? clip.speed : 1;
      commitClips(() => d.orig.map((c) => (c.id === d.id ? { ...c, in: Math.max(0, Math.round((clip.in - dt * s0) * 1000) / 1000) } : c)), "slip");
      return;
    }
    const pts = snapList(new Set([d.id]));
    if (d.kind === "trimL") {
      const want = snapping && !e.altKey ? snapTime(clip.start + dt, pts, tol) : { t: snapFrame(clip.start + dt), snapped: null };
      setGuide(want.snapped);
      commitClips(() => d.orig.map((c) => (c.id === d.id ? trimStart(clip, want.t) : c)), "trim");
    } else {
      const want = snapping && !e.altKey ? snapTime(endOf(clip) + dt, pts, tol) : { t: snapFrame(endOf(clip) + dt), snapped: null };
      setGuide(want.snapped);
      commitClips(() => {
        const trimmed = trimEnd(clip, want.t, duration);
        const delta = trimmed.duration - clip.duration;
        return d.orig.map((c) => {
          if (c.id === d.id) return trimmed;
          // Ripple: what follows in the same lane keeps its distance from this clip's end.
          if (d.ripple && c.track === clip.track && c.start >= endOf(clip) - 1e-6) return { ...c, start: Math.max(0, Math.min(duration - c.duration, c.start + delta)) };
          return c;
        });
      }, "trim");
    }
  };

  const onUp = (e: React.PointerEvent) => {
    drag.current = null;
    setGuide(null);
    try {
      (scroller.current as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* wasn't captured */
    }
  };

  const toggleLane = (track: number) => {
    const on = clips.some((c) => c.track === track && !c.on);
    commitClips((cs) => setLane(cs, track, on));
  };

  const step = tickStep(zoom);
  const ticks: number[] = [];
  for (let x = 0; x <= duration + 1e-6; x += step) ticks.push(Math.round(x * 1000) / 1000);

  const sel = clips.filter((c) => selection.includes(c.id));
  const canUngroup = sel.length === 1 && canBreakApart(sel[0]);
  const btn = "flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-[var(--ai-text)] hover:bg-white/10 disabled:opacity-35 disabled:hover:bg-transparent";

  return (
    <div className="flex h-full min-h-0 flex-col" data-motion-timeline>
      {/* Toolbar: the tools of Final Cut's, then the things that act on what is selected. */}
      <div className="ai-edge-b flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto px-1.5">
        {MOTION_TOOLS.map((tl) => (
          <button key={tl.id} type="button" title={`${tl.label} (${tl.key}) — ${tl.hint}`} aria-pressed={tool === tl.id} onClick={() => setTool(tl.id)} className={cn(btn, "w-7 justify-center font-semibold", tool === tl.id && "bg-[var(--ai-accent,#8b5cf6)] text-white hover:bg-[var(--ai-accent,#8b5cf6)]")}>
            {tl.key}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button type="button" className={btn} title="Undo (⌘Z)" disabled={!editor.canUndo} onClick={editor.undo}><Undo2 className="size-3.5" /></button>
        <button type="button" className={btn} title="Redo (⇧⌘Z)" disabled={!editor.canRedo} onClick={editor.redo}><Redo2 className="size-3.5" /></button>
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button type="button" className={btn} title="Cut at the playhead (⌘B)" onClick={editor.split}><Scissors className="size-3.5" /> Split</button>
        <button type="button" className={btn} title="Delete (⌫); ⇧⌫ closes the gap" disabled={!selection.length} onClick={() => editor.remove(false)}><Trash2 className="size-3.5" /></button>
        <button type="button" className={btn} title="Duplicate (⌘D)" disabled={!selection.length} onClick={editor.duplicate}><Copy className="size-3.5" /></button>
        <button type="button" className={btn} title="Make a compound clip (⌘G)" disabled={!selection.length} onClick={editor.group}><Group className="size-3.5" /> Group</button>
        <button type="button" className={btn} title="Open the compound clip back out (⇧⌘G)" disabled={!canUngroup} onClick={editor.ungroup}><Ungroup className="size-3.5" /></button>
        <span className="mx-1 h-4 w-px bg-white/15" />
        <button type="button" aria-pressed={snapping} title="Snapping (N)" onClick={() => setSnapping(!snapping)} className={cn(btn, snapping && "text-[var(--ai-accent,#8b5cf6)]")}><Magnet className="size-3.5" /> Snap</button>
        <AutoKeyToggle editor={editor} className={btn} />
        <span className="ml-auto" />
        <DurationField editor={editor} className={btn} />
        <button type="button" className={btn} title="Set the design's length to where its last clip ends" onClick={() => commit((s) => fitDuration(s))}><Maximize2 className="size-3.5" /> Fit</button>
        <button type="button" className={btn} title="Zoom out (⌘−)" onClick={() => setZoom(Math.max(MIN_ZOOM, zoom / 1.5))}><ZoomOut className="size-3.5" /></button>
        <input type="range" aria-label="Timeline zoom" min={Math.log(MIN_ZOOM)} max={Math.log(MAX_ZOOM)} step={0.01} value={Math.log(zoom)} onChange={(e) => setZoom(Math.exp(Number(e.target.value)))} className="h-1 w-20 accent-[var(--color-primary)]" />
        <button type="button" className={btn} title="Zoom in (⌘=)" onClick={() => setZoom(Math.min(MAX_ZOOM, zoom * 1.5))}><ZoomIn className="size-3.5" /></button>
      </div>

      {/* Where you are: the design, or inside a compound clip. */}
      {path.length > 0 && (
        <div className="ai-edge-b flex h-6 shrink-0 items-center gap-1 px-2 text-[11px]">
          <button type="button" className="text-[var(--ai-accent,#8b5cf6)] hover:underline" onClick={() => { for (let i = 0; i < path.length; i++) editor.close(); }}>Design</button>
          {path.map((id, i) => {
            const c = findClip(spec.clips, id);
            return (
              <span key={id} className="flex items-center gap-1">
                <span className="text-[var(--ai-dim)]">▸</span>
                <button type="button" className={cn("hover:underline", i === path.length - 1 ? "font-medium text-[var(--ai-text)]" : "text-[var(--ai-accent,#8b5cf6)]")} onClick={() => { for (let k = 0; k < path.length - 1 - i; k++) editor.close(); }}>{c?.name ?? "Compound clip"}</button>
              </span>
            );
          })}
        </div>
      )}

      <div
        ref={scroller}
        className={cn("relative min-h-0 flex-1 overflow-auto bg-[var(--ai-pasteboard,#16161b)] select-none", tool === "blade" ? "cursor-crosshair" : tool === "zoom" ? "cursor-zoom-in" : tool === "hand" ? "cursor-grab" : "cursor-default")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => setBladeAt(null)}
      >
        <div className="relative" style={{ width: HEAD_W + width, height: RULER_H + lanes * LANE_H }}>
          {/* Ruler */}
          <div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-40 shrink-0 border-r border-b border-white/10 bg-[var(--ai-body,#202026)]" style={{ width: HEAD_W }} />
            <div className="relative flex-1 cursor-pointer border-b border-white/10 bg-[var(--ai-body,#202026)]" style={{ width }} onPointerDown={startScrub}>
              {ticks.map((x) => (
                <div key={x} className="absolute top-0 h-full border-l border-white/15 pl-1 font-mono text-[9px] text-[var(--ai-dim)]" style={{ left: x * zoom }}>{timecode(x)}</div>
              ))}
              <div className="absolute top-0 h-full border-l border-white/40" style={{ left: duration * zoom }} title="End of the design" />
              {range && <div className="pointer-events-none absolute top-0 h-full bg-sky-400/25" style={{ left: Math.min(range.a, range.b) * zoom, width: Math.abs(range.b - range.a) * zoom }} />}
            </div>
          </div>

          {/* Lane headers, pinned to the left while the lanes scroll */}
          <div className="sticky left-0 z-20 float-left" style={{ width: HEAD_W, marginTop: 0 }}>
            {Array.from({ length: lanes }, (_, i) => lanes - 1 - i).map((track) => {
              const inLane = clips.filter((c) => c.track === track);
              const off = inLane.length > 0 && inLane.every((c) => !c.on);
              return (
                <div key={track} className="flex items-center gap-1 border-r border-b border-white/10 bg-[var(--ai-body,#202026)] px-2 text-[11px] text-[var(--ai-dim)]" style={{ height: LANE_H }}>
                  <span className="w-6 font-mono">V{track + 1}</span>
                  <button type="button" disabled={inLane.length === 0} aria-label={off ? `Turn lane V${track + 1} on` : `Turn lane V${track + 1} off`} aria-pressed={!off} onClick={() => toggleLane(track)} className="rounded p-0.5 hover:text-foreground disabled:opacity-30">
                    {off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Lanes */}
          <div className="absolute" style={{ left: HEAD_W, top: RULER_H, width, height: lanes * LANE_H }} onPointerDown={onBackgroundDown}>
            {Array.from({ length: lanes }, (_, i) => (
              <div key={i} className={cn("absolute inset-x-0 border-b border-white/[0.06]", i % 2 ? "bg-white/[0.015]" : "")} style={{ top: i * LANE_H, height: LANE_H }} />
            ))}
            {/* Beyond the end of the design */}
            <div className="pointer-events-none absolute top-0 bottom-0 bg-black/35" style={{ left: duration * zoom, right: 0 }} />
            {range && <div className="pointer-events-none absolute top-0 bottom-0 bg-sky-400/10" style={{ left: Math.min(range.a, range.b) * zoom, width: Math.abs(range.b - range.a) * zoom }} />}

            {clips.map((c) => (
              <ClipBox key={c.id} clip={c} top={laneTop(c.track)} zoom={zoom} selected={selection.includes(c.id)} label={c.source.type === "layer" ? (names.get(c.source.nodeId) ?? c.name) : c.name} showKeys={animation} onDown={(e) => startClip(e, c)} onOpen={() => c.source.type === "compound" && editor.open(c.id)} />
            ))}

            {guide !== null && <div className="pointer-events-none absolute top-0 bottom-0 z-20 border-l border-dashed border-amber-300" style={{ left: guide * zoom }} />}
            {bladeAt !== null && tool === "blade" && <div className="pointer-events-none absolute top-0 bottom-0 z-20 border-l border-white/70" style={{ left: bladeAt * zoom }} />}
          </div>

          {/* The playhead */}
          <div className="pointer-events-none absolute top-0 z-40" style={{ left: HEAD_W + t * zoom, height: RULER_H + lanes * LANE_H }}>
            <div className="absolute -top-px -left-[5px] h-0 w-0 border-x-[5px] border-t-[8px] border-x-transparent border-t-red-500" />
            <div className="h-full w-px bg-red-500" />
          </div>
        </div>
      </div>
    </div>
  );
}

function findClip(clips: Clip[], id: string): Clip | null {
  for (const c of clips) {
    if (c.id === id) return c;
    if (c.source.type === "compound") {
      const r = findClip(c.source.clips, id);
      if (r) return r;
    }
  }
  return null;
}

function AutoKeyToggle({ editor, className }: { editor: MotionEditor; className: string }) {
  return (
    <button type="button" aria-pressed={editor.autoKey} title="Auto-key: moving, scaling or turning at a time makes a keyframe there" onClick={() => editor.setAutoKey(!editor.autoKey)} className={cn(className, editor.autoKey && "bg-amber-500/25 text-amber-200")}>
      <Diamond className="size-3.5" /> Auto-key
    </button>
  );
}

function DurationField({ editor, className }: { editor: MotionEditor; className: string }) {
  const [text, setText] = useState<string | null>(null);
  const top = editor.path.length === 0;
  return (
    <label className={cn(className, "gap-1.5")} title={top ? "How long the design runs before it loops" : "The length of this compound clip's contents"}>
      <span className="text-[var(--ai-dim)]">Length</span>
      <input
        value={text ?? timecode(editor.scope.duration)}
        disabled={!top}
        onFocus={(e) => { setText(timecode(editor.scope.duration)); e.currentTarget.select(); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = text === null ? null : parseTimecode(text);
          setText(null);
          if (v !== null && v > 0) editor.commit((s) => setDuration(s, v), "length");
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        className="w-[58px] bg-transparent text-right font-mono outline-none"
      />
    </label>
  );
}

function ClipBox({ clip, top, zoom, selected, label, showKeys, onDown, onOpen }: { clip: Clip; top: number; zoom: number; selected: boolean; label: string; showKeys: boolean; onDown: (e: React.PointerEvent) => void; onOpen: () => void }) {
  const colour = CLIP_COLOUR[clip.source.type];
  const left = clip.start * zoom;
  const w = Math.max(3, clip.duration * zoom);
  const keys = useMemo(() => (showKeys ? [...new Set(animatedProps(clip).flatMap((p) => p.times))] : []), [clip, showKeys]);
  return (
    <div
      data-clip={clip.id}
      onPointerDown={onDown}
      onDoubleClick={onOpen}
      className={cn("absolute z-10 overflow-hidden rounded-[4px] border text-[11px] leading-none", selected ? "z-20 border-white ring-1 ring-white/70" : "border-black/40", !clip.on && "opacity-40")}
      style={{ left, top: top + 2, width: w, height: LANE_H - 4, background: `linear-gradient(${colour}dd, ${colour}99)` }}
      title={`${label} — ${timecode(clip.start)} → ${timecode(endOf(clip))}`}
    >
      {clip.transitionIn && <div className="pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/50 to-transparent" style={{ width: Math.min(w, clip.transitionIn.d * zoom) }} />}
      {clip.transitionOut && <div className="pointer-events-none absolute inset-y-0 right-0 bg-gradient-to-l from-black/50 to-transparent" style={{ width: Math.min(w, clip.transitionOut.d * zoom) }} />}
      <div className="pointer-events-none truncate px-1.5 pt-1 font-medium text-white drop-shadow">{label}{clip.source.type === "compound" ? " ▸" : ""}</div>
      <div className="pointer-events-none px-1.5 pt-0.5 text-[9px] text-white/70">{clip.source.type}{typeof clip.speed === "number" && clip.speed !== 1 ? ` · ${clip.speed}×` : clip.speed !== 1 ? " · ramp" : ""}{clip.reverse ? " · ◀" : ""}</div>
      {keys.map((k) => (
        <div key={k} className="pointer-events-none absolute bottom-0.5 size-1.5 rotate-45 bg-amber-300" style={{ left: k * zoom - 3 }} />
      ))}
      <div className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize hover:bg-white/30" />
      <div className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize hover:bg-white/30" />
    </div>
  );
}

