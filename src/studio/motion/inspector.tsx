"use client";

import { ChevronLeft, ChevronRight, Diamond, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  BLEND_MODES, DIRS, MOTION_LIMITS, PARTICLE_SHAPES, SHAPE_KINDS, TEXT_ANIMS, TRANSITION_KINDS, evalProp,
  type BlendMode, type Clip, type ClipFx, type Source, type Transition,
} from "../../../convex/lib/motion";
import { ColourField, NumberField, Row, Section, SliderField } from "@/studio/editor/fields";
import { CurveEditor } from "@/studio/motion/curve-editor";
import { EFFECTS, TRANSITIONS, newTransition } from "@/studio/motion/library";
import {
  FRAME, animatedProps, clearKeys, endOf, getPath, hasKeys, keyTimes, keyedAt, neighbourKeys, parseTimecode, retimeConstant, setPath, setPropAt, setTransition, speedRamp, timecode, toggleKeyAt, trimEnd, valueAt,
} from "@/studio/motion/ops";
import { useClockValue, type MotionEditor } from "@/studio/motion/use-motion-editor";
import { cn } from "@/lib/utils";

const select = "h-6 w-full rounded-[3px] border border-input bg-background/60 px-1 text-[11px] text-foreground outline-none";
const LABEL: Record<string, string> = { fade: "Fade", slide: "Slide", zoom: "Zoom", pop: "Pop", blur: "Blur", wipe: "Wipe", flash: "Flash", spin: "Spin" };

/** The keyframe controls of one property: back to the previous key, the diamond, on to the next. */
function Keys({ clip, path, local, editor }: { clip: Clip; path: string; local: number; editor: MotionEditor }) {
  const v = getPath(clip, path) as never;
  const animated = hasKeys(v);
  const here = keyedAt(clip, path, local);
  const { prev, next } = neighbourKeys(v, local);
  const apply = (fn: (c: Clip) => Clip, key?: string) => editor.commitClips((cs) => cs.map((c) => (c.id === clip.id ? fn(c) : c)), key);
  return (
    <span className="flex shrink-0 items-center">
      <button type="button" aria-label="Previous keyframe" disabled={prev === null} onClick={() => prev !== null && editor.seek(clip.start + prev)} className="rounded p-0.5 text-[var(--ai-dim)] enabled:hover:text-foreground disabled:opacity-25"><ChevronLeft className="size-3" /></button>
      <button type="button" aria-label={here ? "Remove keyframe" : "Add keyframe"} aria-pressed={here} title={here ? "Remove the keyframe here" : animated ? "Add a keyframe here, holding the current value" : "Start animating: add a keyframe here"} onClick={() => apply((c) => toggleKeyAt(c, path, local))} className={cn("rounded p-0.5", here ? "text-amber-300" : animated ? "text-amber-300/50 hover:text-amber-300" : "text-[var(--ai-dim)] hover:text-foreground")}>
        <Diamond className={cn("size-3", here && "fill-current")} />
      </button>
      <button type="button" aria-label="Next keyframe" disabled={next === null} onClick={() => next !== null && editor.seek(clip.start + next)} className="rounded p-0.5 text-[var(--ai-dim)] enabled:hover:text-foreground disabled:opacity-25"><ChevronRight className="size-3" /></button>
      {animated && (
        <button type="button" aria-label="Remove all keyframes" title="Stop animating this: keep its value here and remove every keyframe" onClick={() => apply((c) => clearKeys(c, path, local))} className="rounded p-0.5 text-[var(--ai-dim)] hover:text-red-300"><Trash2 className="size-3" /></button>
      )}
    </span>
  );
}

/** One animatable property: its name, its value at the playhead, and its keyframe controls. */
function Param({ clip, path, label, local, editor, min, max, step = 1, suffix, slider = false, color = false, digits = 2 }: { clip: Clip; path: string; label: string; local: number; editor: MotionEditor; min?: number; max?: number; step?: number; suffix?: string; slider?: boolean; color?: boolean; digits?: number }) {
  const prop = getPath(clip, path);
  if (prop === undefined) return null;
  const value = valueAt(prop as never, local) as number | string;
  const set = (v: number | string) => editor.commitClips((cs) => cs.map((c) => (c.id === clip.id ? setPropAt(c, path, local, v, editor.autoKey) : c)), `p-${clip.id}-${path}`);
  return (
    <Row label={label}>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {color ? (
            <ColourField value={value as string} onChange={(c) => set(c)} />
          ) : slider ? (
            <SliderField value={+(value as number).toFixed(digits)} min={min ?? 0} max={max ?? 1} step={step} suffix={suffix} onChange={set} />
          ) : (
            <NumberField value={+(value as number).toFixed(digits)} min={min} max={max} step={step} suffix={suffix} onChange={set} />
          )}
        </div>
        <Keys clip={clip} path={path} local={local} editor={editor} />
      </div>
    </Row>
  );
}

export function Inspector({ editor }: { editor: MotionEditor }) {
  const { scope, selection, playing, clock } = editor;
  const t = useClockValue(clock, playing, 12);
  const clip = selection.length === 1 ? (scope.clips.find((c) => c.id === selection[0]) ?? null) : null;
  const [tab, setTab] = useState<"clip" | "animation">("clip");

  if (selection.length > 1) return <p className="p-3 text-[11px] text-[var(--ai-dim)]">{selection.length} clips selected. Select one to change its settings; transitions and effects from the Browser apply to all of them.</p>;
  if (!clip) return <DesignSettings editor={editor} />;

  const local = Math.min(clip.duration, Math.max(0, t - clip.start));
  const apply = (fn: (c: Clip) => Clip, key?: string) => editor.commitClips((cs) => cs.map((c) => (c.id === clip.id ? fn(c) : c)), key);
  const setP = (path: string, v: unknown) => apply((c) => setPath(c, path, v), `s-${clip.id}-${path}`);
  const lanes = animatedProps(clip);

  return (
    <div className="min-h-0 overflow-y-auto">
      <div className="ai-edge-b flex h-7 items-center gap-1 px-1.5 text-[11px]">
        {(["clip", "animation"] as const).map((k) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className={cn("h-5 rounded px-2", tab === k ? "bg-white/15 text-foreground" : "text-[var(--ai-dim)] hover:text-foreground")}>
            {k === "clip" ? "Inspector" : `Animation${lanes.length ? ` (${lanes.length})` : ""}`}
          </button>
        ))}
      </div>
      {tab === "animation" ? <AnimationTab clip={clip} local={local} editor={editor} /> : <ClipTab clip={clip} local={local} editor={editor} apply={apply} setP={setP} />}
    </div>
  );
}

/** Nothing selected: the design's own settings. */
function DesignSettings({ editor }: { editor: MotionEditor }) {
  const { spec, commit } = editor;
  return (
    <div>
      <Section title="Design">
        <Row label="Plays">
          <select aria-label="Loop mode" className={select} value={spec.loop.mode} onChange={(e) => commit((s) => ({ ...s, loop: { ...s.loop, mode: e.target.value as "loop" | "once" } }))}>
            <option value="loop">Loops</option>
            <option value="once">Once, then rests</option>
          </select>
        </Row>
        {spec.loop.mode === "once" && <Row label="Rest"><SliderField value={spec.loop.rest} min={0} max={30} step={0.5} suffix=" s" onChange={(rest) => commit((s) => ({ ...s, loop: { ...s.loop, rest } }), "rest")} /></Row>}
        <p className="text-[11px] text-[var(--ai-dim)]">
          {spec.loop.mode === "loop" ? "Plays again as soon as it ends. Make the end match the start so it doesn't jump." : "Plays through, holds the last frame for the rest, and plays again."} Stage {spec.stage.w}×{spec.stage.h}; up to {MOTION_LIMITS.duration} s and {MOTION_LIMITS.clips} clips.
        </p>
      </Section>
      <p className="p-3 text-[11px] text-[var(--ai-dim)]">Select a clip on the timeline or in the viewer to change it.</p>
    </div>
  );
}

function ClipTab({ clip, local, editor, apply, setP }: { clip: Clip; local: number; editor: MotionEditor; apply: (fn: (c: Clip) => Clip, key?: string) => void; setP: (path: string, v: unknown) => void }) {
  const dur = editor.scope.duration;
  const speed = typeof clip.speed === "number" ? clip.speed : null;
  const ptype = clip.source.type;
  const P = (path: string, label: string, o: Partial<Parameters<typeof Param>[0]> = {}) => <Param clip={clip} path={path} label={label} local={local} editor={editor} {...o} />;
  const [uniform, setUniform] = useState(true);

  return (
    <>
      <Section title="Clip">
        <Row label="Name"><input value={clip.name} maxLength={60} onChange={(e) => setP("name", e.target.value)} className="ai-field w-full bg-transparent px-1.5 text-[11px] outline-none" /></Row>
        <Row label="Start"><TimeField value={clip.start} onChange={(v) => editor.commitClips((cs, d) => cs.map((c) => (c.id === clip.id ? { ...c, start: Math.max(0, Math.min(d - c.duration, v)) } : c)), `start-${clip.id}`)} /></Row>
        <Row label="Duration"><TimeField value={clip.duration} onChange={(v) => editor.commitClips((cs, d) => cs.map((c) => (c.id === clip.id ? trimEnd(c, c.start + v, d) : c)), `dur-${clip.id}`)} /></Row>
        <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={clip.on} onChange={(e) => setP("on", e.target.checked)} /> On (drawn)</label>
      </Section>

      {ptype !== "adjust" && (
        <Section title="Transform">
          {P("transform.x", "Position X", { step: 1, suffix: "" })}
          {P("transform.y", "Position Y", { step: 1 })}
          {uniform ? (
            <Row label="Scale">
              <div className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <SliderField value={+(valueAt(clip.transform.scaleX, local) as number).toFixed(2)} min={0} max={4} step={0.01} onChange={(v) => apply((c) => setPropAt(setPropAt(c, "transform.scaleX", local, v, editor.autoKey), "transform.scaleY", local, v, editor.autoKey), `scale-${clip.id}`)} />
                </div>
                <Keys clip={clip} path="transform.scaleX" local={local} editor={editor} />
              </div>
            </Row>
          ) : (
            <>
              {P("transform.scaleX", "Scale X", { step: 0.01, min: -20, max: 20 })}
              {P("transform.scaleY", "Scale Y", { step: 0.01, min: -20, max: 20 })}
            </>
          )}
          <label className="flex items-center gap-2 text-[11px] text-[var(--ai-dim)]"><input type="checkbox" checked={uniform} onChange={(e) => setUniform(e.target.checked)} /> Scale together</label>
          {P("transform.rotation", "Rotation", { step: 1, suffix: "°", min: -3600, max: 3600 })}
          <Row label="Anchor X"><SliderField value={clip.transform.anchorX} min={0} max={1} step={0.01} onChange={(v) => setP("transform.anchorX", v)} /></Row>
          <Row label="Anchor Y"><SliderField value={clip.transform.anchorY} min={0} max={1} step={0.01} onChange={(v) => setP("transform.anchorY", v)} /></Row>
        </Section>
      )}

      <Section title="Compositing">
        {P("transform.opacity", "Opacity", { slider: true, min: 0, max: 1, step: 0.01 })}
        <Row label="Blend">
          <select aria-label="Blend mode" className={select} value={clip.blend} onChange={(e) => setP("blend", e.target.value as BlendMode)}>
            {BLEND_MODES.map((b) => <option key={b} value={b}>{b === "softLight" ? "Soft light" : b === "hardLight" ? "Hard light" : b === "colorDodge" ? "Colour dodge" : b[0].toUpperCase() + b.slice(1)}</option>)}
          </select>
        </Row>
      </Section>

      <SourceSection clip={clip} local={local} editor={editor} P={P} setP={setP} />

      <Section title="Effects" action={<AddEffect onAdd={(fx) => apply((c) => (c.fx.length >= MOTION_LIMITS.fx ? c : { ...c, fx: [...c.fx, fx] }))} disabled={clip.fx.length >= MOTION_LIMITS.fx} />}>
        {clip.fx.length === 0 && <p className="text-[11px] text-[var(--ai-dim)]">None. {ptype === "adjust" ? "An adjustment layer applies its effects to everything beneath it." : "Add glow, blur, a shadow or a colour change."}</p>}
        {clip.fx.map((f, i) => (
          <div key={i} className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <div className="flex items-center justify-between text-[11px] font-medium">
              <span>{fxLabel(f)}</span>
              <button type="button" aria-label="Remove effect" onClick={() => apply((c) => ({ ...c, fx: c.fx.filter((_, j) => j !== i) }))} className="rounded p-0.5 text-[var(--ai-dim)] hover:text-foreground"><Trash2 className="size-3" /></button>
            </div>
            <FxFields f={f} i={i} P={P} />
          </div>
        ))}
      </Section>

      {ptype !== "adjust" && (
        <Section title="Mask" defaultOpen={!!clip.mask} action={clip.mask ? <button type="button" className="mr-1 text-[10px] text-[var(--ai-dim)] hover:text-foreground" onClick={() => apply((c) => ({ ...c, mask: undefined }))}>Remove</button> : <button type="button" className="mr-1 flex items-center gap-0.5 text-[10px] text-[var(--ai-dim)] hover:text-foreground" onClick={() => apply((c) => ({ ...c, mask: { shape: "ellipse", x: 0, y: 0, w: 200, h: 200, feather: 10, invert: false } }))}><Plus className="size-3" /> Add</button>}>
          {!clip.mask ? <p className="text-[11px] text-[var(--ai-dim)]">Show only part of the clip: an oval or a box, with a soft edge, that can move and grow over time.</p> : (
            <>
              <Row label="Shape"><select aria-label="Mask shape" className={select} value={clip.mask.shape} onChange={(e) => setP("mask.shape", e.target.value)}><option value="ellipse">Oval</option><option value="rect">Box</option></select></Row>
              {P("mask.x", "Centre X")}
              {P("mask.y", "Centre Y")}
              {P("mask.w", "Width", { min: 0 })}
              {P("mask.h", "Height", { min: 0 })}
              <Row label="Feather"><SliderField value={clip.mask.feather} min={0} max={100} onChange={(v) => setP("mask.feather", v)} /></Row>
              <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={clip.mask.invert} onChange={(e) => setP("mask.invert", e.target.checked)} /> Invert (cut a hole)</label>
            </>
          )}
        </Section>
      )}

      <Section title="Retime" defaultOpen={speed !== 1 || clip.reverse}>
        {speed !== null ? (
          <Row label="Speed"><SliderField value={speed} min={0.1} max={4} step={0.05} suffix="×" onChange={(v) => apply((c) => retimeConstant(c, v, dur), `speed-${clip.id}`)} /></Row>
        ) : (
          <>
            <Row label="Speed"><span className="text-[11px] text-[var(--ai-dim)]">A ramp: {evalProp(clip.speed, local).toFixed(2)}× now</span></Row>
            <button type="button" className="text-[11px] text-[var(--ai-accent,#8b5cf6)] hover:underline" onClick={() => apply((c) => ({ ...c, speed: 1 }))}>Back to normal speed</button>
          </>
        )}
        <div className="flex flex-wrap gap-1">
          {[["Ease in", 0.25, 1.5], ["Ease out", 1.5, 0.25], ["Slow → fast", 0.5, 3], ["Fast → slow", 3, 0.5]].map(([l, a, b]) => (
            <button key={String(l)} type="button" onClick={() => apply((c) => speedRamp(c, a as number, b as number))} className="h-5 rounded-[3px] border border-input bg-background/60 px-1.5 text-[10px] text-muted-foreground hover:text-foreground">{l}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={clip.reverse} onChange={(e) => setP("reverse", e.target.checked)} /> Reverse</label>
        <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={clip.loop} onChange={(e) => setP("loop", e.target.checked)} /> Repeat if the clip is longer than its contents</label>
        {(ptype === "compound" || ptype === "particles" || ptype === "noise" || ptype === "shimmer" || ptype === "rays") && (
          <Row label="Starts at"><TimeField value={clip.in} onChange={(v) => setP("in", Math.max(0, v))} /></Row>
        )}
      </Section>

      <Section title="Transitions" defaultOpen={!!clip.transitionIn || !!clip.transitionOut}>
        <TransitionRow label="In" tr={clip.transitionIn} clip={clip} onChange={(tr) => apply((c) => setTransition(c, "in", tr))} />
        <TransitionRow label="Out" tr={clip.transitionOut} clip={clip} onChange={(tr) => apply((c) => setTransition(c, "out", tr))} />
      </Section>
    </>
  );
}

const fxLabel = (f: ClipFx) => ({ blur: "Blur", glow: "Glow", shadow: "Drop shadow", adjust: "Colour adjust", tint: "Tint" })[f.type];

function AddEffect({ onAdd, disabled }: { onAdd: (fx: ClipFx) => void; disabled: boolean }) {
  return (
    <select aria-label="Add an effect" disabled={disabled} value="" onChange={(e) => { const x = EFFECTS.find((q) => q.id === e.target.value); if (x) onAdd(x.make()); }} className="mr-1 h-5 max-w-24 rounded-[3px] border border-input bg-background/60 px-1 text-[11px] text-foreground outline-none disabled:opacity-40">
      <option value="">+ Add…</option>
      {EFFECTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
    </select>
  );
}

function FxFields({ f, i, P }: { f: ClipFx; i: number; P: (path: string, label: string, o?: Partial<Parameters<typeof Param>[0]>) => React.ReactNode }) {
  const p = (k: string) => `fx.${i}.${k}`;
  switch (f.type) {
    case "blur":
      return <>{P(p("amount"), "Amount", { slider: true, min: 0, max: 60, step: 0.5 })}</>;
    case "glow":
      return <>{P(p("color"), "Colour", { color: true })}{P(p("blur"), "Size", { slider: true, min: 0, max: 100 })}{P(p("strength"), "Strength", { slider: true, min: 0, max: 6, step: 0.1 })}</>;
    case "shadow":
      return <>{P(p("color"), "Colour", { color: true })}{P(p("x"), "X")}{P(p("y"), "Y")}{P(p("blur"), "Blur", { slider: true, min: 0, max: 100 })}{P(p("opacity"), "Opacity", { slider: true, min: 0, max: 1, step: 0.01 })}</>;
    case "adjust":
      return <>{P(p("hue"), "Hue", { slider: true, min: -180, max: 180, suffix: "°" })}{P(p("saturation"), "Saturation", { slider: true, min: 0, max: 3, step: 0.05 })}{P(p("brightness"), "Brightness", { slider: true, min: 0, max: 2, step: 0.05 })}{P(p("contrast"), "Contrast", { slider: true, min: 0, max: 2, step: 0.05 })}</>;
    case "tint":
      return <>{P(p("color"), "Colour", { color: true })}{P(p("amount"), "Amount", { slider: true, min: 0, max: 1, step: 0.01 })}</>;
  }
}

function TransitionRow({ label, tr, clip, onChange }: { label: string; tr: Transition | undefined; clip: Clip; onChange: (t: Transition | undefined) => void }) {
  const info = TRANSITIONS.find((x) => x.id === tr?.type);
  return (
    <div className="space-y-1">
      <Row label={label}>
        <select aria-label={`${label} transition`} className={select} value={tr?.type ?? ""} onChange={(e) => onChange(e.target.value ? newTransition(e.target.value as Transition["type"], tr?.d ?? Math.min(0.5, clip.duration), tr?.dir ?? "left", tr?.e ?? "out") : undefined)}>
          <option value="">None</option>
          {TRANSITION_KINDS.map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
        </select>
      </Row>
      {tr && (
        <>
          <Row label="Length"><SliderField value={tr.d} min={0.05} max={Math.max(0.1, clip.duration)} step={0.05} suffix=" s" onChange={(d) => onChange({ ...tr, d })} /></Row>
          {info?.directional && <Row label="From"><select aria-label="Direction" className={select} value={tr.dir} onChange={(e) => onChange({ ...tr, dir: e.target.value as Transition["dir"] })}>{DIRS.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}</select></Row>}
        </>
      )}
    </div>
  );
}

/** A time you can type: as timecode (0:01:15) or seconds (1.5). */
function TimeField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      value={text ?? timecode(value)}
      onFocus={(e) => { setText(timecode(value)); e.currentTarget.select(); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const v = text === null ? null : parseTimecode(text); setText(null); if (v !== null) onChange(Math.round(v / FRAME) * FRAME); }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="ai-field w-full bg-transparent px-1.5 text-right font-mono text-[11px] outline-none"
    />
  );
}

// --- What a clip is made of --------------------------------------------------------------------------------------------

function SourceSection({ clip, local, editor, P, setP }: { clip: Clip; local: number; editor: MotionEditor; P: (path: string, label: string, o?: Partial<Parameters<typeof Param>[0]>) => React.ReactNode; setP: (path: string, v: unknown) => void }) {
  const s = clip.source as Source;
  const n = (path: string, label: string, min: number, max: number, step = 1, suffix?: string) => (
    <Row label={label}><SliderField value={+(getPath(clip, `source.${path}`) as number).toFixed(3)} min={min} max={max} step={step} suffix={suffix} onChange={(v) => setP(`source.${path}`, v)} /></Row>
  );
  const dim = (label = "Size") => (
    <Row label={label}>
      <div className="grid grid-cols-2 gap-1">
        <NumberField label="W" value={getPath(clip, "source.w") as number} min={1} max={4800} onChange={(v) => setP("source.w", v)} />
        <NumberField label="H" value={getPath(clip, "source.h") as number} min={1} max={4800} onChange={(v) => setP("source.h", v)} />
      </div>
    </Row>
  );
  void local;
  let body: React.ReactNode = null;
  switch (s.type) {
    case "shape":
      body = (
        <>
          <Row label="Shape"><select aria-label="Shape" className={select} value={s.shape} onChange={(e) => setP("source.shape", e.target.value)}>{SHAPE_KINDS.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></Row>
          {dim()}
          {P("source.fill", "Colour", { color: true })}
          {s.shape !== "ring" && s.shape !== "line" && P("source.stroke", "Outline", { color: true })}
          {n("strokeWidth", s.shape === "ring" || s.shape === "line" ? "Thickness" : "Outline", 0, 60, 0.5)}
          {s.shape === "rect" && n("radius", "Corners", 0, 200)}
          {s.shape === "star" && <>{n("points", "Points", 3, 24)}{n("inner", "Depth", 0.05, 0.95, 0.01)}</>}
        </>
      );
      break;
    case "text":
      body = (
        <>
          <Row label="Text"><input value={s.text} maxLength={MOTION_LIMITS.text} onChange={(e) => setP("source.text", e.target.value)} className="ai-field w-full bg-transparent px-1.5 text-[11px] outline-none" /></Row>
          {n("size", "Size", 8, 300)}
          {n("weight", "Weight", 100, 900, 100)}
          {P("source.color", "Colour", { color: true })}
          <Row label="Outline"><ColourField value={s.stroke} onChange={(c) => setP("source.stroke", c)} /></Row>
          {n("strokeWidth", "Outline w.", 0, 20, 0.5)}
          <Row label="Animation"><select aria-label="Text animation" className={select} value={s.anim} onChange={(e) => setP("source.anim", e.target.value)}>{TEXT_ANIMS.map((a) => <option key={a} value={a}>{a === "slideUp" ? "Slide up" : a[0].toUpperCase() + a.slice(1)}</option>)}</select></Row>
          {s.anim !== "none" && n("stagger", "Stagger", 0, 0.5, 0.01, " s")}
          <label className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={s.italic} onChange={(e) => setP("source.italic", e.target.checked)} /> Italic</label>
        </>
      );
      break;
    case "solid":
      body = <>{dim()}{P("source.color", "Colour", { color: true })}</>;
      break;
    case "gradient":
      body = (
        <>
          {dim()}
          <Row label="Kind"><select aria-label="Gradient kind" className={select} value={s.kind} onChange={(e) => setP("source.kind", e.target.value)}><option value="linear">Linear</option><option value="radial">Radial</option></select></Row>
          {s.kind === "linear" && P("source.angle", "Angle", { slider: true, min: -360, max: 360, suffix: "°" })}
          {s.stops.map((_, i) => <div key={i}>{P(`source.stops.${i}.c`, `Stop ${i + 1}`, { color: true })}</div>)}
        </>
      );
      break;
    case "noise":
      body = <>{dim()}{P("source.color", "Colour", { color: true })}{n("scale", "Scale", 8, 400)}{n("speed", "Drift", -3, 3, 0.05)}{n("contrast", "Contrast", 0, 1, 0.01)}{n("seed", "Pattern", 0, 99, 1)}</>;
      break;
    case "shimmer":
      body = <>{dim()}<Row label="Colour"><ColourField value={s.color} onChange={(c) => setP("source.color", c)} /></Row>{n("angle", "Angle", -90, 90, 1, "°")}{n("width", "Width", 0.05, 0.8, 0.01)}{n("period", "Every", 0.5, 10, 0.1, " s")}</>;
      break;
    case "rays":
      body = <>{n("r", "Radius", 50, 800)}{n("count", "Rays", 2, 40)}{P("source.color", "Colour", { color: true })}{n("spin", "Spin", -360, 360, 1, "°/s")}{n("softness", "Softness", 0, 1, 0.01)}</>;
      break;
    case "particles":
      body = (
        <>
          {dim("Emitter")}
          <Row label="Emits"><select aria-label="Emit mode" className={select} value={s.mode} onChange={(e) => setP("source.mode", e.target.value)}><option value="continuous">Continuously</option><option value="burst">In a burst</option></select></Row>
          <Row label="Shape"><select aria-label="Particle shape" className={select} value={s.shape} onChange={(e) => setP("source.shape", e.target.value)}>{PARTICLE_SHAPES.map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></Row>
          {n("count", "Amount", 1, MOTION_LIMITS.particles)}
          {n("life", "Lifetime", 0.2, 10, 0.1, " s")}
          {n("size", "Size", 1, 80, 0.5)}
          {n("sizeEnd", "Size at end", 0, 3, 0.05, "×")}
          {n("speed", "Speed", 0, 800)}
          {n("angle", "Direction", -180, 180, 1, "°")}
          {n("spread", "Spread", 0, 360, 1, "°")}
          {n("gravity", "Gravity", -800, 800)}
          {n("drift", "Drift", 0, 100)}
          {n("spin", "Spin", -720, 720, 1, "°/s")}
          {n("seed", "Pattern", 0, 99, 1)}
          <Row label="Colours">
            <div className="flex flex-wrap items-center gap-1">
              {s.colors.map((c, i) => (
                <input key={i} type="color" aria-label={`Particle colour ${i + 1}`} value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#ffffff"} onChange={(e) => setP("source.colors", s.colors.map((x, j) => (j === i ? e.target.value : x)))} className="size-5 cursor-pointer rounded border bg-transparent p-0" />
              ))}
              {s.colors.length < 6 && <button type="button" aria-label="Add a colour" className="size-5 rounded border border-input text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setP("source.colors", [...s.colors, "#ffffff"])}>+</button>}
              {s.colors.length > 1 && <button type="button" aria-label="Remove a colour" className="size-5 rounded border border-input text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setP("source.colors", s.colors.slice(0, -1))}>−</button>}
            </div>
          </Row>
        </>
      );
      break;
    case "image":
    case "layer":
      body = <p className="text-[11px] text-[var(--ai-dim)]">{s.type === "layer" ? "A layer of your canvas artwork. Edit it in the Canvas tab; the clip follows." : "A picture from this project's files."} {Math.round(s.w)}×{Math.round(s.h)}</p>;
      break;
    case "compound":
      body = (
        <>
          <p className="text-[11px] text-[var(--ai-dim)]">{s.clips.length} clip{s.clips.length === 1 ? "" : "s"} inside, {timecode(s.duration)} long.</p>
          <button type="button" className="h-6 w-full rounded-[3px] border border-input bg-background/60 text-[11px] hover:bg-white/10" onClick={() => editor.open(clip.id)}>Open in the timeline</button>
        </>
      );
      break;
    case "adjust":
      body = <p className="text-[11px] text-[var(--ai-dim)]">An adjustment layer has no picture of its own. Its effects change everything on lower lanes at the same time.</p>;
      break;
  }
  return <Section title={s.type === "layer" ? "Layer" : s.type === "adjust" ? "Adjustment layer" : s.type[0].toUpperCase() + s.type.slice(1)}>{body}</Section>;
}

// --- The animation tab -------------------------------------------------------------------------------------------------------

function AnimationTab({ clip, local, editor }: { clip: Clip; local: number; editor: MotionEditor }) {
  const lanes = useMemo(() => animatedProps(clip), [clip]);
  const [which, setWhich] = useState<string | null>(null);
  const [key, setKey] = useState<number | null>(null);
  const numeric = lanes.filter((l) => typeof (getPath(clip, l.path) as { k?: { v: unknown }[] }).k?.[0]?.v === "number");
  const colour = lanes.filter((l) => !numeric.includes(l));
  const path = which && numeric.some((l) => l.path === which) ? which : (numeric[0]?.path ?? null);
  const label = numeric.find((l) => l.path === path)?.label ?? "";

  if (lanes.length === 0) {
    return (
      <p className="p-3 text-[11px] text-[var(--ai-dim)]">
        Nothing on this clip is animated yet. Click the diamond beside a setting (Position, Scale, Rotation, Opacity, an effect…) at one time, move the playhead, and change the setting: it moves between the two.
        Or switch on <b>Auto-key</b> and just move things in the viewer at different times.
      </p>
    );
  }
  return (
    <div className="space-y-2 p-2.5">
      <div className="flex flex-wrap gap-1">
        {numeric.map((l) => (
          <button key={l.path} type="button" aria-pressed={l.path === path} onClick={() => { setWhich(l.path); setKey(null); }} className={cn("h-5 rounded-[3px] border border-input px-1.5 text-[10px]", l.path === path ? "bg-primary/25 text-foreground" : "bg-background/60 text-muted-foreground hover:text-foreground")}>{l.label}</button>
        ))}
      </div>
      {path && <CurveEditor key={path} clip={clip} path={path} label={label} local={local} selectedKey={key} onSelectKey={setKey} onChange={(c, g) => editor.commitClips((cs) => cs.map((x) => (x.id === clip.id ? c : x)), g)} />}
      {colour.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--ai-dim)]">Animated colours</div>
          {colour.map((l) => <div key={l.path} className="flex justify-between text-[11px]"><span>{l.label}</span><span className="text-[var(--ai-dim)]">{keyTimes(getPath(clip, l.path) as never).length} keys · edit in the Inspector</span></div>)}
        </div>
      )}
      <p className="text-[10px] text-[var(--ai-dim)]">Clip time {timecode(local)} · {endOf(clip) > clip.start ? timecode(clip.duration) : ""} long</p>
    </div>
  );
}
