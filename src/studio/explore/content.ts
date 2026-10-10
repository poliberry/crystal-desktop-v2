import { MAX_LAYERS } from "@/lib/cosmetic-layers";
import { SCENE_LIMITS, SCENE_PROP_KINDS } from "../../../convex/lib/creationSpecs";
import { VIEW_KEYS } from "@/studio/editor/view-menu";
import { TOOLS } from "@/studio/editor/tools";
import { DECORATION_MARGIN, STICKER_MAX_WIDTH } from "@/studio/model/compile";
import { SHADER_LABEL } from "@/studio/model/fx";
import { BRUSH_LABEL, BRUSH_USES } from "@/studio/model/brush";
import { MATERIAL_LABEL, MATERIAL_PRESETS, PRESET_GROUPS } from "@/studio/model/material";
import { EASE_PRESETS, MOTION_LIMITS, MOTION_STAGES, BLEND_MODES, TEXT_ANIMS } from "../../../convex/lib/motion";
import { MAX_MOTION_BYTES } from "../../../convex/lib/motionAddress";
import { MOTION_KEYS, MOTION_TOOLS } from "@/studio/motion/tools";
import { EFFECTS, GENERATORS, TITLES, TRANSITIONS } from "@/studio/motion/library";

/**
 * What the Explore tab says. Plain data, so it can be searched, and so the facts in it come from the
 * code that enforces them: the tool list and keys are `TOOLS`, the view shortcuts are `VIEW_KEYS`, the
 * limits are the ones `compile.ts` and the server check, and the effects are the shaders there are. A
 * key or limit that changes there changes here, without anyone remembering to edit prose.
 *
 * Shortcuts are written once as `mod+shift+k` (see keys.ts) and shown the way the platform writes them.
 */

export type Block =
  | { t: "p"; text: string }
  | { t: "h"; text: string }
  | { t: "steps"; items: string[] }
  | { t: "list"; items: string[] }
  | { t: "tip"; text: string }
  | { t: "warn"; text: string }
  | { t: "keys"; rows: [string, string][] }
  | { t: "tools" }
  | { t: "try"; kind: "decoration" | "sticker" | "scene" | "nameplate" | "effect"; label: string };

export interface Topic {
  id: string;
  group: "Canvas editor" | "Making things" | "Code editor";
  title: string;
  summary: string;
  blocks: Block[];
}

const k = (name: keyof typeof VIEW_KEYS) => VIEW_KEYS[name];

export const TOPICS: Topic[] = [
  {
    id: "start",
    group: "Canvas editor",
    title: "The workspace",
    summary: "Where everything is in the canvas editor.",
    blocks: [
      { t: "p", text: "The canvas editor is laid out like Illustrator's workspace. Decorations, stickers and lounge scenes all use it." },
      {
        t: "list",
        items: [
          "Menu bar — in Studio's title bar: File, Edit, Object, Type, Select, Effect, View, Window, Help. Every item shows its shortcut.",
          "Control bar — under the menu bar. It shows what is selected and its fill, stroke, opacity, position, size, rotation and align buttons. With nothing selected it shows the artboard size.",
          "Toolbar — down the left, one column, with the fill and stroke boxes at the bottom.",
          "Canvas — your artboard on the pasteboard, with rulers along the top and left.",
          "Status bar — zoom (type a value or pick one), artboard size, pointer position, the current tool, and how many problems the design has.",
          "Dock — on the right: Color and Swatches, Properties and Appearance, Layers and Assets, and Problems / Preview / Submit at the bottom. The strip of icons beside it shows or hides each panel; Window in the menu bar does the same.",
        ],
      },
      { t: "tip", text: "Colours follow your Crystal theme, so the editor stays in step with whichever theme you have chosen." },
      { t: "h", text: "What a design is made of" },
      { t: "p", text: "Pictures, rectangles, ellipses, text, and vector paths (made with the Pen, Paintbrush, Line, Polygon and Star tools). Any of them can have gradients, materials such as wood or gold, shadows, glows and shaders; paths and anything with effects are sent as pictures. Decorations, stickers, lounge scenes, nameplates and profile effects all use this editor." },
      { t: "p", text: "Not yet: Divide/Trim pathfinders, and blend modes in a cosmetic (the timeline editor for nameplates and profile effects has them). Text and pictures can't be combined into paths (there is no Create Outlines)." },
      { t: "try", kind: "decoration", label: "Start a practice decoration" },
    ],
  },
  {
    id: "tools",
    group: "Canvas editor",
    title: "Tools",
    summary: "Every tool, its key, and what the pointer does with it.",
    blocks: [
      { t: "p", text: "Tools are picked from the toolbar or by pressing their key, as in Illustrator. Escape goes back to the Selection tool." },
      { t: "tools" },
      { t: "tip", text: "Hold Space with any tool to pan without leaving it. Hold Alt while dragging to move a copy." },
    ],
  },
  {
    id: "view",
    group: "Canvas editor",
    title: "Rulers, guides, grid and snapping",
    summary: "Measure, line things up, and make them snap.",
    blocks: [
      { t: "h", text: "Rulers and guides" },
      {
        t: "steps",
        items: [
          "Turn rulers on with View ▸ Rulers. Zero is the artboard's top-left corner, and the numbers are the design's own units.",
          "Drag from the top ruler for a horizontal guide, from the left ruler for a vertical one.",
          "Drag a guide to move it. Drag it back onto its ruler to delete it, or click it and press Delete.",
          "Guides are saved with the design but never sent to the Marketplace. View ▸ Lock guides stops them being picked up by accident; View ▸ Clear guides removes them all.",
        ],
      },
      { t: "h", text: "Grid and snapping" },
      {
        t: "list",
        items: [
          "Smart guides: while you drag, edges and centres snap to the artboard and to other objects, and a pink line shows what they met.",
          "Snap to grid: also snaps to the grid. Set the spacing in the View menu.",
          "Guides snap too, while guides are showing.",
          "Hold ⌘ (Ctrl on Windows) while dragging to turn all snapping off for that drag.",
        ],
      },
      { t: "h", text: "Outline view" },
      { t: "p", text: "View ▸ Outline draws every object as just its outline, which is the quickest way to find something hidden behind something else." },
      {
        t: "keys",
        rows: [
          ["Rulers", k("rulers")],
          ["Show / hide guides", k("showGuides")],
          ["Lock guides", k("lockGuides")],
          ["Show grid", k("grid")],
          ["Snap to grid", k("snapGrid")],
          ["Smart guides", k("smartGuides")],
          ["Outline", k("outline")],
        ],
      },
    ],
  },
  {
    id: "zoom",
    group: "Canvas editor",
    title: "Zooming and panning",
    summary: "Get around a large canvas quickly.",
    blocks: [
      {
        t: "keys",
        rows: [
          ["Fit artboard in window", k("fit")],
          ["Actual size (100%)", k("actualSize")],
          ["Zoom in", k("zoomIn")],
          ["Zoom out", k("zoomOut")],
        ],
      },
      {
        t: "list",
        items: [
          "Zoom tool (Z): click to zoom in around the point, Alt-click to zoom out, drag a box to fill the window with it.",
          "Scroll to pan. Hold ⌘ (Ctrl) and scroll — or pinch on a trackpad — to zoom around the pointer.",
          "Hand tool (H), the middle mouse button, or holding Space pans by dragging.",
          "Double-click the Hand to fit the artboard; double-click the Zoom tool for 100%.",
          "Type a zoom into the status bar, or pick one from the menu beside it.",
        ],
      },
    ],
  },
  {
    id: "selecting",
    group: "Canvas editor",
    title: "Selecting and arranging",
    summary: "Move, resize, align, stack, lock and hide.",
    blocks: [
      {
        t: "list",
        items: [
          "Click to select; Shift-click to add or remove. Drag on empty space to select everything the box touches.",
          "Drag a handle to resize. Pictures keep their proportions; shapes and text keep them while Shift is held. Drag the circle above the box to rotate — Shift snaps to 15°.",
          "Arrow keys nudge by 1; with Shift, by 10.",
          "The control bar has X, Y, W, H and rotation fields, and six align buttons. One object aligns to the artboard; several align to each other.",
          "The Layers panel is the stack, top first. Drag a row to reorder it, double-click to rename, and use the eye and lock columns. Search filters it.",
        ],
      },
      {
        t: "keys",
        rows: [
          ["Select all", "mod+a"],
          ["Deselect", "mod+shift+a"],
          ["Copy / Cut / Paste", "mod+c"],
          ["Paste in front", "mod+f"],
          ["Paste in back", "mod+b"],
          ["Paste in place", "mod+shift+v"],
          ["Duplicate", "mod+d"],
          ["Bring forward / send backward", "mod+]"],
          ["Bring to front / send to back", "mod+shift+]"],
          ["Lock selection", "mod+2"],
          ["Unlock all", "mod+alt+2"],
          ["Hide selection", "mod+3"],
          ["Show all", "mod+alt+3"],
          ["Delete", "Delete"],
          ["Undo", "mod+z"],
          ["Redo", "mod+shift+z"],
        ],
      },
    ],
  },
  {
    id: "paths",
    group: "Canvas editor",
    title: "Drawing paths",
    summary: "The Pen, Line, Polygon and Star tools, and editing anchor points.",
    blocks: [
      { t: "p", text: "A path is a vector outline. The path tools are in every kind of design: decorations, stickers, lounge scenes, nameplates and profile effects. (In a lounge scene what you draw is laid over the room picture; see Lounge scenes.)" },
      { t: "h", text: "The Pen (P)" },
      {
        t: "steps",
        items: [
          "Click to place corner points. Click and drag to place a smooth point and pull its curve out; the handle on the other side mirrors it.",
          "Click the first point again to close the path (it is filled when closed). Otherwise press Enter, double-click, or pick another tool to leave it open.",
          "Backspace takes back the last point you placed.",
        ],
      },
      { t: "h", text: "Editing with Direct Selection (A)" },
      {
        t: "list",
        items: [
          "Click a path to see its anchors. Drag one to move it; Shift-click several to move them together (Shift while dragging keeps to one axis).",
          "A picked smooth anchor shows its handles. Drag a handle to change the curve; hold Alt to move one without its twin.",
          "Double-click an anchor to turn it from a corner into a smooth point, or back. Double-click the outline between anchors to add an anchor there without changing the shape.",
          "Delete removes the picked anchors.",
        ],
      },
      { t: "h", text: "Line, Polygon and Star" },
      {
        t: "list",
        items: [
          "Line Segment (\\): drag; hold Shift for 45° steps.",
          "Polygon and Star: drag a box. The Inspector keeps their sides (or points and depth) editable until you move an anchor — after that the outline is yours.",
        ],
      },
      { t: "h", text: "The Paintbrush (B)" },
      { t: "p", text: "Drag to paint freehand. When you let go the stroke is smoothed into a clean curve with only a few anchors, so you can still edit it with Direct Selection. Pick the brush and size in the control bar; see Brushes." },
      { t: "h", text: "Tool options" },
      {
        t: "list",
        items: [
          "With the Polygon tool in hand, the control bar shows Sides; with the Star tool, Points and Depth. They set what the next one is drawn with and are remembered.",
          "With the Pen in hand, the control bar reminds you of its keys.",
        ],
      },
      { t: "h", text: "Pathfinder and compound paths" },
      {
        t: "list",
        items: [
          "Select two or more shapes or paths and open the Pathfinder panel (or Object ▸ Pathfinder). Unite makes one outline of them all; Minus Front cuts everything in front out of the back shape; Intersect keeps only where they all overlap; Exclude Overlap keeps everything but that; Minus Back cuts everything behind out of the front shape.",
          "The result is a path of curves, not a pile of straight pieces, and takes the look of the front shape (Minus Front keeps the back one's). Rotated shapes are combined as they appear. Open paths count as closed, and text and pictures can't be combined.",
          "Compound Path ▸ Make (⌘8) joins outlines into one path without changing them, so wherever one lies inside another there is a hole — a ring, the letter O. Release (⌥⌘8) splits it back into separate paths. Direct Selection edits the anchors of every contour.",
          "Expand Shape turns a rectangle or ellipse into a path of the same shape, so its anchors can be edited.",
        ],
      },
      { t: "p", text: "Fill (solid, gradient, material or none), stroke (solid, gradient or material, weight, cap, corner style and brush) and effects are in the Appearance panel." },
      {
        t: "keys",
        rows: [
          ["Pen", "p"],
          ["Paintbrush", "b"],
          ["Make compound path", "mod+8"],
          ["Release compound path", "mod+alt+8"],
          ["Direct Selection", "a"],
          ["Line Segment", "\\"],
        ],
      },
      { t: "try", kind: "decoration", label: "Start a practice decoration" },
    ],
  },
  {
    id: "groups",
    group: "Canvas editor",
    title: "Groups",
    summary: "Move, scale and turn several objects as one.",
    blocks: [
      {
        t: "list",
        items: [
          "Select two or more objects and choose Object ▸ Group. Clicking any member then selects the whole group, and so does selecting it in the Layers panel (a link icon marks grouped rows).",
          "A box with handles surrounds a group, or any selection of several objects: drag a corner or edge to scale them together, and the circle above to turn them. Shift keeps proportions (corners) or snaps to 15° (turning). If any member is turned off the axes, scaling is kept proportional so nothing shears.",
          "Double-click an object in a group to go inside it: everything else dims and the group's own parts can be picked one by one (a subgroup counts as one). Press Esc, or click something outside, to come back out. The Direct Selection tool picks single objects without going inside.",
          "Groups nest: grouping a group with another object makes a bigger group around it. Group and Ungroup act one level at a time — inside a group they act within it. A group left with one member dissolves.",
          "Strokes and effects keep their size when a group is scaled; text scales with its height.",
          "Ungroup dissolves the group. Duplicating or pasting a group makes a new group of the copies.",
          "Groups are for working. A cosmetic is still submitted as its individual layers, so the layer limit counts every object in a group.",
        ],
      },
      {
        t: "keys",
        rows: [
          ["Group", "mod+g"],
          ["Ungroup", "mod+shift+g"],
        ],
      },
    ],
  },
  {
    id: "appearance",
    group: "Making things",
    title: "Gradients, shadows, glows and shaders",
    summary: "Effects that are drawn onto the picture your design is sent as.",
    blocks: [
      { t: "p", text: "Select a picture, shape or text and open Appearance in the dock (or use the Effect menu). Effects stay editable: each can be switched off with its eye, changed, or removed, and the original paint is kept." },
      {
        t: "list",
        items: [
          "Gradient fill — for shapes, paths and text; and a gradient stroke for shapes and paths. Linear (with an angle) or radial, up to eight colour stops.",
          "Material fill or stroke — wood, marble, metal and more; see Materials.",
          "Drop shadow, inner shadow, outer glow and inner glow — offset, blur, opacity and colour; glow strength stacks the halo. The Glow looks buttons set up a soft glow, a neon tube, a halo or an ember edge in the colour you pick.",
          "Gaussian blur — softens the object itself.",
          `Shaders, run in the order you add them: ${Object.values(SHADER_LABEL).join(", ")}.`,
        ],
      },
      { t: "h", text: "How they reach the app" },
      { t: "p", text: "The app's own layer renderer can draw pictures, rectangles, ellipses and text — it has no shadows or shaders. So when you submit, every object with effects is drawn to a PNG by the same code that draws it on your canvas, uploaded, and sent as an ordinary picture layer. What you see is what a buyer gets, and nothing about the server had to change." },
      {
        t: "warn",
        text: `Effects reach past an object: a shadow or glow counts as part of it. In a decoration the whole of it — effects included — has to stay inside the dashed edge (${DECORATION_MARGIN}% past the avatar). Gradients and materials on pictures aren't supported; use a shader instead. A stroke counts too: a thick line reaches half its width past its anchors.`,
      },
      { t: "tip", text: "A cosmetic can have at most " + MAX_LAYERS + " layers. An object with effects is still one layer." },
    ],
  },
  {
    id: "decorations",
    group: "Making things",
    title: "Avatar decorations",
    summary: "Artwork that goes around an avatar.",
    blocks: [
      {
        t: "steps",
        items: [
          "Create a project: New project ▸ Avatar decoration. The circle is the avatar and the artboard is square.",
          "Place artwork (drop a picture on the canvas, or use File ▸ Place picture) and draw shapes or text around it.",
          `Keep everything inside the dashed edge — it may reach ${DECORATION_MARGIN}% past the avatar, no further. The Problems panel flags anything that goes over.`,
          "Check the Preview tab to see it on your avatar, then Submit.",
        ],
      },
      { t: "tip", text: `A decoration has at most ${MAX_LAYERS} layers. Use effects, gradients and shaders on a few objects rather than many plain ones.` },
      { t: "try", kind: "decoration", label: "Start a practice decoration" },
    ],
  },
  {
    id: "stickers",
    group: "Making things",
    title: "Profile stickers",
    summary: "Artwork that sits on a profile card.",
    blocks: [
      {
        t: "steps",
        items: [
          "Create a project: New project ▸ Profile sticker. The artboard is a profile card; stickers are placed from its top edge.",
          `A sticker can be at most ${STICKER_MAX_WIDTH}% of the card's width. Wider objects are flagged in Problems.`,
          "Preview shows it on a card with your avatar.",
        ],
      },
      { t: "try", kind: "sticker", label: "Start a practice sticker" },
    ],
  },
  {
    id: "scenes",
    group: "Making things",
    title: "Lounge scenes",
    summary: "A room for a voice lounge: a picture, a screen, seats and props.",
    blocks: [
      {
        t: "steps",
        items: [
          "Create a project: New project ▸ Lounge scene. The artboard is 16:9.",
          "Drop in the room picture (or a short WebM/MP4 loop). The first picture becomes the room.",
          "Use the Screen tool to mark where a stream shows — a room has exactly one.",
          "Use the Floor line tool to set where walking starts.",
          `Click with the Seat tool to place seats (up to ${SCENE_LIMITS.seats}), and add animated props (up to ${SCENE_LIMITS.props}).`,
        ],
      },
      { t: "p", text: `Props available: ${SCENE_PROP_KINDS.join(", ")}.` },
      { t: "h", text: "Drawing on the room" },
      {
        t: "p",
        text: `Everything you draw above the room picture — shapes, paths made with the Pen, Paintbrush, Line, Polygon and Star tools, text and pictures, with any gradient, material or effect — is sent too, as pictures laid over the room. They sit below the screen's glow, the props and the people, so a drawn lamp or rug is part of the room. Up to ${SCENE_LIMITS.overlay} pieces; group some into one with Pathfinder if you need more. Whatever is below the room picture in the Layers panel is covered by it and isn't sent.`,
      },
      { t: "tip", text: "The Preview tab shows the drawn art in the room, with seats and props, exactly as the lounge will." },
      { t: "try", kind: "scene", label: "Start a practice scene" },
    ],
  },
  {
    id: "materials",
    group: "Making things",
    title: "Materials",
    summary: "Wood, marble, metal and other textures as a fill or an outline.",
    blocks: [
      { t: "p", text: `A material is a texture made by the editor itself — no pictures to import — used where you would use a colour. In the Appearance panel choose Material for the Fill or the Stroke of a shape, path or text. Pick one of the ${MATERIAL_PRESETS.length} presets, or tune it.` },
      { t: "list", items: PRESET_GROUPS.map((g) => `${g}: ${MATERIAL_PRESETS.filter((p) => p.group === g).map((p) => p.label).join(", ")}.`) },
      { t: "h", text: "Tuning one" },
      {
        t: "list",
        items: [
          `Kind — ${Object.values(MATERIAL_LABEL).join(", ")}. Each has two colours (for wood, the light and dark grain; for brick, the brick and the mortar).`,
          "Size — how big the grain, bricks or flecks are, in the design's own units, so a bigger shape shows more of the same grain.",
          "Strength — how pronounced the grain, veins or relief are.",
          "Grain — which way it runs, for the materials that have a direction (wood, brushed metal, brick, fabric).",
          "Another one — changes the pattern without changing the look: a different piece of the same wood.",
        ],
      },
      { t: "p", text: "A material is the same pixels every time, at any size, so what you see here is what is sent. Like gradients and effects it is drawn to a picture when you submit. It works as an outline too: a gold ring, a wooden frame." },
      { t: "tip", text: "A brush stroke takes a material as well: a calligraphy stroke in gold, or stars in pink glitter." },
    ],
  },
  {
    id: "brushes",
    group: "Making things",
    title: "Brushes",
    summary: "Tapered, calligraphy, chalk, spray and stamped strokes.",
    blocks: [
      { t: "p", text: "Press B for the Paintbrush and drag. The brush and its size are in the control bar; the colour box next to them is the stroke colour. You can also give any path a brush afterwards: select it, and choose a Brush in the Stroke section of Appearance." },
      {
        t: "list",
        items: Object.entries(BRUSH_LABEL).map(([k, label]) => {
          const u = BRUSH_USES[k as keyof typeof BRUSH_USES];
          const settings = [u.taper && "taper", u.angle && "nib angle", u.spacing && "spacing", u.jitter && "variation"].filter(Boolean).join(", ");
          return `${label} — ${{ taper: "a stroke that thins to a point at each end", calligraphy: "a flat nib: thick across its angle, thin along it", ink: "a pen with pressure that varies along the stroke", chalk: "a dry, grainy line the surface shows through", spray: "a soft cloud of specks", dots: "round dots along the line", stars: "stars along the line", hearts: "hearts along the line", sparkles: "four-pointed sparkles along the line" }[k]}${settings ? ` (settings: ${settings})` : ""}.`;
        }),
      },
      { t: "p", text: "Round is an ordinary line. Weight is the size of the brush, and the stroke's colour, gradient or material is what the marks are filled with." },
      { t: "p", text: "The marks are made from the stroke's shape and a pattern number, so the same stroke always looks the same. \"Scatter again\" shows another arrangement." },
      { t: "warn", text: "A brush stroke is sent as a picture, so, as with any effect, everything it reaches has to stay inside the dashed edge of a decoration." },
    ],
  },
  {
    id: "nameplates",
    group: "Making things",
    title: "Nameplates",
    summary: "The strip behind a name: drawn in the canvas editor, and animated if you like.",
    blocks: [
      { t: "steps", items: [
        "Create a project: New project ▸ Nameplate. The Canvas tab is the canvas editor with a wide strip as its artboard (" + MOTION_STAGES.nameplate.w + " × " + MOTION_STAGES.nameplate.h + ").",
        "Draw it with everything the canvas editor has: shapes, paths, brushes, materials, text, pictures, gradients, glows.",
        "Optional: open the Animate tab to move it (see The animation editor). A nameplate that never changes is sent as a plain picture, as it always was; one that moves is sent as an animation the app plays.",
        "Check the Preview tab, then Submit.",
      ] },
      { t: "list", items: [
        "The app draws a nameplate faintly behind a name and fades it towards the text, so wide, simple artwork reads best. The Preview tab shows it on three rows.",
        "An animated nameplate plays at a lower frame rate and size than a profile effect, because it is wallpaper behind a name, shown in lists of many people. The app also pauses it when it isn't on screen.",
        "People who ask their system to reduce motion see a still frame instead.",
      ] },
      { t: "try", kind: "nameplate", label: "Start a practice nameplate" },
    ],
  },
  {
    id: "effects",
    group: "Making things",
    title: "Profile effects",
    summary: "An animation that plays over a whole profile card.",
    blocks: [
      { t: "steps", items: [
        "Create a project: New project ▸ Profile effect. The artboard and the stage are a profile card (" + MOTION_STAGES.effect.w + " × " + MOTION_STAGES.effect.h + ").",
        "Draw anything it needs in the Canvas tab, or build it entirely from generators in the Animate tab: sparkles, snow, hearts, light rays, shimmer.",
        "Make it move in the Animate tab. It can loop, or play once and then rest on its last frame before it plays again.",
        "Make the first and last frames match if it loops, so it doesn't jump. Preview with the “As worn” view in the viewer.",
      ] },
      { t: "p", text: "The effect is drawn over the whole card and never takes clicks, so the card's buttons still work under it." },
      { t: "try", kind: "effect", label: "Start a practice effect" },
    ],
  },
  {
    id: "animation",
    group: "Making things",
    title: "The animation editor",
    summary: "The Animate tab: browser, viewer, inspector and timeline, laid out like Final Cut Pro.",
    blocks: [
      { t: "p", text: "Nameplates and profile effects have two tabs. Canvas is where you draw; Animate is where you move it. Everything you draw appears in Animate as a clip, and changes you make in Canvas follow it, so the two are never out of step." },
      { t: "list", items: [
        "Browser (left) — Generators (shapes, backgrounds, light, particles), Titles, Effects, Transitions, your Canvas layers and your Pictures. Generators and titles are added at the playhead; effects and transitions go on the selected clips.",
        "Viewer (middle) — the design at the playhead, with handles on the selected clip: drag to move, a corner to scale, the knob above to turn. The play controls are under it, with timecode (minutes:seconds:frames, 30 a second). Choose “As worn” to see it behind a name or over a card.",
        "Inspector (right) — everything about the selected clip: transform, opacity and blend, what it's made of, effects, mask, retime, transitions. With nothing selected it holds the design's settings. The Animation tab shows its keyframe graphs.",
        "Timeline (bottom) — lanes (V1 at the bottom is behind V2 above it), clips, the ruler and the playhead (red). Drag the bar above it to give it more room.",
      ] },
      { t: "h", text: "What clips are" },
      { t: "list", items: [
        `Layers from your canvas, imported pictures, and generators: ${[...new Set(GENERATORS.map((g) => g.group))].join(", ")}.`,
        `Titles with ${TEXT_ANIMS.filter((a) => a !== "none").length} text animations: ${TITLES.map((t) => t.label).join(", ")}.`,
        "Adjustment layers, which have no picture of their own: their effects change everything on the lanes below.",
        "Compound clips: several clips grouped into one that can be opened and edited.",
      ] },
      { t: "h", text: "Editing" },
      { t: "list", items: [
        "Click a clip to select it, Shift-click to add more, drag to move (it snaps to the playhead and to other clips' edges; hold Alt to turn that off).",
        "Drag the left or right edge of a clip to trim. What stays on screen stays where it was: trimming the start doesn't make the animation slide.",
        "Split cuts a clip at the playhead into two that play exactly like the one did. Delete removes; Shift-Delete also closes the gap in that lane.",
        "Drag a clip up or down to another lane. A clip that would land on another is lifted to a free lane.",
        "Length (top right of the timeline) is how long the whole design runs, up to " + MOTION_LIMITS.duration + " seconds. Fit sets it to where the last clip ends.",
      ] },
      { t: "h", text: "Tools and keys" },
      { t: "p", text: "These are Final Cut Pro's tools and keys where it has one." },
      { t: "list", items: MOTION_TOOLS.map((t) => `${t.label} (${t.key}) — ${t.hint}`) },
      ...MOTION_KEYS.flatMap((g) => [{ t: "h" as const, text: g.group }, { t: "keys" as const, rows: g.rows }]),
      { t: "tip", text: "Up and Down jump the playhead between edits, which is the quickest way to step through a design clip by clip." },
    ],
  },
  {
    id: "keyframes",
    group: "Making things",
    title: "Keyframes, easing and retiming",
    summary: "Animate any setting over time, shape how it moves, and change speed.",
    blocks: [
      { t: "h", text: "Keyframes" },
      { t: "steps", items: [
        "Move the playhead to where the movement should start.",
        "Click the diamond next to a setting (Position, Scale, Rotation, Opacity, an effect's size or colour…). It fills in: there is now a keyframe there, holding the current value.",
        "Move the playhead to where it should end and change the setting. A second keyframe appears and the setting moves between the two.",
        "The arrows beside the diamond jump to the previous and next keyframe. The bin beside it removes all of a setting's keyframes, keeping its value at the playhead.",
      ] },
      { t: "p", text: "Auto-key does that for you: with it on (⌥K), moving, scaling or turning a clip in the viewer at some time makes a keyframe there. Keyframes show as small diamonds along the bottom of the clip." },
      { t: "warn", text: "A setting that already has keyframes always makes a new one when you change it, even with Auto-key off. That keeps its other times from changing; remove the keyframes first if you want to set it flat again." },
      { t: "h", text: "Easing" },
      { t: "p", text: `Open the Animation tab for a setting's graph: time across, value up. Drag a keyframe to change when and how much (Shift keeps its value); double-click the graph to add one. Select a keyframe to choose how it moves to the next: ${EASE_PRESETS.join(", ")}, or a Bézier curve you set with four numbers. “Hold” keeps the old value until the next keyframe, then jumps.` },
      { t: "h", text: "Retiming" },
      { t: "list", items: [
        "Speed in the Retime section: 2× makes the clip run its contents twice as fast and take half as long on the timeline. Its keyframes stretch with it.",
        "Ease in, Ease out, Slow → fast and Fast → slow make a speed ramp that changes smoothly across the clip.",
        "Reverse plays it backwards. “Repeat” loops a clip that is longer than its contents.",
      ] },
      { t: "h", text: "Transitions, masks and blending" },
      { t: "list", items: [
        `Transitions (Fade, ${TRANSITIONS.slice(1).map((t) => t.label).join(", ")}) run as a clip begins (In) or ends (Out), for the length you choose.`,
        "A mask shows only part of a clip: an oval or a box with a soft edge, which can move and grow over time. Invert it to cut a hole.",
        `Blend modes decide how a clip combines with what's below it: ${BLEND_MODES.join(", ")}.`,
        `Effects: ${[...new Set(EFFECTS.map((e) => e.label))].join(", ")}.`,
      ] },
    ],
  },
  {
    id: "animation-limits",
    group: "Making things",
    title: "Animated designs: sizes and limits",
    summary: "What an animated nameplate or effect can contain.",
    blocks: [
      { t: "list", items: [
        `Up to ${MOTION_LIMITS.duration} seconds, ${MOTION_LIMITS.clips} clips (compound clips' contents count), nested ${MOTION_LIMITS.depth} deep, ${MOTION_LIMITS.images} different pictures, ${MOTION_LIMITS.fx} effects on a clip, ${MOTION_LIMITS.keys} keyframes on one setting, ${MOTION_LIMITS.particles} particles on one emitter.`,
        `The finished animation is a small file (up to ${Math.round(MAX_MOTION_BYTES / 1024)} KB) the app fetches and plays live, so it is sharp at any size. Pictures in it are uploaded once each.`,
        "Particles are worked out from the time alone, so scrubbing, looping and replaying always show the same thing.",
        "The server checks every design again when it arrives and writes its own copy; what is stored is what was checked, and can't be changed afterwards.",
      ] },
      { t: "tip", text: "Short designs (two to six seconds) feel better on a profile than long ones, and the Problems panel warns about anything much longer." },
    ],
  },
  {
    id: "submitting",
    group: "Making things",
    title: "Checking and submitting",
    summary: "Problems, Preview and sending for review.",
    blocks: [
      {
        t: "list",
        items: [
          "Problems lists everything the server would reject, and warnings for things that will look wrong. Click one to select the object. The status bar shows the count.",
          "Preview shows the design on your own avatar, on a profile card, or in a room.",
          "Submit takes a name, a price (or free) and sends it. Your submissions and their review status are under Submissions in the activity bar.",
        ],
      },
      { t: "tip", text: "Nothing is saved until you say so: press Ctrl/⌘+S (or File ▸ Save). A dot on the tab shows unsaved changes, and Studio asks before closing over them. Only theme packs save as you go. Undo history is kept while Studio stays open." },
    ],
  },
  {
    id: "code",
    group: "Code editor",
    title: "The code editor",
    summary: "Extensions and bots, in an editor laid out like VS Code.",
    blocks: [
      { t: "p", text: "Extensions and bots are folders of TypeScript files, edited in Monaco — the editor inside VS Code — with the same layout: an activity bar, an Explorer, tabs and breadcrumbs, a bottom panel for Problems, Output and a Terminal, and a status bar." },
      {
        t: "list",
        items: [
          "The menu bar in the title bar has File, Edit, Selection, View, Go, Run, Terminal and Help. Every item is the same command as its shortcut or the command palette.",
          "File ▸ New File… and New Folder… use the Explorer's name entry. New things go in the selected folder.",
          "View ▸ Minimap, Word Wrap and Render Whitespace change the editor itself; the checkmark shows what is on.",
          "Run holds Check Project and, for an extension, Build, Run and Send for review.",
          "Nothing is saved until you ask: Ctrl/⌘+S saves the file, File ▸ Save All saves every file, and a dot on a tab marks unsaved changes. Studio asks before closing a project with unsaved files.",
        ],
      },
      { t: "tip", text: "Press F1 (or Shift+Ctrl/⌘+P) for the command palette — every command in the menus is in it, and you can type part of a name." },
      { t: "p", text: "The editor is only available in the desktop app, where a project is a folder on your computer." },
    ],
  },
  {
    id: "code-keys",
    group: "Code editor",
    title: "Code editor shortcuts",
    summary: "The keys worth knowing.",
    blocks: [
      {
        t: "keys",
        rows: [
          ["Command palette", "mod+shift+p"],
          ["Go to file", "mod+p"],
          ["Go to line", "ctrl+g"],
          ["Find in files", "mod+shift+f"],
          ["Find / Replace in a file", "mod+f"],
          ["Show Explorer", "mod+shift+e"],
          ["Toggle side bar", "mod+b"],
          ["Toggle panel", "mod+j"],
          ["Problems", "mod+shift+m"],
          ["Toggle terminal", "ctrl+`"],
          ["Save", "mod+s"],
          ["Close editor", "mod+w"],
          ["Toggle line comment", "mod+/"],
          ["Format document", "alt+shift+f"],
          ["Project settings", "mod+,"],
        ],
      },
    ],
  },
];

export const toolRows = TOOLS;

/** Every searchable word of a topic, lower-cased. */
export function haystack(t: Topic): string {
  const parts: string[] = [t.title, t.summary, t.group];
  for (const b of t.blocks) {
    if ("text" in b) parts.push(b.text);
    if ("items" in b) parts.push(...b.items);
    if (b.t === "keys") parts.push(...b.rows.map((r) => r[0]));
    if (b.t === "tools") parts.push(...TOOLS.flatMap((x) => [x.label, x.hint, ...x.how]));
  }
  return parts.join(" ").toLowerCase();
}

export function search(query: string): Topic[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return TOPICS;
  return TOPICS.filter((t) => {
    const h = haystack(t);
    return words.every((w) => h.includes(w));
  });
}
