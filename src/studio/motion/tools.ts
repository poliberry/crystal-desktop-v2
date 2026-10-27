/**
 * The animation editor's tools and keys, in one place, as the canvas editor's are in `editor/tools.ts`: the toolbar draws
 * its buttons from `MOTION_TOOLS`, the keyboard handler picks a tool by the `key` here, and the Explore guide prints
 * both tables, so what the guide says can't drift from what the keys do.
 */
export type MotionTool = "select" | "trim" | "position" | "range" | "blade" | "zoom" | "hand";

export const MOTION_TOOLS: { id: MotionTool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "Select", key: "A", hint: "Click clips to select them, drag to move, drag an edge to trim." },
  { id: "trim", label: "Trim", key: "T", hint: "Drag a clip's end to trim it and move what follows along with it; drag inside a clip to slip what it shows without moving it." },
  { id: "position", label: "Position", key: "P", hint: "Drag clips to move them freely, including onto other clips' lanes." },
  { id: "range", label: "Range Selection", key: "R", hint: "Drag across the timeline to mark a stretch to loop while you work." },
  { id: "blade", label: "Blade", key: "B", hint: "Click a clip to cut it at the pointer." },
  { id: "zoom", label: "Zoom", key: "Z", hint: "Click to zoom the timeline in; Alt-click to zoom out." },
  { id: "hand", label: "Hand", key: "H", hint: "Drag to scroll the timeline." },
];

/** Shortcuts as `mod+shift+k` (see editor/keys.ts), grouped for the guide. */
export const MOTION_KEYS: { group: string; rows: [string, string][] }[] = [
  {
    group: "Playing",
    rows: [
      ["Play / pause", "Space"],
      ["Stop", "k"],
      ["Play forwards, faster each press", "l"],
      ["Play backwards, faster each press", "j"],
      ["Back / forward one frame (← →)", "←"],
      ["Back / forward ten frames", "shift+←"],
      ["Previous / next edit (↑ ↓)", "↑"],
      ["Go to the start / end (Home, End)", "Home"],
    ],
  },
  {
    group: "Editing",
    rows: [
      ["Split at the playhead", "mod+b"],
      ["Delete", "⌫"],
      ["Delete and close the gap", "shift+⌫"],
      ["Duplicate", "mod+d"],
      ["Copy / paste", "mod+c"],
      ["Select all", "mod+a"],
      ["Group into a compound clip", "mod+g"],
      ["Open a compound clip back out", "mod+shift+g"],
      ["Open the selected compound clip", "Enter"],
      ["Close it / deselect", "Esc"],
      ["Undo", "mod+z"],
      ["Redo", "mod+shift+z"],
    ],
  },
  {
    group: "Timeline",
    rows: [
      ["Snapping on / off", "n"],
      ["Auto-key on / off", "alt+k"],
      ["Zoom in", "mod+="],
      ["Zoom out", "mod+-"],
    ],
  },
];
