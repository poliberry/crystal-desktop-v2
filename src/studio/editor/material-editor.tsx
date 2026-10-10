"use client";

import { Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { ColourField, Row, SliderField } from "@/studio/editor/fields";
import { defaultMaterial, MATERIAL_COLORS, MATERIAL_LABEL, MATERIAL_PRESETS, MATERIAL_TYPES, MATERIAL_USES, materialPixels, PRESET_GROUPS } from "@/studio/model/material";
import type { Material, MaterialType } from "@/studio/model/types";
import { cn } from "@/lib/utils";

/** A material drawn small, as the swatch of a preset or the header of the editor. Made once per look. */
export function MaterialSwatch({ material, size = 36, className }: { material: Material; size?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(material);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const px = Math.round(size * (window.devicePixelRatio || 1));
    c.width = px;
    c.height = px;
    // The swatch shows the surface at the size it will have on a typical node, not zoomed to fit the swatch.
    const data = new ImageData(materialPixels(material, px, px, (window.devicePixelRatio || 1) * 0.9) as unknown as Uint8ClampedArray<ArrayBuffer>, px, px);
    c.getContext("2d")!.putImageData(data, 0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size }} className={cn("rounded-[3px] border border-input", className)} />;
}

/**
 * Choose and tune a material: a grid of ready-made ones by group, then the kind, its two colours, how big
 * the grain is, how strong, which way it runs, and a shuffle for another surface of the same kind.
 */
export function MaterialEditor({ value, onChange }: { value: Material; onChange: (m: Material) => void }) {
  const [c1, c2] = MATERIAL_COLORS[value.type];
  const uses = MATERIAL_USES[value.type];
  const groups = useMemo(() => PRESET_GROUPS.map((g) => ({ group: g, items: MATERIAL_PRESETS.filter((p) => p.group === g) })), []);
  const set = (p: Partial<Material>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-1.5">
      <div className="space-y-1">
        {groups.map(({ group, items }) => (
          <div key={group}>
            <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{group}</p>
            <div className="flex flex-wrap gap-1">
              {items.map((p) => {
                const active = JSON.stringify(p.material) === JSON.stringify(value);
                return (
                  <button key={p.id} type="button" title={p.label} aria-label={p.label} aria-pressed={active} onClick={() => onChange(p.material)} className={cn("rounded-[4px] p-px", active && "ring-2 ring-primary")}>
                    <MaterialSwatch material={p.material} size={28} className="border-0" />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <Row label="Kind">
        <select
          aria-label="Material kind"
          value={value.type}
          onChange={(e) => onChange({ ...defaultMaterial(e.target.value as MaterialType), seed: value.seed })}
          className="h-6 w-full rounded-[3px] border border-input bg-background/60 px-1 text-[11px] text-foreground outline-none"
        >
          {MATERIAL_TYPES.map((t) => (
            <option key={t} value={t}>{MATERIAL_LABEL[t]}</option>
          ))}
        </select>
      </Row>
      <Row label={c1}><ColourField value={value.color} onChange={(color) => set({ color })} /></Row>
      <Row label={c2}><ColourField value={value.color2} onChange={(color2) => set({ color2 })} /></Row>
      <Row label="Size"><SliderField value={value.scale} min={4} max={160} onChange={(scale) => set({ scale })} /></Row>
      <Row label="Strength"><SliderField value={Math.round(value.intensity * 100)} min={0} max={100} suffix="%" onChange={(v) => set({ intensity: v / 100 })} /></Row>
      {uses.angle && <Row label="Grain"><SliderField value={value.angle} min={-180} max={180} suffix="°" onChange={(angle) => set({ angle })} /></Row>}
      <button type="button" onClick={() => set({ seed: (value.seed % 99999) + 1 })} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
        <Shuffle className="size-3" /> Another {MATERIAL_LABEL[value.type].toLowerCase()} (pattern {value.seed})
      </button>
    </div>
  );
}
