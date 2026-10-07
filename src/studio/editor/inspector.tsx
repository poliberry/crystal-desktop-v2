"use client";

import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowUp, ArrowUpToLine, ArrowDown, ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { SCENE_PROP_KINDS } from "../../../convex/lib/creationSpecs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PROP_ASPECT } from "@/components/lounge/lounge-props";
import { boundsOf, patchNodes, reorder, round, unionBounds } from "@/studio/model/doc";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import type { Node, PropNode, ShapeNode, TextNode } from "@/studio/model/types";
import type { LoadedAsset } from "@/studio/storage/assets";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b border-border/60 p-3">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** A number you can type into, applied as you type and left alone while it is half-written. */
function NumberField({ label, value, onChange, step = 1, min, max, suffix }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [text, setText] = useState(String(round(value)));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(round(value)));
  }, [value, focused]);
  return (
    <label className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs focus-within:ring-1 focus-within:ring-ring">
      <span className="text-muted-foreground">{label}</span>
      <input
        value={text}
        inputMode="decimal"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(String(round(value)));
        }}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const n = round(value + (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1));
            onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
          }
        }}
        className="h-7 min-w-0 flex-1 bg-transparent text-right outline-none"
      />
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </label>
  );
}

function ColourField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#ffffff";
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} className="size-7 shrink-0 cursor-pointer rounded border border-input bg-transparent p-0.5" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-7 font-mono text-xs" />
    </div>
  );
}

export function Inspector({ editor, assets, onSetBackground }: { editor: DocEditor; assets: Map<string, LoadedAsset>; onSetBackground?: (id: string) => void }) {
  const { doc, selection, commit } = editor;
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as Node[];
  const patch = (p: Partial<Node> | ((n: Node) => Partial<Node>), key: string) => commit(patchNodes(editor.doc, selection, p), key);

  // Nothing selected: the design's own settings.
  if (nodes.length === 0) {
    return (
      <div>
        <Section title="Design">
          <Row label="Size">
            <span className="text-xs">
              {doc.artboard.w} × {doc.artboard.h}
            </span>
          </Row>
          <p className="text-xs text-muted-foreground">
            {doc.kind === "decoration" && "The circle is the avatar. Artwork has to stay inside the dashed edge."}
            {doc.kind === "sticker" && "This is a profile card. Stickers are placed from its top edge, and can be at most 70% of its width."}
            {doc.kind === "scene" && "The room is 16:9. Everything is measured against it, so it looks the same at any size."}
          </p>
        </Section>
        {doc.kind === "scene" && (
          <Section title="Lighting">
            <label className="flex items-center justify-between gap-2 text-sm">
              Dim the room while someone shares
              <Switch checked={doc.scene?.dimOnShare ?? false} onCheckedChange={(v) => commit({ ...doc, scene: { dimOnShare: v, amount: doc.scene?.amount ?? 0.6 } })} />
            </label>
            {doc.scene?.dimOnShare && (
              <Row label="Darkness">
                <Slider min={20} max={85} step={1} value={[Math.round((doc.scene.amount ?? 0.6) * 100)]} onValueChange={([v]) => commit({ ...doc, scene: { dimOnShare: true, amount: v / 100 } }, "lights")} />
              </Row>
            )}
          </Section>
        )}
      </div>
    );
  }

  const one = nodes.length === 1 ? nodes[0] : null;
  const box = unionBounds(nodes)!;
  const ref = one ? { x: 0, y: 0, w: doc.artboard.w, h: doc.artboard.h } : box;
  const align = (axis: "x" | "y", where: "start" | "centre" | "end") => {
    commit(
      patchNodes(doc, selection, (n) => {
        const b = boundsOf(n);
        const frame = one ? { x: 0, y: 0, w: doc.artboard.w, h: doc.artboard.h } : ref;
        if (axis === "x") {
          const target = where === "start" ? frame.x : where === "centre" ? frame.x + (frame.w - b.w) / 2 : frame.x + frame.w - b.w;
          return { x: round(n.x + (target - b.x)) };
        }
        const target = where === "start" ? frame.y : where === "centre" ? frame.y + (frame.h - b.h) / 2 : frame.y + frame.h - b.h;
        return n.type === "floor" ? { y: round(n.y + (target - b.y)) } : { y: round(n.y + (target - b.y)) };
      }),
    );
  };

  return (
    <div>
      <Section title={one ? one.name : `${nodes.length} selected`}>
        <div className="grid grid-cols-6 gap-1">
          {(
            [
              [AlignStartHorizontal, "Align left", () => align("x", "start")],
              [AlignCenterHorizontal, "Centre horizontally", () => align("x", "centre")],
              [AlignEndHorizontal, "Align right", () => align("x", "end")],
              [AlignStartVertical, "Align top", () => align("y", "start")],
              [AlignCenterVertical, "Centre vertically", () => align("y", "centre")],
              [AlignEndVertical, "Align bottom", () => align("y", "end")],
            ] as const
          ).map(([Icon, label, run]) => (
            <Button key={label} variant="ghost" size="icon" className="size-8" aria-label={label} title={label} onClick={run}>
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
        <div className="flex gap-1">
          {(
            [
              [ArrowUpToLine, "Bring to front", "front"],
              [ArrowUp, "Forward", "up"],
              [ArrowDown, "Backward", "down"],
              [ArrowDownToLine, "Send to back", "back"],
            ] as const
          ).map(([Icon, label, to]) => (
            <Button key={label} variant="ghost" size="icon" className="size-8" aria-label={label} title={label} onClick={() => commit(reorder(doc, selection, to))}>
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
      </Section>

      {one && (
        <Section title="Position">
          <div className="grid grid-cols-2 gap-1.5">
            <NumberField label="X" value={one.x} onChange={(x) => patch({ x }, "x")} />
            <NumberField label="Y" value={one.y} onChange={(y) => patch({ y }, "y")} />
            {one.type !== "floor" && (
              <>
                <NumberField
                  label="W"
                  value={one.w}
                  min={1}
                  onChange={(w) => patch(one.type === "prop" ? { w, h: w / PROP_ASPECT[(one as PropNode).prop] } : one.type === "seat" ? { w, h: w } : { w }, "w")}
                />
                <NumberField label="H" value={one.h} min={1} onChange={(h) => patch(one.type === "prop" ? { h, w: h * PROP_ASPECT[(one as PropNode).prop] } : one.type === "seat" ? { h, w: h } : { h }, "h")} />
                <NumberField label="°" value={one.rotation} min={-180} max={180} onChange={(rotation) => patch({ rotation }, "rotation")} />
              </>
            )}
          </div>
        </Section>
      )}

      <Section title="Appearance">
        <Row label="Opacity">
          <Slider min={0} max={100} step={1} value={[Math.round((one?.opacity ?? 1) * 100)]} onValueChange={([v]) => patch({ opacity: v / 100 }, "opacity")} />
        </Row>
      </Section>

      {one?.type === "shape" && <ShapeFields node={one} patch={patch} />}
      {one?.type === "text" && <TextFields node={one} patch={patch} />}
      {one?.type === "image" && (
        <Section title="Picture">
          <p className="truncate text-xs text-muted-foreground">{assets.get(one.assetId)?.name ?? "Missing"}</p>
          {doc.kind === "scene" && one.role !== "background" && onSetBackground && (
            <Button size="sm" variant="secondary" onClick={() => onSetBackground(one.assetId)}>
              <ImageIcon /> Use as the room
            </Button>
          )}
        </Section>
      )}
      {one?.type === "prop" && (
        <Section title="Prop">
          <Row label="Kind">
            <Select
              value={one.prop}
              onValueChange={(v) => {
                const kind = v as PropNode["prop"];
                patch({ prop: kind, h: one.w / PROP_ASPECT[kind], name: kind[0].toUpperCase() + kind.slice(1) } as Partial<Node>, "prop");
              }}
            >
              <SelectTrigger className="h-8 capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCENE_PROP_KINDS.map((k) => (
                  <SelectItem key={k} value={k} className="capitalize">
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <label className="flex items-center justify-between gap-2 text-sm">
            Anyone can switch it
            <Switch checked={one.interactive} onCheckedChange={(interactive) => patch({ interactive } as Partial<Node>, "interactive")} />
          </label>
          <label className="flex items-center justify-between gap-2 text-sm">
            Starts on
            <Switch checked={one.on} onCheckedChange={(on) => patch({ on } as Partial<Node>, "on")} />
          </label>
        </Section>
      )}
      {one?.type === "screen" && (
        <Section title="Screen">
          <p className="text-xs text-muted-foreground">Streams are shown here, fitted to the box. Keep it 16:9 for the best fit.</p>
          <Button size="sm" variant="secondary" onClick={() => patch({ h: (one.w * 9) / 16 }, "ratio")}>
            Make it 16:9
          </Button>
        </Section>
      )}
    </div>
  );
}

type Patcher = (p: Partial<Node> | ((n: Node) => Partial<Node>), key: string) => void;

function ShapeFields({ node, patch }: { node: ShapeNode; patch: Patcher }) {
  return (
    <Section title="Shape">
      <Row label="Fill">
        <ColourField value={node.fill} onChange={(fill) => patch({ fill } as Partial<Node>, "fill")} />
      </Row>
      <Row label="Stroke">
        <ColourField value={node.stroke} onChange={(stroke) => patch({ stroke } as Partial<Node>, "stroke")} />
      </Row>
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="Line" value={node.strokeWidth} min={0} max={80} onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Node>, "strokew")} />
        {node.shape === "rect" && <NumberField label="Round" value={node.radius} min={0} max={500} onChange={(radius) => patch({ radius } as Partial<Node>, "radius")} />}
      </div>
    </Section>
  );
}

function TextFields({ node, patch }: { node: TextNode; patch: Patcher }) {
  return (
    <Section title="Text">
      <Textarea value={node.text} maxLength={120} onChange={(e) => patch({ text: e.target.value } as Partial<Node>, "text")} className="min-h-16 text-sm" />
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="Size" value={node.fontSize} min={4} max={400} onChange={(fontSize) => patch({ fontSize } as Partial<Node>, "fsize")} />
        <NumberField label="Wt" value={node.fontWeight} min={100} max={900} step={100} onChange={(fontWeight) => patch({ fontWeight } as Partial<Node>, "fweight")} />
      </div>
      <div className="flex items-center gap-2">
        <Select value={node.align} onValueChange={(align) => patch({ align } as Partial<Node>, "align")}>
          <SelectTrigger className="h-8 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="left">Left</SelectItem>
            <SelectItem value="center">Centre</SelectItem>
            <SelectItem value="right">Right</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs">
          Italic
          <Switch checked={node.italic} onCheckedChange={(italic) => patch({ italic } as Partial<Node>, "italic")} />
        </label>
      </div>
      <Row label="Colour">
        <ColourField value={node.color} onChange={(color) => patch({ color } as Partial<Node>, "color")} />
      </Row>
      <Row label="Outline">
        <ColourField value={node.stroke} onChange={(stroke) => patch({ stroke } as Partial<Node>, "ostroke")} />
      </Row>
      <NumberField label="Outline width" value={node.strokeWidth} min={0} max={40} onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Node>, "ostrokew")} />
    </Section>
  );
}
