"use client";

import { Armchair, Circle, Flame, Hand, MousePointer2, Square, Tv, Type, Minus } from "lucide-react";

import { SCENE_PROP_KINDS } from "../../../convex/lib/creationSpecs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Tool } from "@/studio/editor/use-doc-editor";
import type { DocKind } from "@/studio/model/types";
import { cn } from "@/lib/utils";

function ToolButton({ active, label, shortcut, onClick, children }: { active: boolean; label: string; shortcut?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          aria-label={label}
          className={cn(
            "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

/** The tools down the left of the canvas. A scene gets the room's objects as well. */
export function Toolbar({ kind, tool, setTool }: { kind: DocKind; tool: Tool; setTool: (t: Tool) => void }) {
  const isProp = typeof tool === "string" && tool.startsWith("prop:");
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/60 bg-card/40 py-2">
        <ToolButton active={tool === "select"} label="Select" shortcut="V" onClick={() => setTool("select")}>
          <MousePointer2 className="size-4" />
        </ToolButton>
        <ToolButton active={tool === "hand"} label="Hand — drag to pan" shortcut="H" onClick={() => setTool("hand")}>
          <Hand className="size-4" />
        </ToolButton>
        <div className="my-1 h-px w-6 bg-border" />
        <ToolButton active={tool === "rect"} label="Rectangle" shortcut="R" onClick={() => setTool("rect")}>
          <Square className="size-4" />
        </ToolButton>
        <ToolButton active={tool === "ellipse"} label="Ellipse" shortcut="O" onClick={() => setTool("ellipse")}>
          <Circle className="size-4" />
        </ToolButton>
        <ToolButton active={tool === "text"} label="Text" shortcut="T" onClick={() => setTool("text")}>
          <Type className="size-4" />
        </ToolButton>
        {kind === "scene" && (
          <>
            <div className="my-1 h-px w-6 bg-border" />
            <ToolButton active={tool === "screen"} label="Screen — where streams show" onClick={() => setTool("screen")}>
              <Tv className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "seat"} label="Seat — click to place" onClick={() => setTool("seat")}>
              <Armchair className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "floor"} label="Floor line — where walking starts" onClick={() => setTool("floor")}>
              <Minus className="size-4" />
            </ToolButton>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Props"
                  className={cn(
                    "flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                    isProp && "bg-primary/15 text-primary",
                  )}
                >
                  <Flame className="size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="right" align="start" className="w-48 p-1.5">
                <p className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Props</p>
                {SCENE_PROP_KINDS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTool(`prop:${p}`)}
                    className={cn("flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm capitalize hover:bg-accent", tool === `prop:${p}` && "bg-primary/10 text-primary")}
                  >
                    {p}
                  </button>
                ))}
                <p className="px-2 pt-1.5 text-[11px] text-muted-foreground">Pick one, then click the room.</p>
              </PopoverContent>
            </Popover>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
