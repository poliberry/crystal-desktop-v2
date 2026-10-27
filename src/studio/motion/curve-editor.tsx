"use client";

import { useMemo, useRef } from "react";

import { EASE_PRESETS, ease, evalProp, type Ease, type Key, type Prop } from "../../../convex/lib/motion";
import { NumberField } from "@/studio/editor/fields";
import { FRAME, getPath, setPath, valueRange } from "@/studio/motion/ops";
import type { Clip } from "../../../convex/lib/motion";
import { cn } from "@/lib/utils";

const W = 300;
const H = 150;
const PAD = 14;

const sameEase = (a: Ease, b: Ease) => JSON.stringify(a) === JSON.stringify(b);
const EASE_LABEL: Record<string, string> = { linear: "Linear", hold: "Hold", in: "Ease in", out: "Ease out", inOut: "Ease in-out", sine: "Sine", expo: "Expo", back: "Back", bounce: "Bounce", elastic: "Elastic" };

/**
 * A property's animation as a graph: time across, value up. Each key is a point you can drag in time and value, and
 * each segment says how it eases into the next key — a preset, or a cubic Bézier you set with four numbers. Double-click
 * the curve to add a key where you click.
 */
export function CurveEditor({ clip, path, label, local, onChange, selectedKey, onSelectKey }: { clip: Clip; path: string; label: string; local: number; onChange: (c: Clip, gesture?: string) => void; selectedKey: number | null; onSelectKey: (i: number | null) => void }) {
  const raw = getPath(clip, path) as Prop | undefined;
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<number | null>(null);
  const keys = (typeof raw === "object" ? raw.k : []) as Key<number>[];
  const range = useMemo(() => valueRange(raw ?? 0), [raw]);
  const dur = Math.max(FRAME, clip.duration);

  const X = (t: number) => PAD + (t / dur) * (W - PAD * 2);
  const Y = (v: number) => H - PAD - ((v - range.min) / (range.max - range.min)) * (H - PAD * 2);
  const unX = (x: number) => Math.min(dur, Math.max(0, ((x - PAD) / (W - PAD * 2)) * dur));
  const unY = (y: number) => range.min + ((H - PAD - y) / (H - PAD * 2)) * (range.max - range.min);

  const curve = useMemo(() => {
    if (raw === undefined) return "";
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * dur;
      pts.push(`${i ? "L" : "M"}${X(t).toFixed(1)} ${Y(evalProp(raw, t)).toFixed(1)}`);
    }
    return pts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, dur, range.min, range.max]);

  if (raw === undefined || typeof raw === "string") return null;

  const write = (next: Key<number>[], gesture = "curve") => {
    const sorted = [...next].sort((a, b) => a.t - b.t);
    onChange(setPath(clip, path, sorted.length === 1 ? sorted[0].v : { k: sorted }), gesture);
  };
  const pointer = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onDown = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragging.current = i;
    onSelectKey(i);
  };
  const onMove = (e: React.PointerEvent) => {
    const i = dragging.current;
    if (i === null) return;
    const p = pointer(e);
    const t = Math.round(unX(p.x) / FRAME) * FRAME;
    const v = +unY(p.y).toFixed(3);
    const next = keys.map((k, j) => (j === i ? { ...k, t: +t.toFixed(3), v: e.shiftKey ? k.v : v } : k));
    // Dragging past a neighbour reorders; keep following the same key.
    const order = [...next].sort((a, b) => a.t - b.t);
    dragging.current = order.indexOf(next[i]);
    onSelectKey(dragging.current);
    write(order, `curve-${path}`);
  };
  const onUp = () => {
    dragging.current = null;
  };

  const sel = selectedKey !== null ? keys[selectedKey] : null;
  const setEase = (e: Ease) => sel && write(keys.map((k, j) => (j === selectedKey ? { ...k, e } : k)));
  const bez: [number, number, number, number] = Array.isArray(sel?.e) ? sel!.e : [0.42, 0, 0.58, 1];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-[var(--ai-text)]">{label}</span>
        <span className="text-[var(--ai-dim)]">{keys.length} key{keys.length === 1 ? "" : "s"}</span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-[3px] border border-white/10 bg-black/25"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={(e) => {
          const p = pointer(e);
          const t = Math.round(unX(p.x) / FRAME) * FRAME;
          if (keys.some((k) => Math.abs(k.t - t) < FRAME / 2)) return;
          write([...keys, { t: +t.toFixed(3), v: +evalProp(raw, t).toFixed(3), e: "linear" }]);
        }}
        onPointerDown={() => onSelectKey(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="white" strokeOpacity={0.06} />
        ))}
        {/* Zero line, where there is one in view */}
        {range.min < 0 && range.max > 0 && <line x1={PAD} x2={W - PAD} y1={Y(0)} y2={Y(0)} stroke="white" strokeOpacity={0.2} strokeDasharray="3 3" />}
        <path d={curve} fill="none" stroke="#a78bfa" strokeWidth={1.8} />
        {/* The playhead */}
        <line x1={X(Math.min(dur, Math.max(0, local)))} x2={X(Math.min(dur, Math.max(0, local)))} y1={PAD / 2} y2={H - PAD / 2} stroke="#ef4444" strokeWidth={1} />
        {keys.map((k, i) => (
          <circle key={i} cx={X(k.t)} cy={Y(k.v)} r={selectedKey === i ? 6 : 4.5} fill={selectedKey === i ? "#fbbf24" : "white"} stroke="#4c1d95" strokeWidth={1.5} className="cursor-grab" onPointerDown={(e) => onDown(e, i)} />
        ))}
      </svg>
      {sel && selectedKey !== null && (
        <div className="space-y-1 rounded-[3px] border border-border/60 p-1.5">
          <div className="flex items-center gap-1 text-[11px]">
            <span className="w-14 shrink-0 text-[var(--ai-dim)]">Key {selectedKey + 1}</span>
            <NumberField label="" className="min-w-0 flex-1" value={sel.v} step={0.1} onChange={(v) => write(keys.map((k, j) => (j === selectedKey ? { ...k, v } : k)))} />
            <button type="button" className="rounded px-1.5 py-0.5 text-[11px] text-red-300 hover:bg-white/10" onClick={() => { write(keys.filter((_, j) => j !== selectedKey)); onSelectKey(null); }}>Delete</button>
          </div>
          {selectedKey < keys.length - 1 ? (
            <>
              <div className="text-[10px] text-[var(--ai-dim)]">How it moves to the next key</div>
              <div className="flex flex-wrap gap-1">
                {EASE_PRESETS.map((e) => (
                  <button key={e} type="button" aria-pressed={sameEase(sel.e, e)} onClick={() => setEase(e)} className={cn("h-5 rounded-[3px] border border-input px-1.5 text-[10px]", sameEase(sel.e, e) ? "bg-primary/25 text-foreground" : "bg-background/60 text-muted-foreground hover:text-foreground")}>{EASE_LABEL[e]}</button>
                ))}
                <button type="button" aria-pressed={Array.isArray(sel.e)} onClick={() => setEase(bez)} className={cn("h-5 rounded-[3px] border border-input px-1.5 text-[10px]", Array.isArray(sel.e) ? "bg-primary/25 text-foreground" : "bg-background/60 text-muted-foreground hover:text-foreground")}>Bézier</button>
              </div>
              {Array.isArray(sel.e) && (
                <div className="grid grid-cols-4 gap-1">
                  {(["x1", "y1", "x2", "y2"] as const).map((n, q) => (
                    <NumberField key={n} label="" suffix="" className="min-w-0" step={0.05} min={q % 2 === 0 ? 0 : -2} max={q % 2 === 0 ? 1 : 3} value={bez[q]} title={n} onChange={(v) => { const b = [...bez] as [number, number, number, number]; b[q] = v; setEase(b); }} />
                  ))}
                </div>
              )}
              <EasePreview e={sel.e} />
            </>
          ) : (
            <div className="text-[10px] text-[var(--ai-dim)]">The last key: its value is held to the end of the clip.</div>
          )}
        </div>
      )}
      {!sel && <p className="text-[10px] text-[var(--ai-dim)]">Drag a key to change when and how much. Shift keeps its value. Double-click the graph to add a key.</p>}
    </div>
  );
}

/** A small picture of an easing curve: progress against time, so "Ease out" and "Back" can be told apart at a glance. */
function EasePreview({ e }: { e: Ease }) {
  const pts = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    return `${i ? "L" : "M"}${(4 + t * 52).toFixed(1)} ${(36 - ease(e, t) * 28).toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 60 44" className="h-10 w-14 rounded-[3px] border border-white/10 bg-black/25">
      <path d={pts} fill="none" stroke="#a78bfa" strokeWidth={1.5} />
    </svg>
  );
}
