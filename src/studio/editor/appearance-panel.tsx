"use client";

import { Plus, Shuffle, Trash2, Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import { ColourField, NumberField, Row, Section, SliderField } from "@/studio/editor/fields";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { BRUSH_LABEL, BRUSH_TYPES, BRUSH_USES, defaultBrush } from "@/studio/model/brush";
import { MaterialEditor } from "@/studio/editor/material-editor";
import { defaultMaterial } from "@/studio/model/material";
import { addEffect, defaultGradient, GLOW_PRESETS, gradientCss, nodeGradient, nodeMaterial, newShader, SHADER_LABEL, strokeMaterialOf } from "@/studio/model/fx";
import { patchNodes } from "@/studio/model/doc";
import type { EffectKind } from "@/studio/model/fx";
import type { Brush, BrushType, Effects, Gradient, Material, Node, Shader, ShaderType } from "@/studio/model/types";
import { cn } from "@/lib/utils";

const SHADER_TYPES = Object.keys(SHADER_LABEL) as ShaderType[];

/** The settings of the brush a path is drawn with: only those that do something for that brush. */
function BrushFields({ brush, set }: { brush: Brush; set: (p: Partial<Brush>) => void }) {
  const uses = BRUSH_USES[brush.type];
  return (
    <div className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
      {uses.taper && <Row label="Taper"><SliderField value={Math.round(brush.taper * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ taper: v / 100 })} /></Row>}
      {uses.angle && <Row label="Nib angle"><SliderField value={brush.angle} min={-90} max={90} suffix="°" onChange={(angle) => set({ angle })} /></Row>}
      {uses.spacing && <Row label="Spacing"><SliderField value={brush.spacing} min={0.3} max={4} step={0.1} onChange={(spacing) => set({ spacing })} /></Row>}
      {uses.jitter && <Row label="Variation"><SliderField value={Math.round(brush.jitter * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ jitter: v / 100 })} /></Row>}
      {brush.type !== "taper" && brush.type !== "calligraphy" && (
        <button type="button" onClick={() => set({ seed: (brush.seed % 99999) + 1 })} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <Shuffle className="size-3" /> Scatter again (pattern {brush.seed})
        </button>
      )}
    </div>
  );
}

/** A row of mutually exclusive choices drawn as one segmented control. */
function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex h-6 overflow-hidden rounded-[3px] border border-input text-[11px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
          className={cn("flex-1 px-2 transition-colors", value === o.id ? "bg-primary/20 text-foreground" : "bg-background/60 text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GradientEditor({ value, onChange }: { value: Gradient; onChange: (g: Gradient) => void }) {
  const stops = value.stops;
  const setStop = (i: number, p: Partial<Gradient["stops"][number]>) => onChange({ ...value, stops: stops.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <div className="space-y-1.5">
      <div className="h-4 rounded-[3px] border border-input" style={{ background: gradientCss({ ...value, type: "linear", angle: 0 }) }} />
      <Segmented
        value={value.type}
        options={[
          { id: "linear", label: "Linear" },
          { id: "radial", label: "Radial" },
        ]}
        onChange={(type) => onChange({ ...value, type })}
      />
      {value.type === "linear" && <Row label="Angle"><NumberField value={value.angle} min={-360} max={360} suffix="°" onChange={(angle) => onChange({ ...value, angle })} /></Row>}
      <ul className="space-y-1">
        {stops.map((s, i) => (
          <li key={i} className="flex items-center gap-1">
            <ColourField value={s.color} onChange={(color) => setStop(i, { color })} className="min-w-0 flex-1" />
            <NumberField value={Math.round(s.offset * 100)} min={0} max={100} suffix="%" className="w-16 shrink-0" onChange={(v) => setStop(i, { offset: v / 100 })} />
            <button
              type="button"
              aria-label="Remove stop"
              disabled={stops.length <= 2}
              onClick={() => onChange({ ...value, stops: stops.filter((_, j) => j !== i) })}
              className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <Trash2 className="size-3" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={stops.length >= 8}
        onClick={() => onChange({ ...value, stops: [...stops, { offset: 1, color: stops[stops.length - 1]?.color ?? "#ffffff" }] })}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        <Plus className="size-3" /> Add stop
      </button>
    </div>
  );
}

/** The header of one effect: a switch to turn it on and off without losing its settings, and a way to remove it. */
function EffectHeader({ title, on, onToggle, onRemove }: { title: string; on: boolean; onToggle: () => void; onRemove: () => void }) {
  return (
    <div className="flex h-6 items-center gap-1">
      <button type="button" aria-label={on ? `Hide ${title}` : `Show ${title}`} aria-pressed={on} onClick={onToggle} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
        {on ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
      </button>
      <span className={cn("min-w-0 flex-1 truncate text-[11px] font-medium", !on && "text-muted-foreground")}>{title}</span>
      <button type="button" aria-label={`Remove ${title}`} onClick={onRemove} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

function ShaderFields({ s, set }: { s: Shader; set: (p: Partial<Shader>) => void }) {
  const num = (label: string, key: string, value: number, min: number, max: number, step = 1, suffix?: string) => (
    <Row label={label}>
      <SliderField value={value} min={min} max={max} step={step} suffix={suffix} onChange={(v) => set({ [key]: v } as Partial<Shader>)} />
    </Row>
  );
  switch (s.type) {
    case "adjust":
      return (
        <>
          {num("Hue", "hue", s.hue, -180, 180, 1, "°")}
          {num("Saturation", "saturation", s.saturation, 0, 3, 0.05)}
          {num("Brightness", "brightness", s.brightness, 0, 2, 0.05)}
          {num("Contrast", "contrast", s.contrast, 0, 2, 0.05)}
        </>
      );
    case "grain":
      return (
        <>
          {num("Amount", "amount", s.amount, 0, 1, 0.05)}
          {num("Seed", "seed", s.seed, 1, 99, 1)}
        </>
      );
    case "duotone":
      return (
        <>
          <Row label="Shadows"><ColourField value={s.shadow} onChange={(shadow) => set({ shadow } as Partial<Shader>)} /></Row>
          <Row label="Highlights"><ColourField value={s.highlight} onChange={(highlight) => set({ highlight } as Partial<Shader>)} /></Row>
        </>
      );
    case "pixelate":
      return num("Size", "size", s.size, 1, 40);
    case "posterize":
      return num("Levels", "levels", s.levels, 2, 16);
    case "scanlines":
      return (
        <>
          {num("Gap", "gap", s.gap, 1, 20)}
          {num("Strength", "strength", s.strength, 0, 1, 0.05)}
        </>
      );
    case "chromatic":
      return num("Offset", "offset", s.offset, -30, 30);
  }
}

/**
 * Fill, stroke, opacity and effects for the selection, in the order Illustrator's Appearance
 * panel lists them. Effects are on the node, not applied to it: they can be switched off,
 * changed or removed at any time, and the design keeps its original paint.
 *
 * Everything here is rendered onto the picture a decoration or sticker is sent as — see
 * model/fx-render.ts — which is why a design can have effects the app's own layer renderer
 * has no words for.
 */
export function AppearancePanel({ editor }: { editor: DocEditor }) {
  const { doc, selection, commit } = editor;
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as Node[];
  const paintable = nodes.filter((n) => n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path");
  const one = paintable.length === 1 ? paintable[0] : null;
  if (paintable.length === 0) {
    return <p className="p-3 text-[11px] text-muted-foreground">Select a picture, shape or text to give it a fill, a gradient, shadows, glows and shaders.</p>;
  }
  const ids = paintable.map((n) => n.id);
  const first = paintable[0];
  const fx: Effects = first.fx ?? {};

  const patch = (p: Partial<Node> | ((n: Node) => Partial<Node>), key: string) => commit(patchNodes(editor.doc, ids, p), key);
  /** Change effects on all of the selection, from the first one's as the baseline so they end up alike. */
  const setFx = (next: Effects | ((cur: Effects) => Effects), key: string) =>
    patch((n) => {
      const merged = typeof next === "function" ? next(fx) : next;
      const clean = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as Effects;
      return { fx: Object.keys(clean).length ? clean : undefined, id: n.id } as Partial<Node>;
    }, key);

  const gradient = one ? nodeGradient(one) : undefined;
  const setGradient = (g: Gradient | undefined) =>
    patch(first.type === "text" ? ({ colorGradient: g, colorMaterial: undefined } as Partial<Node>) : ({ fillGradient: g, fillMaterial: undefined } as Partial<Node>), "gradient");
  const material = one ? nodeMaterial(one) : undefined;
  const setMaterial = (m: Material | undefined) =>
    patch(first.type === "text" ? ({ colorMaterial: m, ...(m ? { colorGradient: undefined } : {}) } as Partial<Node>) : ({ fillMaterial: m, ...(m ? { fillGradient: undefined } : {}) } as Partial<Node>), "material");
  const strokeMaterial = one ? strokeMaterialOf(one) : undefined;
  const setStrokeMaterial = (m: Material | undefined) => patch({ strokeMaterial: m, ...(m ? { strokeGradient: undefined } : {}) } as Partial<Node>, "strokematerial");
  const [glowColor, setGlowColor] = useState("#22d3ee");

  const shadow = fx.shadow;
  const glow = fx.glow;
  const inner = fx.innerShadow;
  const innerGlow = fx.innerGlow;
  const shaders = fx.shaders ?? [];
  const setShader = (id: string, p: Partial<Shader>) => setFx((cur) => ({ ...cur, shaders: (cur.shaders ?? []).map((s) => (s.id === id ? ({ ...s, ...p } as Shader) : s)) }), `shader-${id}`);

  return (
    <div>
      {one && (one.type === "shape" || one.type === "text" || one.type === "path") && (
        <Section title="Fill">
          <Segmented
            value={material ? "material" : gradient ? "gradient" : one.type === "path" && one.fill === "none" ? "none" : "solid"}
            options={[
              { id: "solid", label: "Solid" },
              { id: "gradient", label: "Gradient" },
              { id: "material", label: "Material" },
              ...(one.type === "path" ? [{ id: "none" as const, label: "None" }] : []),
            ]}
            onChange={(m) => {
              if (m === "none") patch({ fill: "none", fillGradient: undefined, fillMaterial: undefined } as Partial<Node>, "fill");
              else if (m === "material") setMaterial(material ?? defaultMaterial("wood"));
              else if (m === "gradient") setGradient(gradient ?? defaultGradient(one.type === "text" ? one.color : one.fill === "none" ? "#8b5cf6" : one.fill));
              else {
                setGradient(undefined);
                if (one.type === "path" && one.fill === "none") patch({ fill: "#8b5cf6", fillGradient: undefined } as Partial<Node>, "fill");
              }
            }}
          />
          {material ? (
            <MaterialEditor value={material} onChange={setMaterial} />
          ) : gradient ? (
            <GradientEditor value={gradient} onChange={setGradient} />
          ) : one.type === "text" ? (
            <ColourField value={one.color} onChange={(color) => patch({ color } as Partial<Node>, "color")} />
          ) : one.fill === "none" ? null : (
            <ColourField value={one.fill} onChange={(fill) => patch({ fill } as Partial<Node>, "fill")} />
          )}
        </Section>
      )}

      {one && (one.type === "shape" || one.type === "path") && (
        <Section title="Stroke">
          <Segmented
            value={strokeMaterial ? "material" : one.strokeGradient ? "gradient" : "solid"}
            options={[
              { id: "solid", label: "Solid" },
              { id: "gradient", label: "Gradient" },
              { id: "material", label: "Material" },
            ]}
            onChange={(m) =>
              patch(
                {
                  strokeGradient: m === "gradient" ? (one.strokeGradient ?? defaultGradient(one.stroke)) : undefined,
                  strokeMaterial: m === "material" ? (strokeMaterial ?? defaultMaterial("metal")) : undefined,
                } as Partial<Node>,
                "strokegrad",
              )
            }
          />
          {strokeMaterial ? (
            <MaterialEditor value={strokeMaterial} onChange={setStrokeMaterial} />
          ) : one.strokeGradient ? (
            <GradientEditor value={one.strokeGradient} onChange={(g) => patch({ strokeGradient: g } as Partial<Node>, "strokegrad")} />
          ) : (
            <ColourField value={one.stroke} onChange={(stroke) => patch({ stroke } as Partial<Node>, "stroke")} />
          )}
          <Row label="Weight">
            <SliderField value={one.strokeWidth} min={0} max={60} step={0.5} suffix="pt" onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Node>, "strokew")} />
          </Row>
          {one.type === "path" && (
            <>
              <Row label="Brush">
                <select
                  aria-label="Brush"
                  value={one.brush?.type ?? "round"}
                  onChange={(e) => patch({ brush: e.target.value === "round" ? undefined : defaultBrush(e.target.value as BrushType) } as Partial<Node>, "brush")}
                  className="h-6 w-full rounded-[3px] border border-input bg-background/60 px-1 text-[11px] text-foreground outline-none"
                >
                  <option value="round">Round (plain line)</option>
                  {BRUSH_TYPES.map((t) => (
                    <option key={t} value={t}>{BRUSH_LABEL[t]}</option>
                  ))}
                </select>
              </Row>
              {one.brush && (
                <BrushFields
                  brush={one.brush}
                  set={(b) => patch({ brush: { ...one.brush!, ...b } } as Partial<Node>, "brush")}
                />
              )}
              <Row label="Cap">
                <Segmented value={one.cap} options={[{ id: "butt", label: "Butt" }, { id: "round", label: "Round" }, { id: "square", label: "Square" }]} onChange={(cap) => patch({ cap } as Partial<Node>, "cap")} />
              </Row>
              <Row label="Corner">
                <Segmented value={one.join} options={[{ id: "miter", label: "Miter" }, { id: "round", label: "Round" }, { id: "bevel", label: "Bevel" }]} onChange={(join) => patch({ join } as Partial<Node>, "join")} />
              </Row>
            </>
          )}
        </Section>
      )}

      <Section title="Opacity">
        <SliderField value={Math.round(first.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => patch({ opacity: v / 100 }, "opacity")} />
      </Section>

      <Section
        title="Effects"
        action={
          <div className="flex items-center gap-0.5 text-[10px]">
            <select
              aria-label="Add an effect"
              value=""
              onChange={(e) => {
                const v = e.target.value as EffectKind;
                if (v) setFx((c) => addEffect(c, v), "fx-add");
              }}
              className="h-5 max-w-24 rounded-[3px] border border-input bg-background/60 px-1 text-[11px] text-foreground outline-none"
            >
              <option value="">+ Add…</option>
              <optgroup label="Stylize">
                <option value="shadow" disabled={!!shadow}>Drop shadow</option>
                <option value="innerShadow" disabled={!!inner}>Inner shadow</option>
                <option value="glow" disabled={!!glow}>Outer glow</option>
                <option value="innerGlow" disabled={!!fx.innerGlow}>Inner glow</option>
                <option value="blur" disabled={!!fx.blur}>Gaussian blur</option>
              </optgroup>
              <optgroup label="Shaders">
                {SHADER_TYPES.map((t) => (
                  <option key={t} value={`shader:${t}`}>{SHADER_LABEL[t]}</option>
                ))}
              </optgroup>
            </select>
          </div>
        }
      >
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Glow looks</p>
          <div className="flex items-center gap-1.5">
            <ColourField value={glowColor} onChange={setGlowColor} className="w-28 shrink-0" />
            <div className="flex flex-wrap gap-1">
              {GLOW_PRESETS.map((g) => (
                <button key={g.id} type="button" onClick={() => setFx((c) => g.apply(c, glowColor), "fx-glowlook")} className="h-5 rounded-[3px] border border-input bg-background/60 px-1.5 text-[10px] text-muted-foreground hover:text-foreground">
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {!shadow && !glow && !innerGlow && !inner && !fx.blur && shaders.length === 0 && <p className="text-[11px] text-muted-foreground">None. They&apos;re drawn onto the picture this design is sent as.</p>}

        {shadow && (
          <div className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <EffectHeader title="Drop shadow" on={shadow.on} onToggle={() => setFx((c) => ({ ...c, shadow: { ...c.shadow!, on: !c.shadow!.on } }), "fx-shadow")} onRemove={() => setFx((c) => ({ ...c, shadow: undefined }), "fx-shadow")} />
            <div className="grid grid-cols-2 gap-1">
              <NumberField label="X" value={shadow.x} min={-500} max={500} onChange={(x) => setFx((c) => ({ ...c, shadow: { ...c.shadow!, x } }), "fx-shadow")} />
              <NumberField label="Y" value={shadow.y} min={-500} max={500} onChange={(y) => setFx((c) => ({ ...c, shadow: { ...c.shadow!, y } }), "fx-shadow")} />
            </div>
            <Row label="Blur"><SliderField value={shadow.blur} min={0} max={100} onChange={(blur) => setFx((c) => ({ ...c, shadow: { ...c.shadow!, blur } }), "fx-shadow")} /></Row>
            <Row label="Opacity"><SliderField value={Math.round(shadow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx((c) => ({ ...c, shadow: { ...c.shadow!, opacity: v / 100 } }), "fx-shadow")} /></Row>
            <Row label="Colour"><ColourField value={shadow.color} onChange={(color) => setFx((c) => ({ ...c, shadow: { ...c.shadow!, color } }), "fx-shadow")} /></Row>
          </div>
        )}

        {glow && (
          <div className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <EffectHeader title="Outer glow" on={glow.on} onToggle={() => setFx((c) => ({ ...c, glow: { ...c.glow!, on: !c.glow!.on } }), "fx-glow")} onRemove={() => setFx((c) => ({ ...c, glow: undefined }), "fx-glow")} />
            <Row label="Blur"><SliderField value={glow.blur} min={0} max={100} onChange={(blur) => setFx((c) => ({ ...c, glow: { ...c.glow!, blur } }), "fx-glow")} /></Row>
            <Row label="Strength"><SliderField value={glow.strength} min={1} max={6} onChange={(strength) => setFx((c) => ({ ...c, glow: { ...c.glow!, strength } }), "fx-glow")} /></Row>
            <Row label="Opacity"><SliderField value={Math.round(glow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx((c) => ({ ...c, glow: { ...c.glow!, opacity: v / 100 } }), "fx-glow")} /></Row>
            <Row label="Colour"><ColourField value={glow.color} onChange={(color) => setFx((c) => ({ ...c, glow: { ...c.glow!, color } }), "fx-glow")} /></Row>
          </div>
        )}

        {innerGlow && (
          <div className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <EffectHeader title="Inner glow" on={innerGlow.on} onToggle={() => setFx((c) => ({ ...c, innerGlow: { ...c.innerGlow!, on: !c.innerGlow!.on } }), "fx-iglow")} onRemove={() => setFx((c) => ({ ...c, innerGlow: undefined }), "fx-iglow")} />
            <Row label="Blur"><SliderField value={innerGlow.blur} min={0} max={100} onChange={(blur) => setFx((c) => ({ ...c, innerGlow: { ...c.innerGlow!, blur } }), "fx-iglow")} /></Row>
            <Row label="Strength"><SliderField value={innerGlow.strength} min={1} max={6} onChange={(strength) => setFx((c) => ({ ...c, innerGlow: { ...c.innerGlow!, strength } }), "fx-iglow")} /></Row>
            <Row label="Opacity"><SliderField value={Math.round(innerGlow.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx((c) => ({ ...c, innerGlow: { ...c.innerGlow!, opacity: v / 100 } }), "fx-iglow")} /></Row>
            <Row label="Colour"><ColourField value={innerGlow.color} onChange={(color) => setFx((c) => ({ ...c, innerGlow: { ...c.innerGlow!, color } }), "fx-iglow")} /></Row>
          </div>
        )}

        {inner && (
          <div className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <EffectHeader title="Inner shadow" on={inner.on} onToggle={() => setFx((c) => ({ ...c, innerShadow: { ...c.innerShadow!, on: !c.innerShadow!.on } }), "fx-inner")} onRemove={() => setFx((c) => ({ ...c, innerShadow: undefined }), "fx-inner")} />
            <div className="grid grid-cols-2 gap-1">
              <NumberField label="X" value={inner.x} min={-500} max={500} onChange={(x) => setFx((c) => ({ ...c, innerShadow: { ...c.innerShadow!, x } }), "fx-inner")} />
              <NumberField label="Y" value={inner.y} min={-500} max={500} onChange={(y) => setFx((c) => ({ ...c, innerShadow: { ...c.innerShadow!, y } }), "fx-inner")} />
            </div>
            <Row label="Blur"><SliderField value={inner.blur} min={0} max={100} onChange={(blur) => setFx((c) => ({ ...c, innerShadow: { ...c.innerShadow!, blur } }), "fx-inner")} /></Row>
            <Row label="Opacity"><SliderField value={Math.round(inner.opacity * 100)} min={0} max={100} suffix="%" onChange={(v) => setFx((c) => ({ ...c, innerShadow: { ...c.innerShadow!, opacity: v / 100 } }), "fx-inner")} /></Row>
            <Row label="Colour"><ColourField value={inner.color} onChange={(color) => setFx((c) => ({ ...c, innerShadow: { ...c.innerShadow!, color } }), "fx-inner")} /></Row>
          </div>
        )}

        {!!fx.blur && (
          <div className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <EffectHeader title="Gaussian blur" on onToggle={() => {}} onRemove={() => setFx((c) => ({ ...c, blur: undefined }), "fx-blur")} />
            <Row label="Radius"><SliderField value={fx.blur} min={0} max={50} step={0.5} onChange={(blur) => setFx((c) => ({ ...c, blur }), "fx-blur")} /></Row>
          </div>
        )}

        {shaders.map((s) => (
          <div key={s.id} className="space-y-1 rounded-[3px] border border-border/70 p-1.5">
            <EffectHeader title={SHADER_LABEL[s.type]} on={s.on} onToggle={() => setShader(s.id, { on: !s.on })} onRemove={() => setFx((c) => ({ ...c, shaders: (c.shaders ?? []).filter((x) => x.id !== s.id) }), "fx-shader")} />
            <ShaderFields s={s} set={(p) => setShader(s.id, p)} />
          </div>
        ))}
      </Section>
    </div>
  );
}
