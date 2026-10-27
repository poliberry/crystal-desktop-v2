"use client";

import { Flame } from "lucide-react";

import { SCENE_PROP_KINDS } from "../../../convex/lib/creationSpecs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Swatch } from "@/studio/editor/swatch";
import { TOOLS, type Tool, type ToolDef } from "@/studio/editor/tools";
import type { ViewCommands } from "@/studio/editor/view-menu";
import { hasPaint } from "@/studio/model/doc";
import type { DocKind, Node } from "@/studio/model/types";
import { cn } from "@/lib/utils";

function ToolButton({ def, active, onClick, onDoubleClick }: { def: ToolDef; active: boolean; onClick: () => void; onDoubleClick?: () => void }) {
  const Icon = def.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="ai-tool" onClick={onClick} onDoubleClick={onDoubleClick} aria-pressed={active} aria-label={def.label} aria-keyshortcuts={def.key}>
          <Icon className="size-4" strokeWidth={1.5} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-56">
        <p>
          {def.label}
          {def.key && <span className="ml-2 text-muted-foreground">({def.key})</span>}
        </p>
        <p className="mt-0.5 text-[11px] font-normal text-muted-foreground">{def.hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** The dotted strip across the top of the toolbar, which Illustrator drags it by. */
export function Grip({ className }: { className?: string }) {
  return <div aria-hidden className={cn("h-[3px] w-6 shrink-0 opacity-50", className)} style={{ backgroundImage: "radial-gradient(circle, currentColor 0.7px, transparent 0.8px)", backgroundSize: "3px 3px" }} />;
}

/** The paint a node is drawn with, for the fill and stroke boxes. Undefined where it has none. */
export function paintOf(node: Node | null): { fill: string | null; stroke: string | null } {
  if (!node) return { fill: null, stroke: null };
  if (node.type === "shape") return { fill: node.fill, stroke: node.strokeWidth > 0 ? node.stroke : null };
  if (node.type === "path") return { fill: node.fill === "none" ? null : node.fill, stroke: node.strokeWidth > 0 ? node.stroke : null };
  if (node.type === "text") return { fill: node.color, stroke: node.strokeWidth > 0 ? node.stroke : null };
  return { fill: null, stroke: null };
}

/**
 * Fill and stroke, overlapped, as the toolbar and control bar show them: the fill box in front at
 * the top left, the stroke box behind it at the lower right, drawn as a ring. A red slash means none.
 */
function FillStroke({ node, onFill, onStroke }: { node: Node | null; onFill: (c: string) => void; onStroke: (c: string) => void }) {
  const { fill, stroke } = paintOf(node);
  const editable = hasPaint(node);
  return (
    <div className="relative mx-auto size-[34px]" title={editable ? "Fill (front) and stroke (behind)" : "Select a shape or text to set its fill and stroke"}>
      <div className="absolute top-[11px] left-[11px]">
        <Swatch value={stroke} onChange={onStroke} disabled={!editable} ring size={22} label="Stroke colour" />
      </div>
      <div className="absolute top-0 left-0">
        <Swatch value={fill} onChange={onFill} disabled={!editable} size={22} label="Fill colour" />
      </div>
    </div>
  );
}

/**
 * The toolbar: one 40px column, tools on a 24px pitch, the dotted grip above and the fill and stroke
 * widget below. Double-clicking the Hand fits the artboard and the Zoom goes to 100%, as in Illustrator.
 */
export function Toolbar({
  kind,
  tool,
  setTool,
  commands,
  selected,
  onFill,
  onStroke,
}: {
  kind: DocKind;
  tool: Tool;
  setTool: (t: Tool) => void;
  commands: React.RefObject<ViewCommands | null>;
  selected: Node | null;
  onFill: (c: string) => void;
  onStroke: (c: string) => void;
}) {
  const isProp = typeof tool === "string" && tool.startsWith("prop:");
  const visible = TOOLS.filter((t) => !t.kinds || t.kinds.includes(kind));
  const groups = (["navigate", "draw", "scene"] as const).map((g) => visible.filter((t) => t.group === g)).filter((g) => g.length > 0);
  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex w-10 shrink-0 flex-col items-center bg-[var(--ai-body)] ai-edge-r" style={{ borderColor: "var(--ai-edge)" }}>
        <div className="flex h-[14px] w-full items-center justify-center bg-[var(--ai-header)] text-[var(--ai-dim)]">
          <Grip />
        </div>
        <div className="flex w-full flex-1 flex-col items-center gap-px overflow-y-auto py-1.5">
          {groups.map((group, i) => (
            <div key={group[0].group} className="flex flex-col items-center gap-px">
              {i > 0 && <div className="my-1 h-px w-7 bg-[var(--ai-edge)]" />}
              {group.map((def) => (
                <ToolButton
                  key={def.id}
                  def={def}
                  active={tool === def.id}
                  onClick={() => setTool(def.id)}
                  onDoubleClick={def.id === "hand" ? () => commands.current?.fit() : def.id === "zoom" ? () => commands.current?.actualSize() : undefined}
                />
              ))}
              {group[0].group === "scene" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label="Props" data-active={isProp} data-group="true" className="ai-tool">
                      <Flame className="size-4" strokeWidth={1.5} />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-44 p-1">
                    <p className="px-2 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Props</p>
                    {SCENE_PROP_KINDS.map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setTool(`prop:${p}`)}
                        className={cn("flex w-full items-center rounded-[2px] px-2 py-1 text-left text-[11px] capitalize hover:bg-accent", tool === `prop:${p}` && "bg-accent")}
                      >
                        {p}
                      </button>
                    ))}
                    <p className="px-2 pt-1 text-[10px] text-muted-foreground">Pick one, then click the room.</p>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          ))}
        </div>
        <div className="my-1 h-px w-7 bg-[var(--ai-edge)]" />
        <div className="flex w-full flex-col items-stretch gap-1.5 pb-2">
          <FillStroke node={selected} onFill={onFill} onStroke={onStroke} />
        </div>
      </div>
    </TooltipProvider>
  );
}
