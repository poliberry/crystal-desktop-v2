"use client";

import { useCallback, useState } from "react";

import { BRUSH_TYPES } from "@/studio/model/brush";
import type { BrushType, DocKind } from "@/studio/model/types";

/**
 * How the canvas is looked at, as opposed to what is on it: the View menu's
 * toggles. They belong to the person, not the design, so they are remembered
 * across projects (as Illustrator remembers them) and never saved in a file.
 */
export interface ViewPrefs {
  rulers: boolean;
  grid: boolean;
  /** Grid spacing in document units; null means the default for the kind of design. */
  gridSize: number | null;
  /** Snap to the artboard and to other objects, drawing a line where they meet. */
  smartGuides: boolean;
  snapGrid: boolean;
  showGuides: boolean;
  lockGuides: boolean;
  /** Draw every object as an outline only. */
  outline: boolean;
  /** Options of the Polygon and Star tools: what the next one drawn is made with. */
  polygonSides: number;
  starPoints: number;
  starInner: number;
  /** Options of the Paintbrush: "round" is a plain line; the rest are brushes (model/brush.ts). */
  brushType: BrushType | "round";
  brushSize: number;
  brushColor: string;
}

export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  rulers: true,
  grid: false,
  gridSize: null,
  smartGuides: true,
  snapGrid: false,
  showGuides: true,
  lockGuides: false,
  outline: false,
  polygonSides: 6,
  starPoints: 5,
  starInner: 0.5,
  brushType: "round",
  brushSize: 8,
  brushColor: "#ffffff",
};

const KEY = "crystal-studio-view";

/** A grid that suits the artboard: a 1600-wide room wants a coarser one than a 400-wide avatar. */
export const defaultGridSize = (kind: DocKind) => (kind === "scene" ? 50 : 10);

function read(): ViewPrefs {
  if (typeof window === "undefined") return DEFAULT_VIEW_PREFS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<ViewPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT_VIEW_PREFS;
    const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const size = typeof raw.gridSize === "number" && Number.isFinite(raw.gridSize) && raw.gridSize >= 1 && raw.gridSize <= 1000 ? raw.gridSize : null;
    const range = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);
    const d = DEFAULT_VIEW_PREFS;
    return {
      rulers: bool(raw.rulers, d.rulers),
      grid: bool(raw.grid, d.grid),
      gridSize: size,
      smartGuides: bool(raw.smartGuides, d.smartGuides),
      snapGrid: bool(raw.snapGrid, d.snapGrid),
      showGuides: bool(raw.showGuides, d.showGuides),
      lockGuides: bool(raw.lockGuides, d.lockGuides),
      outline: bool(raw.outline, d.outline),
      polygonSides: Math.round(range(raw.polygonSides, 3, 60, d.polygonSides)),
      starPoints: Math.round(range(raw.starPoints, 3, 40, d.starPoints)),
      starInner: range(raw.starInner, 0.05, 0.95, d.starInner),
      brushType: raw.brushType === "round" || BRUSH_TYPES.includes(raw.brushType as BrushType) ? (raw.brushType as ViewPrefs["brushType"]) : d.brushType,
      brushSize: range(raw.brushSize, 1, 200, d.brushSize),
      brushColor: typeof raw.brushColor === "string" && /^#[0-9a-f]{6}$/i.test(raw.brushColor) ? raw.brushColor : d.brushColor,
    };
  } catch {
    return DEFAULT_VIEW_PREFS;
  }
}

export function useViewPrefs() {
  const [prefs, setState] = useState<ViewPrefs>(read);
  const setPrefs = useCallback((patch: Partial<ViewPrefs> | ((p: ViewPrefs) => Partial<ViewPrefs>)) => {
    setState((cur) => {
      const next = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // A full or blocked store only means the choice isn't remembered.
      }
      return next;
    });
  }, []);
  return [prefs, setPrefs] as const;
}

export type SetViewPrefs = ReturnType<typeof useViewPrefs>[1];
