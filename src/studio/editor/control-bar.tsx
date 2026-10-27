"use client";

import { BRUSH_LABEL, BRUSH_TYPES } from "@/studio/model/brush";
import { AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, Redo2, Undo2 } from "lucide-react";

import { PROP_ASPECT } from "@/components/lounge/lounge-props";
import { NumberField } from "@/studio/editor/fields";
import { keyLabel } from "@/studio/editor/keys";
import { Grip, paintOf } from "@/studio/editor/toolbar";
import { Swatch } from "@/studio/editor/swatch";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { boundsOf, hasPaint, patchNodes, round, unionBounds } from "@/studio/model/doc";
import type { SetViewPrefs, ViewPrefs } from "@/studio/editor/view-prefs";
import type { Node, PropNode } from "@/studio/model/types";

const TYPE_LABEL: Record<Node["type"], string> = {
  image: "Picture",
  shape: "Shape",
  text: "Type",
  path: "Path",
  screen: "Screen",
  seat: "Seat",
  prop: "Prop",
  floor: "Floor line",
};

function nameOf(n: Node): string {
  if (n.type === "shape") return n.shape === "ellipse" ? "Ellipse" : "Rectangle";
  if (n.type === "path") return n.points.some((p) => p.m) ? "Compound Path" : n.live?.kind === "star" ? "Star" : n.live?.kind === "polygon" ? "Polygon" : n.points.length === 2 && !n.closed ? "Line" : "Path";
  return TYPE_LABEL[n.type];
}

/** A thin vertical rule between groups of controls. */
const Sep = () => <div aria-hidden className="mx-1.5 h-[18px] w-px shrink-0 bg-[var(--ai-edge)]" />;

/**
 * The control bar under the menu: what you can change about whatever is selected, in one row, in
 * Illustrator's order — what it is, its fill and stroke, the stroke weight, opacity, then where it
 * is and how big, then align. With nothing selected it says so and offers the document's own settings.
 */
export function ControlBar({ editor, prefs, setPrefs, onDocSetup, right }: { editor: DocEditor; prefs: ViewPrefs; setPrefs: SetViewPrefs; onDocSetup: () => void; right?: React.ReactNode }) {
  const { doc, selection, commit } = editor;
  const nodes = selection.map((id) => doc.nodes[id]).filter(Boolean) as Node[];
  const one = nodes.length === 1 ? nodes[0] : null;
  const first = nodes[0] ?? null;
  const { fill, stroke } = paintOf(one);
  const styled = hasPaint(one);
  const patch = (p: Partial<Node> | ((n: Node) => Partial<Node>), key: string) => commit(patchNodes(editor.doc, selection, p), key);
  const box = unionBounds(nodes);

  const align = (axis: "x" | "y", where: "start" | "centre" | "end") => {
    const frame = one ? { x: 0, y: 0, w: doc.artboard.w, h: doc.artboard.h } : box!;
    commit(
      patchNodes(doc, selection, (n) => {
        const b = boundsOf(n);
        if (axis === "x") return { x: round(n.x + ((where === "start" ? frame.x : where === "centre" ? frame.x + (frame.w - b.w) / 2 : frame.x + frame.w - b.w) - b.x)) };
        return { y: round(n.y + ((where === "start" ? frame.y : where === "centre" ? frame.y + (frame.h - b.h) / 2 : frame.y + frame.h - b.h) - b.y)) };
      }),
    );
  };

  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 overflow-hidden ai-edge-b bg-[var(--ai-body)] pr-2 text-[11px]">
      <div className="flex h-full w-3 shrink-0 items-center justify-center text-[var(--ai-dim)]" style={{ writingMode: "vertical-rl" }}>
        <Grip className="h-5 w-[3px]" />
      </div>

      <span className="min-w-[68px] truncate text-[var(--ai-text)]">{editor.tool === "polygon" ? "Polygon Tool" : editor.tool === "star" ? "Star Tool" : editor.tool === "pen" ? "Pen Tool" : editor.tool === "brush" ? "Paintbrush Tool" : nodes.length === 0 ? "No Selection" : one ? nameOf(one) : `${nodes.length} Objects`}</span>
      <Sep />

      {/* Options of the tool in hand: what the next polygon or star is drawn with. */}
      {editor.tool === "polygon" && (
        <>
          <span className="text-[var(--ai-dim)]">Sides:</span>
          <NumberField className="w-[60px]" min={3} max={60} value={prefs.polygonSides} title="Number of sides of the next polygon" onChange={(v) => setPrefs({ polygonSides: Math.round(v) })} />
          <Sep />
        </>
      )}
      {editor.tool === "star" && (
        <>
          <span className="text-[var(--ai-dim)]">Points:</span>
          <NumberField className="w-[60px]" min={3} max={40} value={prefs.starPoints} title="Number of points of the next star" onChange={(v) => setPrefs({ starPoints: Math.round(v) })} />
          <span className="text-[var(--ai-dim)]">Depth:</span>
          <NumberField className="w-[68px]" min={5} max={95} suffix="%" value={Math.round(prefs.starInner * 100)} title="How deep the valleys between the points are" onChange={(v) => setPrefs({ starInner: v / 100 })} />
          <Sep />
        </>
      )}
      {editor.tool === "brush" && (
        <>
          <span className="text-[var(--ai-dim)]">Brush:</span>
          <select
            aria-label="Brush"
            value={prefs.brushType}
            onChange={(e) => setPrefs({ brushType: e.target.value as ViewPrefs["brushType"] })}
            className="h-5 rounded-[3px] border border-input bg-background/60 px-1 text-[11px] text-foreground outline-none"
          >
            <option value="round">Round</option>
            {BRUSH_TYPES.map((t) => (
              <option key={t} value={t}>{BRUSH_LABEL[t]}</option>
            ))}
          </select>
          <span className="text-[var(--ai-dim)]">Size:</span>
          <NumberField className="w-[60px]" min={1} max={200} value={prefs.brushSize} title="Size of the next stroke" onChange={(v) => setPrefs({ brushSize: v })} />
          <Swatch value={prefs.brushColor} size={20} label="Brush colour" onChange={(c) => setPrefs({ brushColor: c })} />
          <Sep />
        </>
      )}
      {editor.tool === "pen" && (
        <>
          <span className="text-[var(--ai-dim)]">Click for corners, drag for curves · Enter to finish · click the first point to close</span>
          <Sep />
        </>
      )}

      <Swatch value={fill} disabled={!styled} size={20} label="Fill colour" onChange={(c) => patch(one?.type === "text" ? ({ color: c } as Partial<Node>) : ({ fill: c } as Partial<Node>), "fill")} />
      <Swatch value={stroke} disabled={!styled} ring size={20} label="Stroke colour" onChange={(c) => patch({ stroke: c } as Partial<Node>, "stroke")} />
      <span className="ai-link ml-1 text-[var(--ai-text)]">{one?.type === "text" ? "Outline:" : "Stroke:"}</span>
      <NumberField
        className="w-[56px]"
        disabled={!styled}
        min={0}
        max={80}
        value={hasPaint(one) ? one.strokeWidth : 0}
        suffix="pt"
        title="Stroke weight"
        onChange={(strokeWidth) => patch({ strokeWidth } as Partial<Node>, "strokew")}
      />
      <Sep />

      <span className="ai-link text-[var(--ai-text)]">Opacity:</span>
      <NumberField className="w-[60px]" disabled={!first} min={0} max={100} value={Math.round((first?.opacity ?? 1) * 100)} suffix="%" title="Opacity" onChange={(v) => patch({ opacity: v / 100 }, "opacity")} />

      {one && one.type !== "floor" && (
        <>
          <Sep />
          <NumberField className="w-[72px]" label="X" value={one.x} onChange={(x) => patch({ x }, "x")} />
          <NumberField className="w-[72px]" label="Y" value={one.y} onChange={(y) => patch({ y }, "y")} />
          <NumberField
            className="w-[72px]"
            label="W"
            value={one.w}
            min={1}
            onChange={(w) => patch(one.type === "prop" ? { w, h: w / PROP_ASPECT[(one as PropNode).prop] } : one.type === "seat" ? { w, h: w } : { w }, "w")}
          />
          <NumberField
            className="w-[72px]"
            label="H"
            value={one.h}
            min={1}
            onChange={(h) => patch(one.type === "prop" ? { h, w: h * PROP_ASPECT[(one as PropNode).prop] } : one.type === "seat" ? { h, w: h } : { h }, "h")}
          />
          <NumberField className="w-[64px]" label="°" value={one.rotation} min={-180} max={180} title="Rotation" onChange={(rotation) => patch({ rotation }, "rotation")} />
        </>
      )}

      {nodes.length > 0 && (
        <>
          <Sep />
          {(
            [
              [AlignStartHorizontal, "Align left", () => align("x", "start")],
              [AlignCenterHorizontal, "Align horizontal centres", () => align("x", "centre")],
              [AlignEndHorizontal, "Align right", () => align("x", "end")],
              [AlignStartVertical, "Align top", () => align("y", "start")],
              [AlignCenterVertical, "Align vertical centres", () => align("y", "centre")],
              [AlignEndVertical, "Align bottom", () => align("y", "end")],
            ] as const
          ).map(([Icon, label, run]) => (
            <button key={label} type="button" className="ai-tool !w-6" aria-label={label} title={label} onClick={run}>
              <Icon className="size-3.5" strokeWidth={1.5} />
            </button>
          ))}
        </>
      )}

      {nodes.length === 0 && (
        <>
          <Sep />
          <button type="button" className="ai-button" onClick={onDocSetup}>
            Document Setup
          </button>
          <span className="text-[var(--ai-dim)]">
            {doc.artboard.w} × {doc.artboard.h}
          </span>
        </>
      )}

      <div className="ml-auto flex items-center gap-0.5">
        <button type="button" className="ai-tool !w-6" disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo" title={`Undo (${keyLabel("mod+z")})`}>
          <Undo2 className="size-3.5" strokeWidth={1.5} />
        </button>
        <button type="button" className="ai-tool !w-6" disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo" title={`Redo (${keyLabel("mod+shift+z")})`}>
          <Redo2 className="size-3.5" strokeWidth={1.5} />
        </button>
        {right}
      </div>
    </div>
  );
}
