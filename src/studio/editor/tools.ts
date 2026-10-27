import { Armchair, Brush as BrushIcon, Circle, Hand, MousePointer, MousePointer2, Minus, PenTool, Pentagon, Slash, Square, Star, Tv, Type, ZoomIn, type LucideIcon } from "lucide-react";

import type { DocKind } from "@/studio/model/types";

/**
 * The tools of the canvas editor, laid out as Illustrator's are and bound to the
 * same keys: V Selection, A Direct Selection, P Pen, B Paintbrush, \ Line Segment, M Rectangle, L Ellipse, T Type,
 * H Hand, Z Zoom. (Polygon and Star have no key of their own, as in Illustrator.)
 *
 * This list is the one place a tool's key, name and explanation are written. The
 * toolbar draws its buttons from it, the keyboard handler looks keys up in it, and
 * the Explore guides read their tool reference from it — so what the guides say
 * cannot drift from what the keys do.
 */
export type Tool =
  | "select"
  | "direct"
  | "hand"
  | "zoom"
  | "pen"
  | "brush"
  | "line"
  | "rect"
  | "ellipse"
  | "polygon"
  | "star"
  | "text"
  | "screen"
  | "seat"
  | "floor"
  | `prop:${string}`;

export type ToolId = Exclude<Tool, `prop:${string}`>;

export interface ToolDef {
  id: ToolId;
  label: string;
  /** The single key that picks it, as Illustrator binds it. */
  key?: string;
  icon: LucideIcon;
  group: "navigate" | "draw" | "scene";
  /** Shown only for these kinds of design. */
  kinds?: DocKind[];
  /** What it is for, in a sentence — the toolbar's tooltip and the guides' tool reference. */
  hint: string;
  /** What the pointer does with it, step by step, for the guides. */
  how: string[];
}

export const TOOLS: ToolDef[] = [
  {
    id: "select",
    label: "Selection Tool",
    key: "V",
    icon: MousePointer2,
    group: "navigate",
    hint: "Select, move, resize and rotate objects.",
    how: [
      "Click an object to select it; Shift-click to add or remove one.",
      "Drag on empty space to select everything the box touches.",
      "Drag a handle to resize (Shift keeps proportions on shapes and text; pictures keep them by default). Drag the circle above the box to rotate; Shift snaps to 15°.",
      "Hold Alt while dragging to move a copy. Hold Shift to keep to one axis. Hold ⌘/Ctrl to turn snapping off.",
    ],
  },
  {
    id: "direct",
    label: "Direct Selection Tool",
    key: "A",
    icon: MousePointer,
    group: "navigate",
    hint: "Select and edit individual anchor points and handles of a path. On anything else it picks one object, even inside a group.",
    how: [
      "Click a path, then drag its anchor points to reshape it; drag a handle to change a curve. Alt-drag a handle moves it without its twin.",
      "Shift-click anchors to select several, and drag them together.",
      "Double-click an anchor to turn it from a corner into a smooth curve point and back. Double-click the outline between anchors to add one there.",
      "Press Delete to remove the selected anchors.",
      "Click an object inside a group to select just that object.",
    ],
  },
  {
    id: "hand",
    label: "Hand Tool",
    key: "H",
    icon: Hand,
    group: "navigate",
    hint: "Drag to pan the canvas. Double-click to fit the artboard.",
    how: ["Drag to move the view.", "Hold Space with any tool to pan without leaving it.", "Double-click the tool to fit the artboard in the window."],
  },
  {
    id: "zoom",
    label: "Zoom Tool",
    key: "Z",
    icon: ZoomIn,
    group: "navigate",
    hint: "Click to zoom in, Alt-click to zoom out, drag to zoom to an area. Double-click for 100%.",
    how: [
      "Click to zoom in around the point; Alt-click to zoom out.",
      "Drag a box to fill the window with that area.",
      "Double-click the tool to jump to 100%.",
    ],
  },
  {
    id: "pen",
    label: "Pen Tool",
    key: "P",
    icon: PenTool,
    group: "draw",
    hint: "Click to place corner points; click and drag to make a curve. Click the first point to close the path.",
    how: [
      "Click to add a corner point. Click and drag to add a smooth point and pull its curve handles out.",
      "Click the first point again to close the path. Press Enter, double-click, or pick another tool to leave it open.",
      "Press Backspace to take back the last point.",
      "Edit the result with the Direct Selection tool. Fill, stroke, gradients and effects are set in the panels like anything else.",
    ],
  },
  {
    id: "brush",
    label: "Paintbrush Tool",
    key: "B",
    icon: BrushIcon,
    group: "draw",
    hint: "Drag to paint a freehand stroke. Pick the brush — tapered, calligraphy, chalk, stars… — and its size in the bar above.",
    how: [
      "Drag to paint. The stroke is smoothed into a clean curve with a few anchors as you let go, so it can be edited afterwards with Direct Selection.",
      "Choose the brush and its size in the control bar. \"Round\" is a plain line; the others change how the stroke is drawn.",
      "A brush stroke takes the stroke paint like any outline: a colour, a gradient or a material such as wood or gold. Change the brush later in the Appearance panel.",
    ],
  },
  {
    id: "line",
    label: "Line Segment Tool",
    key: "\\",
    icon: Slash,
    group: "draw",
    hint: "Drag to draw a straight line. Hold Shift for 45° steps.",
    how: ["Drag from one end to the other. Shift keeps it to multiples of 45°.", "A line is a path: it has a stroke, and can have a gradient stroke, shadows and glows."],
  },
  {
    id: "rect",
    label: "Rectangle Tool",
    key: "M",
    icon: Square,
    group: "draw",
    hint: "Drag to draw a rectangle; click for a default one. Round the corners in the Inspector.",
    how: ["Drag to draw, or click to place a default-sized one.", "Set a corner radius and stroke in the Inspector."],
  },
  {
    id: "ellipse",
    label: "Ellipse Tool",
    key: "L",
    icon: Circle,
    group: "draw",
    hint: "Drag to draw an ellipse; click for a default one.",
    how: ["Drag to draw, or click to place a default-sized one."],
  },
  {
    id: "polygon",
    label: "Polygon Tool",
    icon: Pentagon,
    group: "draw",
    hint: "Drag a box for a regular polygon. Change the number of sides in the Inspector.",
    how: ["Drag to draw, or click for a default-sized one. It starts with six sides — change that in the Inspector until you touch its anchors."],
  },
  {
    id: "star",
    label: "Star Tool",
    icon: Star,
    group: "draw",
    hint: "Drag a box for a star. Change its points and depth in the Inspector.",
    how: ["Drag to draw, or click for a default-sized one. It starts with five points — change the points and how deep the valleys are in the Inspector until you touch its anchors."],
  },
  {
    id: "text",
    label: "Type Tool",
    key: "T",
    icon: Type,
    group: "draw",
    hint: "Click or drag to add text, then edit it in the Inspector.",
    how: ["Click to add a line, or drag to make a box.", "Style it in the Inspector: size, weight, alignment, colour and outline."],
  },
  {
    id: "screen",
    label: "Screen — where streams show",
    icon: Tv,
    group: "scene",
    kinds: ["scene"],
    hint: "Marks where the stream is shown in the room. A room has exactly one.",
    how: ["Drag the rectangle where the screen is in your picture.", "A room has one screen: using the tool again selects the existing one."],
  },
  {
    id: "seat",
    label: "Seat — click to place",
    icon: Armchair,
    group: "scene",
    kinds: ["scene"],
    hint: "Click to place a seat. A person's feet go at its centre.",
    how: ["Click each spot where somebody can sit (up to 24)."],
  },
  {
    id: "floor",
    label: "Floor line — where walking starts",
    icon: Minus,
    group: "scene",
    kinds: ["scene"],
    hint: "Click to set the line above which nobody can walk.",
    how: ["Click where the floor begins; drag it up or down afterwards."],
  },
];

export const toolDef = (id: ToolId) => TOOLS.find((t) => t.id === id)!;

/** The tool a bare key picks for this kind of design, if any. */
export function toolForKey(key: string, kind: DocKind): ToolId | undefined {
  const k = key.toUpperCase();
  return TOOLS.find((t) => t.key === k && (!t.kinds || t.kinds.includes(kind)))?.id;
}

/** A name for whatever tool is current, for the status bar. */
export function toolLabel(tool: Tool): string {
  if (tool.startsWith("prop:")) return `Prop — ${tool.slice(5)}`;
  return toolDef(tool as ToolId).label;
}
