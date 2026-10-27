"use client";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { keyLabel } from "@/studio/editor/keys";
import { defaultGridSize, type SetViewPrefs, type ViewPrefs } from "@/studio/editor/view-prefs";
import type { DocKind } from "@/studio/model/types";

/** What the View menu can ask the canvas to do to its own view. Filled in by the canvas. */
export interface ViewCommands {
  fit(): void;
  actualSize(): void;
  zoomIn(): void;
  zoomOut(): void;
  /** Set the zoom (1 = 100%), keeping the middle of the window where it is. */
  setZoom(z: number): void;
}

/**
 * The shortcut for each View toggle, written once. The canvas's keyboard handler
 * matches the same combos, and the Explore guides list them — so a key changes
 * in one place.
 */
export const VIEW_KEYS = {
  rulers: "mod+r",
  showGuides: "mod+;",
  lockGuides: "mod+alt+;",
  grid: "mod+'",
  snapGrid: "mod+shift+'",
  smartGuides: "mod+u",
  outline: "mod+y",
  fit: "mod+0",
  actualSize: "mod+1",
  zoomIn: "mod++",
  zoomOut: "mod+-",
} as const;

/** The items of the View menu: what is drawn around the artwork and what the artwork snaps to. */
export function ViewMenuItems({
  kind,
  prefs,
  setPrefs,
  guideCount,
  onClearGuides,
  commands,
}: {
  kind: DocKind;
  prefs: ViewPrefs;
  setPrefs: SetViewPrefs;
  guideCount: number;
  onClearGuides: () => void;
  commands: React.RefObject<ViewCommands | null>;
}) {
  const gridSize = prefs.gridSize ?? defaultGridSize(kind);
  const toggle = (label: string, key: keyof typeof VIEW_KEYS, on: boolean, set: (v: boolean) => void) => (
    <DropdownMenuCheckboxItem checked={on} onCheckedChange={set}>
      {label}
      <DropdownMenuShortcut>{keyLabel(VIEW_KEYS[key])}</DropdownMenuShortcut>
    </DropdownMenuCheckboxItem>
  );
  return (
    <>
      {toggle("Rulers", "rulers", prefs.rulers, (v) => setPrefs({ rulers: v }))}
      {toggle("Outline", "outline", prefs.outline, (v) => setPrefs({ outline: v }))}
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] text-muted-foreground">Guides</DropdownMenuLabel>
      {toggle("Show guides", "showGuides", prefs.showGuides, (v) => setPrefs({ showGuides: v }))}
      {toggle("Lock guides", "lockGuides", prefs.lockGuides, (v) => setPrefs({ lockGuides: v }))}
      <DropdownMenuItem disabled={guideCount === 0} onSelect={onClearGuides}>
        Clear guides{guideCount ? ` (${guideCount})` : ""}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] text-muted-foreground">Grid and snapping</DropdownMenuLabel>
      {toggle("Show grid", "grid", prefs.grid, (v) => setPrefs({ grid: v }))}
      {toggle("Snap to grid", "snapGrid", prefs.snapGrid, (v) => setPrefs({ snapGrid: v }))}
      {toggle("Smart guides", "smartGuides", prefs.smartGuides, (v) => setPrefs({ smartGuides: v }))}
      <div className="flex items-center justify-between px-2 py-1.5 text-sm" onKeyDown={(e) => e.stopPropagation()}>
        <label htmlFor="studio-grid-size">Grid spacing</label>
        <input
          id="studio-grid-size"
          type="number"
          min={1}
          max={1000}
          step={1}
          value={gridSize}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n) && n >= 1 && n <= 1000) setPrefs({ gridSize: n });
          }}
          className="h-7 w-20 rounded-md border border-input bg-transparent px-2 text-right text-xs tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => commands.current?.fit()}>
        Fit artboard in window<DropdownMenuShortcut>{keyLabel(VIEW_KEYS.fit)}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => commands.current?.actualSize()}>
        Actual size<DropdownMenuShortcut>{keyLabel(VIEW_KEYS.actualSize)}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => commands.current?.zoomIn()}>
        Zoom in<DropdownMenuShortcut>{keyLabel(VIEW_KEYS.zoomIn)}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => commands.current?.zoomOut()}>
        Zoom out<DropdownMenuShortcut>{keyLabel(VIEW_KEYS.zoomOut)}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}
