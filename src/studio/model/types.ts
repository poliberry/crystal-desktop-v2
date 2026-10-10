import type { ScenePropKind } from "../../../convex/lib/creationSpecs";
import type { MotionSpec } from "../../../convex/lib/motion";

/**
 * Crystal Studio's own document model.
 *
 * A project is a flat map of typed nodes plus an ordered list saying which is on
 * top of which. Everything a design tool needs — selecting, moving, undoing,
 * compiling — is a function over this shape, and nothing in it is borrowed from
 * the profile layer editor: it is built to carry things that editor can't (scene
 * objects, history, snapping) and to be compiled *into* what the app renders
 * rather than being that format itself.
 */

export type DocKind = "decoration" | "sticker" | "scene" | "nameplate" | "effect";

export type ProjectKind =
  | "decoration"
  | "sticker"
  | "nameplate"
  | "effect"
  | "scene"
  | "themePack"
  | "pack"
  | "extension"
  | "bot";

// --- Paint and effects ----------------------------------------------------------------------------
//
// Gradients, shadows, glows, blur and shaders are things the app's own layer renderer cannot draw. They
// are not sent to the server as new layer kinds: a node that uses any of them is rendered to a picture
// when the design is compiled, and goes out as an ordinary image layer (see model/fx-render.ts). So the
// editor, the store picture and what a buyer sees are drawn by the same code.

export interface GradientStop {
  /** 0 at the start of the gradient, 1 at the end. */
  offset: number;
  color: string;
}

export interface Gradient {
  type: "linear" | "radial";
  /** Degrees, for a linear gradient: 0 runs left to right, 90 top to bottom. */
  angle: number;
  /** At least two, in order of offset. */
  stops: GradientStop[];
}

export interface Shadow {
  x: number;
  y: number;
  /** Artboard units: how far the edge is softened. */
  blur: number;
  color: string;
  /** 0–1. */
  opacity: number;
}

/** A pixel effect applied to a node's own picture, in order. Each can be switched off without losing its settings. */
export type Shader = { id: string; on: boolean } & (
  | { type: "adjust"; hue: number; saturation: number; brightness: number; contrast: number }
  | { type: "grain"; amount: number; seed: number }
  | { type: "duotone"; shadow: string; highlight: string }
  | { type: "pixelate"; size: number }
  | { type: "posterize"; levels: number }
  | { type: "scanlines"; gap: number; strength: number }
  | { type: "chromatic"; offset: number }
);
export type ShaderType = Shader["type"];

/**
 * What a stroke is drawn with, other than a plain line of constant width: see `model/brush.ts`. The stroke's
 * weight is the brush's size and its paint (colour, gradient, material) is what the marks are filled with.
 */
export type BrushType = "taper" | "calligraphy" | "ink" | "chalk" | "spray" | "dots" | "stars" | "hearts" | "sparkles";

export interface Brush {
  type: BrushType;
  /** 0–1: how much of the stroke's length the tapered ends take up. */
  taper: number;
  /** Degrees: the angle of a calligraphy nib. */
  angle: number;
  /** For shape brushes: the gap between marks, in stroke widths. */
  spacing: number;
  /** 0–1: how uneven the marks are — size, turn, gaps, pressure. */
  jitter: number;
  /** Which of the many possible scatterings. */
  seed: number;
}

/**
 * A procedural texture used instead of a flat colour or a gradient: see `model/material.ts`. Like
 * gradients and effects it can't be described to the app's layer renderer, so a node that uses one is
 * rendered to a picture when the design is compiled.
 */
export type MaterialType = "wood" | "marble" | "stone" | "brick" | "metal" | "leather" | "fabric" | "carbon" | "ice" | "lava" | "glitter" | "parchment";

export interface Material {
  type: MaterialType;
  /** The two colours the texture is made between; what each means depends on the material ("Light grain" and "Dark grain" for wood). */
  color: string;
  color2: string;
  /** Size of the texture's features, in artboard units. */
  scale: number;
  /** 0–1: how pronounced the grain, veins or relief are. */
  intensity: number;
  /** Degrees: which way the grain runs, for materials that have one. */
  angle: number;
  /** Which of the many possible textures of this kind. */
  seed: number;
}

export interface Effects {
  /** Drop shadow, drawn behind the node. */
  shadow?: Shadow & { on: boolean };
  /** Outer glow: a soft halo in one colour all round the node. */
  glow?: { on: boolean; blur: number; color: string; opacity: number; strength: number };
  /** Inner glow: light coming in from the edges, drawn over the node and clipped to it. */
  innerGlow?: { on: boolean; blur: number; color: string; opacity: number; strength: number };
  /** Inner shadow, drawn over the node and clipped to it. */
  innerShadow?: Shadow & { on: boolean };
  /** Gaussian-like blur of the node itself, artboard units. */
  blur?: number;
  shaders?: Shader[];
}

export interface NodeBase {
  id: string;
  name: string;
  /** Effects. Absent means none. */
  fx?: Effects;
  /**
   * The groups this object is in, outermost first, as tags joined by "/": "g1" is in one group, "g1/g2"
   * is in group g2 which is itself inside g1. Objects sharing a tag are a group: clicking one selects the
   * outermost group, and they are moved, scaled and turned together. Tags, not containers, so the stack
   * stays one flat list and everything that walks it (drawing, snapping, submitting) is unchanged.
   */
  group?: string;
  /** Top-left corner, in the artboard's units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, about the node's centre. */
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
}

export interface ImageNode extends NodeBase {
  type: "image";
  assetId: string;
  /** In a scene, the one picture that is the room itself. */
  role?: "background";
}

export interface ShapeNode extends NodeBase {
  type: "shape";
  shape: "rect" | "ellipse";
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Corner radius, in artboard units. Rectangles only. */
  radius: number;
  /** When present, the fill is this gradient and `fill` is only what it falls back to. `fill` of "none" is no fill. */
  fillGradient?: Gradient;
  /** When present, the outline is painted with this gradient. */
  strokeGradient?: Gradient;
  /** When present, the fill is this material (over any gradient). */
  fillMaterial?: Material;
  /** When present, the outline is painted with this material. */
  strokeMaterial?: Material;
}

/**
 * One anchor of a path, in the path's own box: 0 is the box's left or top edge and 1 its right or
 * bottom, so resizing, turning and moving the node moves the whole outline with no further work.
 * `inX`/`inY` and `outX`/`outY` are the Bézier handles as positions in the same space; with neither
 * the anchor is a corner.
 */
export interface PathPoint {
  x: number;
  y: number;
  /**
   * Starts a new contour. A path with more than one contour is a compound path (a ring, the
   * letter O, the result of a Pathfinder operation): its contours are all closed and are filled
   * with the even-odd rule, so a contour inside another one is a hole. Absent on a plain path.
   */
  m?: true;
  inX?: number;
  inY?: number;
  outX?: number;
  outY?: number;
}

/** What a path was made by, so it can be edited as that (sides, inner radius) until its anchors are touched. */
export type PathLive = { kind: "polygon"; sides: number } | { kind: "star"; points: number; inner: number };

/** A vector outline: made with the Pen, Line, Polygon or Star tool, and edited anchor by anchor with Direct Selection. */
export interface PathNode extends NodeBase {
  type: "path";
  points: PathPoint[];
  closed: boolean;
  /** "none" is no fill. */
  fill: string;
  fillGradient?: Gradient;
  stroke: string;
  strokeWidth: number;
  strokeGradient?: Gradient;
  cap: "butt" | "round" | "square";
  join: "miter" | "round" | "bevel";
  live?: PathLive;
  /** When present, the outline is drawn with this brush instead of as a plain line. */
  brush?: Brush;
  /** When present, the fill is this material (over any gradient). */
  fillMaterial?: Material;
  /** When present, the outline is painted with this material. */
  strokeMaterial?: Material;
}

export interface TextNode extends NodeBase {
  type: "text";
  text: string;
  /** Artboard units. */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: "left" | "center" | "right";
  color: string;
  /** When present, the letters are filled with this gradient. */
  colorGradient?: Gradient;
  /** When present, the letters are filled with this material (over any gradient). */
  colorMaterial?: Material;
  stroke: string;
  strokeWidth: number;
}

/** Where a stream is shown. */
export interface ScreenNode extends NodeBase {
  type: "screen";
}

/** Where somebody can sit: the node's centre is where their feet go. */
export interface SeatNode extends NodeBase {
  type: "seat";
}

/** An animated prop from Crystal's catalogue. The node's bottom-centre is where it stands. */
export interface PropNode extends NodeBase {
  type: "prop";
  prop: ScenePropKind;
  interactive: boolean;
  on: boolean;
}

/** Where the floor starts: only its height matters. */
export interface FloorNode extends NodeBase {
  type: "floor";
}

export type VisualNode = ImageNode | ShapeNode | TextNode | PathNode;
export type SceneObjectNode = ScreenNode | SeatNode | PropNode | FloorNode;
export type Node = VisualNode | SceneObjectNode;
export type NodeType = Node["type"];

export const isVisual = (n: Node): n is VisualNode => n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path";
export const isSceneObject = (n: Node): n is SceneObjectNode => !isVisual(n);

/**
 * Ruler guides, as positions on the artboard's own axes: `x` entries are vertical
 * lines, `y` entries horizontal. They are an editing aid and never reach a
 * submission, but they belong to the document (as in Illustrator) so they are
 * saved with it and undone with it.
 */
export interface DocGuides {
  x: number[];
  y: number[];
}

export interface Doc {
  v: 1;
  kind: DocKind;
  /** The design's own size, in its own units. Everything is relative to this. */
  artboard: { w: number; h: number };
  nodes: Record<string, Node>;
  /** Bottom first: the last id is drawn on top. */
  order: string[];
  /** Scene settings that aren't objects in the room. */
  scene?: { dimOnShare: boolean; amount: number };
  /** Ruler guides. Absent means none. */
  guides?: DocGuides;
}

/** A picture (or other file) imported into a project. The bytes live in storage. */
export interface AssetMeta {
  id: string;
  projectId: string;
  name: string;
  type: string;
  size: number;
  /** Natural size, for pictures. */
  width?: number;
  height?: number;
  createdAt: number;
}

/** How a project is to be sold. Everything here is the creator's to choose. */
export interface Listing {
  name: string;
  description: string;
  free: boolean;
  priceUsd: string;
}

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The canvas document, for the kinds that have one. */
  doc?: Doc;
  /** An older nameplate's or profile effect's artwork: one imported picture or clip. New ones have `doc` and `motion`. */
  picture?: { assetId: string };
  /**
   * A nameplate's or profile effect's animation: the timeline that moves what is drawn in `doc`. Its clips are
   * the canvas's layers (see `model/motion-doc.ts`), generators, titles, and imported pictures. Pictures are
   * named `studio:asset/<id>` until the design is published.
   */
  motion?: MotionSpec;
  /** A theme pack's own data — see theme-pack.ts. */
  themePack?: ThemePackData;
  /** A cosmetic pack: other projects on this device, sold together. */
  pack?: { projectIds: string[] };
  /** An extension or plugin: its manifest and its code. */
  extension?: ExtensionData;
  /** A bot: how it is registered with Crystal. Never holds the token — see `BotData`. */
  bot?: BotData;
  listing: Listing;
  /**
   * Where this project stands in the store: the most recent submission made from it. From that Studio works out whether
   * the next submit is a first one, a replacement for one still waiting, or an update to a live listing. A reference
   * only (an id the server gave); never anything secret. A duplicate starts without it, since a copy is a new item.
   */
  store?: { submissionId: string; /** The live listing this project is a version of, once known. */ skuId?: string };
}

export const KIND_LABEL: Record<ProjectKind, string> = {
  decoration: "Avatar decoration",
  sticker: "Profile sticker",
  nameplate: "Nameplate",
  effect: "Profile effect",
  scene: "Lounge scene",
  themePack: "Theme pack",
  pack: "Cosmetic pack",
  extension: "Extension",
  bot: "Bot",
};

export interface FontFaceData {
  assetId: string;
  /** 100–900. For a variable font, the lightest it covers. */
  weight: number;
  weightMax?: number;
  style: "normal" | "italic";
}

/** A theme pack as edited: files are references to imported assets until submission. */
export interface ThemePackData {
  /** A font family: one or more files, each a weight and style. Projects made when a
   * pack had a single font have `assetId` here instead of `faces` — see `fontOf`. */
  font?: { family: string; faces?: FontFaceData[]; assetId?: string };
  /** `template` is the id of the built-in app theme the colours started from, if any — so the
   * editor can say so and offer to go back to it. It is Studio's own note: it is never submitted. */
  theme?: {
    isDark: boolean;
    colors: Record<string, string>;
    template?: string;
    /** A palette for the other scheme (light if `isDark`, dark if not), so the pack follows the person's setting. Absent:
     * the pack has one look. Its `template` is Studio's own note, like the main one's. */
    alt?: { colors: Record<string, string>; template?: string };
  };
  sounds: Record<string, string>;
  icons: Record<string, string>;
}

export const emptyThemePack = (): ThemePackData => ({ sounds: {}, icons: {} });

/**
 * Extensions and bots are TypeScript projects, not single design files: their code is the files in
 * the project folder (`src/`, `package.json`, …) and the `.crysproj` holds only their Marketplace
 * and registration settings. So they have no design file, and Studio edits them in the code
 * workbench rather than the canvas.
 */
export const CODE_KINDS = ["extension", "bot"] as const;
export const isCodeKind = (k: ProjectKind): k is (typeof CODE_KINDS)[number] => (CODE_KINDS as readonly string[]).includes(k);

/** An extension's manifest settings as edited. Mirrors what the server rebuilds (`normalizeManifest`). */
export interface ExtensionData {
  /** Its permanent id, `my-extension`: what a published extension is known by. */
  slug: string;
  kind: "plugin" | "component";
  description: string;
  version: string;
  capabilities: string[];
  network: string[];
  panelTitle: string;
}

/**
 * A bot as edited. The bot's code runs on its author's own servers, so a Studio project is its
 * registration with Crystal: who it is, what it asks for, which commands it has and where events
 * are sent. `botId` is set once it is registered.
 *
 * The token and signing secret are deliberately not here. They are shown once, when they are made,
 * and a project folder is something people copy, sync and commit — so a secret in it would leak.
 */
export interface BotData {
  description: string;
  visibility: "private" | "public";
  permissions: number;
  scopes: string[];
  commands: { name: string; description: string }[];
  endpointUrl: string;
  /** Where an install link may send people afterwards (https, or http://localhost). */
  redirectUris: string[];
  botId?: string;
  /**
   * The bot's profile. Each is only managed from Studio once it has been set here: `undefined` means "leave whatever
   * the bot's profile has alone" (so a bot that sets its own bio through the API isn't overwritten by a save).
   */
  bio?: string;
  /** A picture in this project's files, uploaded when the project is saved to Crystal. */
  avatarAssetId?: string;
  bannerAssetId?: string;
}

export const emptyBot = (): BotData => ({ description: "", visibility: "private", permissions: 0, scopes: [], commands: [], endpointUrl: "", redirectUris: [] });
