"use client";

import { Pause, Play, Repeat, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { sampleClip, type Clip, type MotionSpec } from "../../../convex/lib/motion";
import { MotionRenderer, sourceBox, type MotionImages } from "@/lib/motion-render";
import { FPS, clipQuad, restOf, setPropAt, timecode } from "@/studio/motion/ops";
import { useClockValue, type MotionEditor } from "@/studio/motion/use-motion-editor";
import { cn } from "@/lib/utils";

type Backdrop = "checker" | "dark" | "worn";

/** Whether `p` is inside the quadrilateral `q` (a clip's turned box). */
function inQuad(p: { x: number; y: number }, q: { tl: { x: number; y: number }; tr: { x: number; y: number }; br: { x: number; y: number }; bl: { x: number; y: number } }) {
  const pts = [q.tl, q.tr, q.br, q.bl];
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

type Gesture =
  | { kind: "move"; id: string; start: { x: number; y: number }; x0: number; y0: number }
  | { kind: "scale"; id: string; pivot: { x: number; y: number }; d0: number; sx0: number; sy0: number; axis: "both" | "x" | "y" }
  | { kind: "rotate"; id: string; pivot: { x: number; y: number }; a0: number; r0: number };

/**
 * The picture, and what you can do to it: the design drawn at the playhead with the selected clip's handles over it —
 * drag to move, a corner to scale, the knob above to turn — and the transport under it.
 *
 * Moving, scaling and turning write to the clip's transform at the playhead's time; with Auto-key on (or on a property
 * that is already animated) that makes a keyframe, so animating is moving things at different times.
 */
export function Viewer({ editor, images, version, kind, name }: { editor: MotionEditor; images: MotionImages; version: number; kind: "effect" | "nameplate"; name: string }) {
  const { spec, scope, clock, playing, selection, setSelection, commitClips, autoKey } = editor;
  const stage = spec.stage;
  const t = useClockValue(clock, playing, 10);
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<MotionRenderer | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [backdrop, setBackdrop] = useState<Backdrop>("checker");
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const gesture = useRef<Gesture | null>(null);

  // What is drawn is the scope being edited: the top level, or the inside of an opened compound clip.
  const shown = useMemo<MotionSpec>(() => ({ ...spec, clips: scope.clips, duration: scope.duration }), [spec, scope]);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // The stage's size on screen: it fits the space, or is a fixed multiple of its own size.
  const fit = Math.max(0.05, Math.min((box.w - 24) / stage.w, (box.h - 24) / stage.h));
  const view = zoomMode === "fit" ? fit : zoomMode;
  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);

  // The renderer is rebuilt when the design's pictures or its shape change, and reused for every frame in between.
  useEffect(() => {
    renderer.current = new MotionRenderer(shown, images, Math.min(2, Math.max(0.25, view * dpr)));
  }, [shown, images, version, view, dpr]);

  const draw = useCallback(() => {
    const c = canvas.current;
    const r = renderer.current;
    if (!c || !r) return;
    const src = r.render(clock.value);
    if (c.width !== src.width || c.height !== src.height) {
      c.width = src.width;
      c.height = src.height;
    }
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    c.getContext("2d")!.drawImage(src, 0, 0);
  }, [clock]);

  useEffect(() => {
    let raf = 0;
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); });
    };
    schedule();
    const off = clock.subscribe(schedule);
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [clock, draw, shown, images, version, view, dpr]);

  // --- Handles --------------------------------------------------------------------------------------
  const one: Clip | null = selection.length === 1 ? (scope.clips.find((c) => c.id === selection[0]) ?? null) : null;
  const resolved = one ? sampleClip(one, t, stage) : null;
  const geom = useMemo(() => {
    if (!one || !resolved || one.source.type === "adjust" || one.source.type === "compound") return null;
    const b = sourceBox(one.source, stage);
    const rest = restOf(one.source);
    return { quad: clipQuad(resolved, { ...b, ox: rest.x, oy: rest.y }, stage), box: b };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [one, resolved?.x, resolved?.y, resolved?.sx, resolved?.sy, resolved?.rotation, stage]);

  const toStage = (e: { clientX: number; clientY: number }) => {
    const r = frame.current!.querySelector("[data-stage]")!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * stage.w, y: ((e.clientY - r.top) / r.height) * stage.h };
  };

  const apply = (id: string, fn: (c: Clip) => Clip, key: string) => commitClips((clips) => clips.map((c) => (c.id === id ? fn(c) : c)), key);

  const onDown = (e: React.PointerEvent) => {
    const p = toStage(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const handle = (e.target as Element).closest("[data-handle]")?.getAttribute("data-handle");
    if (one && resolved && geom && handle) {
      const piv = geom.quad.pivot;
      if (handle === "rotate") gesture.current = { kind: "rotate", id: one.id, pivot: piv, a0: Math.atan2(p.y - piv.y, p.x - piv.x), r0: resolved.rotation };
      else gesture.current = { kind: "scale", id: one.id, pivot: piv, d0: Math.max(1, Math.hypot(p.x - piv.x, p.y - piv.y)), sx0: resolved.sx, sy0: resolved.sy, axis: handle === "e" || handle === "w" ? "x" : handle === "n" || handle === "s" ? "y" : "both" };
      return;
    }
    // Pick the topmost clip under the pointer: the last drawn that has a box there.
    const order = [...scope.clips].filter((c) => c.on).sort((a, b) => a.track - b.track || a.start - b.start);
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i];
      const r = sampleClip(c, clock.value, stage);
      if (!r || c.source.type === "adjust" || c.source.type === "compound") continue;
      const b = sourceBox(c.source, stage);
      const rest = restOf(c.source);
      if (inQuad(p, clipQuad(r, { ...b, ox: rest.x, oy: rest.y }, stage))) {
        setSelection(e.shiftKey ? [...new Set([...selection, c.id])] : [c.id]);
        gesture.current = { kind: "move", id: c.id, start: p, x0: r.x, y0: r.y };
        return;
      }
    }
    setSelection([]);
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const p = toStage(e);
    const local = clock.value - (scope.clips.find((c) => c.id === g.id)?.start ?? 0);
    if (g.kind === "move") {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (e.shiftKey) (Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0));
      apply(g.id, (c) => setPropAt(setPropAt(c, "transform.x", local, Math.round(g.x0 + dx), autoKey), "transform.y", local, Math.round(g.y0 + dy), autoKey), `move-${g.id}`);
    } else if (g.kind === "scale") {
      const k = Math.max(0.01, Math.hypot(p.x - g.pivot.x, p.y - g.pivot.y) / g.d0);
      const uniform = g.axis === "both" || e.shiftKey;
      apply(g.id, (c) => {
        let n = c;
        if (uniform || g.axis === "x") n = setPropAt(n, "transform.scaleX", local, +(g.sx0 * k).toFixed(3), autoKey);
        if (uniform || g.axis === "y") n = setPropAt(n, "transform.scaleY", local, +(g.sy0 * k).toFixed(3), autoKey);
        return n;
      }, `scale-${g.id}`);
    } else {
      let r = g.r0 + ((Math.atan2(p.y - g.pivot.y, p.x - g.pivot.x) - g.a0) * 180) / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      apply(g.id, (c) => setPropAt(c, "transform.rotation", local, Math.round(r * 10) / 10, autoKey), `rotate-${g.id}`);
    }
  };
  const onUp = () => {
    gesture.current = null;
  };

  // --- Layout ---------------------------------------------------------------------------------------
  const sw = stage.w * view;
  const sh = stage.h * view;
  const worn = backdrop === "worn";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="ai-edge-b flex h-7 shrink-0 items-center gap-2 px-2 text-[11px]">
        <span className="text-[var(--ai-dim)]">View</span>
        <select aria-label="Zoom" value={zoomMode === "fit" ? "fit" : String(zoomMode)} onChange={(e) => setZoomMode(e.target.value === "fit" ? "fit" : Number(e.target.value))} className="h-5 rounded-[3px] border border-input bg-background/60 px-1 text-[11px] outline-none">
          <option value="fit">Fit ({Math.round(fit * 100)}%)</option>
          {[0.5, 1, 1.5, 2].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
        </select>
        <select aria-label="Backdrop" value={backdrop} onChange={(e) => setBackdrop(e.target.value as Backdrop)} className="h-5 rounded-[3px] border border-input bg-background/60 px-1 text-[11px] outline-none">
          <option value="checker">Transparent</option>
          <option value="dark">Dark</option>
          <option value="worn">{kind === "nameplate" ? "As worn (behind a name)" : "As worn (over a profile)"}</option>
        </select>
        <span className="ml-auto truncate text-[var(--ai-dim)]">{name} · {stage.w}×{stage.h}</span>
      </div>

      <div ref={frame} className="relative min-h-0 flex-1 overflow-auto bg-[var(--ai-pasteboard,#1a1a1f)]">
        <div className="flex min-h-full min-w-full items-center justify-center p-3">
          <div
            data-stage
            className={cn("relative shrink-0 overflow-hidden", backdrop === "checker" && "bg-[repeating-conic-gradient(#2a2a31_0_25%,#202026_0_50%)] bg-[length:16px_16px]", backdrop === "dark" && "bg-neutral-900", worn && "rounded-xl bg-card")}
            style={{ width: sw, height: sh }}
          >
            {worn && kind === "effect" && (
              <>
                <div className="absolute inset-x-0 top-0 h-[28%] bg-gradient-to-br from-violet-500/50 to-sky-500/40" />
                <div className="absolute top-[18%] left-[6%] size-[22%] rounded-full border-4 border-card bg-muted" />
                <div className="absolute top-[55%] left-[6%] text-[3.4cqw] font-semibold" style={{ fontSize: Math.max(10, sw * 0.045) }}>{name || "Your name"}</div>
              </>
            )}
            {worn && kind === "nameplate" && (
              <div className="absolute inset-y-0 left-0 flex items-center gap-[2%] pl-[2.5%]">
                <div className="rounded-full bg-muted" style={{ width: sh * 0.62, height: sh * 0.62 }} />
                <span className="font-medium" style={{ fontSize: sh * 0.26 }}>{name || "Your name"}</span>
              </div>
            )}
            <canvas ref={canvas} aria-label="Preview" className={cn("pointer-events-none absolute inset-0 size-full", worn && kind === "nameplate" && "fade-mask-l opacity-20")} />

            <svg className="absolute inset-0 size-full touch-none" viewBox={`0 0 ${stage.w} ${stage.h}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} style={{ cursor: "default" }}>
              <rect width={stage.w} height={stage.h} fill="transparent" />
              {geom && one && (
                <g pointerEvents="all">
                  <polygon points={[geom.quad.tl, geom.quad.tr, geom.quad.br, geom.quad.bl].map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="var(--ai-select, #4f9dff)" strokeWidth={1.5 / view} />
                  {(["tl", "tr", "br", "bl"] as const).map((k) => (
                    <rect key={k} data-handle={k} x={geom.quad[k].x - 5 / view} y={geom.quad[k].y - 5 / view} width={10 / view} height={10 / view} fill="white" stroke="var(--ai-select, #4f9dff)" strokeWidth={1.5 / view} style={{ cursor: "nwse-resize" }} />
                  ))}
                  {([["n", geom.quad.tl, geom.quad.tr], ["e", geom.quad.tr, geom.quad.br], ["s", geom.quad.bl, geom.quad.br], ["w", geom.quad.tl, geom.quad.bl]] as const).map(([k, a, b]) => (
                    <rect key={k} data-handle={k} x={(a.x + b.x) / 2 - 4 / view} y={(a.y + b.y) / 2 - 4 / view} width={8 / view} height={8 / view} fill="white" stroke="var(--ai-select, #4f9dff)" strokeWidth={1.5 / view} style={{ cursor: k === "n" || k === "s" ? "ns-resize" : "ew-resize" }} />
                  ))}
                  <line x1={(geom.quad.tl.x + geom.quad.tr.x) / 2} y1={(geom.quad.tl.y + geom.quad.tr.y) / 2} x2={geom.quad.rotationHandle.x} y2={geom.quad.rotationHandle.y} stroke="var(--ai-select, #4f9dff)" strokeWidth={1 / view} />
                  <circle data-handle="rotate" cx={geom.quad.rotationHandle.x} cy={geom.quad.rotationHandle.y} r={6 / view} fill="white" stroke="var(--ai-select, #4f9dff)" strokeWidth={1.5 / view} style={{ cursor: "grab" }} />
                  <circle cx={geom.quad.pivot.x} cy={geom.quad.pivot.y} r={3 / view} fill="var(--ai-select, #4f9dff)" />
                </g>
              )}
            </svg>
          </div>
        </div>
      </div>

      <Transport editor={editor} t={t} />
    </div>
  );
}

function Transport({ editor, t }: { editor: MotionEditor; t: number }) {
  const { playing, togglePlay, step, seek, loop, setLoop, scope, rate } = editor;
  const btn = "flex size-6 items-center justify-center rounded text-[var(--ai-text)] hover:bg-white/10";
  return (
    <div className="ai-edge-t flex h-9 shrink-0 items-center gap-1 px-2">
      <button type="button" className={btn} aria-label="Go to start" onClick={() => seek(0)}><SkipBack className="size-3.5" /></button>
      <button type="button" className={btn} aria-label="Back one frame" onClick={() => step(-1)}><StepBack className="size-3.5" /></button>
      <button type="button" className={cn(btn, "bg-white/10")} aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
      <button type="button" className={btn} aria-label="Forward one frame" onClick={() => step(1)}><StepForward className="size-3.5" /></button>
      <button type="button" className={btn} aria-label="Go to end" onClick={() => seek(scope.duration)}><SkipForward className="size-3.5" /></button>
      <button type="button" aria-pressed={loop} aria-label="Loop" title="Loop playback" className={cn(btn, loop && "text-[var(--ai-accent,#8b5cf6)]")} onClick={() => setLoop(!loop)}><Repeat className="size-3.5" /></button>
      {playing && Math.abs(rate) !== 1 && <span className="rounded bg-white/10 px-1 text-[10px]">{rate > 0 ? "▶▶" : "◀◀"} {Math.abs(rate)}×</span>}
      <span className="ml-auto font-mono text-[12px] tabular-nums text-[var(--ai-text)]">{timecode(t)}</span>
      <span className="font-mono text-[11px] tabular-nums text-[var(--ai-dim)]">/ {timecode(scope.duration)} · {FPS} fps</span>
    </div>
  );
}

