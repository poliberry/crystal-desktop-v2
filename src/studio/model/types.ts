import type { ScenePropKind } from "../../../convex/lib/creationSpecs";

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

export type DocKind = "decoration" | "sticker" | "scene";

export type ProjectKind =
  | "decoration"
  | "sticker"
  | "nameplate"
  | "effect"
  | "scene"
  | "themePack"
  | "pack";

export interface NodeBase {
  id: string;
  name: string;
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

export type VisualNode = ImageNode | ShapeNode | TextNode;
export type SceneObjectNode = ScreenNode | SeatNode | PropNode | FloorNode;
export type Node = VisualNode | SceneObjectNode;
export type NodeType = Node["type"];

export const isVisual = (n: Node): n is VisualNode => n.type === "image" || n.type === "shape" || n.type === "text";
export const isSceneObject = (n: Node): n is SceneObjectNode => !isVisual(n);

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
  /** A nameplate's or profile effect's artwork: one imported picture or clip. */
  picture?: { assetId: string };
  /** A theme pack's own data — see theme-pack.ts. */
  themePack?: ThemePackData;
  /** A cosmetic pack: other projects on this device, sold together. */
  pack?: { projectIds: string[] };
  listing: Listing;
}

export const KIND_LABEL: Record<ProjectKind, string> = {
  decoration: "Avatar decoration",
  sticker: "Profile sticker",
  nameplate: "Nameplate",
  effect: "Profile effect",
  scene: "Lounge scene",
  themePack: "Theme pack",
  pack: "Cosmetic pack",
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
  theme?: { isDark: boolean; colors: Record<string, string> };
  sounds: Record<string, string>;
  icons: Record<string, string>;
}

export const emptyThemePack = (): ThemePackData => ({ sounds: {}, icons: {} });
