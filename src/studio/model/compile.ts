import { SCENE_LIMITS, type SceneSpec } from "../../../convex/lib/creationSpecs";
import { MAX_LAYERS } from "@/lib/cosmetic-layers";
import { boundsOf, nodesInOrder, round } from "@/studio/model/doc";
import { bakesToPicture, fxBox, hasFx } from "@/studio/model/fx";
import type { Doc, ImageNode, Node, PropNode, SeatNode, ShapeNode, TextNode } from "@/studio/model/types";

/**
 * From a Studio document to what Crystal draws.
 *
 * Compiling is one-way and lossy on purpose: the document can hold things the app
 * can't draw (a rotated ellipse with a stroke on a sticker is fine, a blend mode
 * would not be), so every rule the output can't honour is checked here and
 * reported as a `Problem` while the creator is still editing, rather than being
 * discovered at submission or silently dropped.
 */

export interface Problem {
  severity: "error" | "warning";
  message: string;
  /** The node it is about, so the panel can select it. */
  nodeId?: string;
}

/** Resolves an imported asset to the address it will have once uploaded. Absent
 * while only checking. */
export type UrlOf = (assetId: string) => string | undefined;

/** The address a node with effects was uploaded to once rendered to a picture. Absent while only checking. */
export type BakedUrlOf = (nodeId: string) => string | undefined;

// --- Limits mirrored from the app --------------------------------------------------------------

/** How far past the avatar a decoration may reach, in percent of its width — see
 * DECORATION_MARGIN in src/lib/cosmetic-layers.ts. */
export const DECORATION_MARGIN = 30;
export const STICKER_MAX_WIDTH = 70;

const pct = (value: number, of: number) => round((value / of) * 100);

// --- Cosmetics ----------------------------------------------------------------------------------

/** The layer shape `submitCreation` takes (convex/lib/cosmeticLayers.ts). */
export interface CompiledLayer {
  id: string;
  kind?: "image" | "text" | "shape";
  url: string;
  anchor: "top" | "center";
  x: number;
  y: number;
  width: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string;
  shape?: "rect" | "ellipse";
  radius?: number;
  strokeColor?: string;
  strokeWidth?: number;
}

function toLayer(node: Node, doc: Doc, urlOf: UrlOf | undefined, bakedOf: BakedUrlOf | undefined): CompiledLayer | null {
  const { w: AW } = doc.artboard;
  // A decoration is placed from the avatar's centre; a sticker from the card's top.
  const anchor = doc.kind === "decoration" ? "center" : "top";
  // A node with effects goes out as the picture it renders to: its turned bounds grown by what
  // the effects reach, with the turn already in the pixels.
  const baked = hasFx(node);
  const g = baked ? fxBox(node) : { x: node.x, y: node.y, w: node.w, h: node.h };
  const cx = g.x + g.w / 2;
  const cy = g.y + g.h / 2;
  const rotation = baked ? 0 : node.rotation;
  const base = {
    id: node.id,
    anchor,
    x: pct(cx, AW),
    y: anchor === "center" ? pct(cy - doc.artboard.h / 2, AW) : pct(cy, AW),
    width: pct(g.w, AW),
    height: pct(g.h, AW),
    rotation: rotation ? round(rotation) : undefined,
    opacity: node.opacity < 1 ? round(node.opacity) : undefined,
  } as const;

  if (baked) return { ...base, kind: "image", url: bakedOf?.(node.id) ?? "" };
  if (node.type === "image") {
    const url = urlOf?.((node as ImageNode).assetId);
    return { ...base, kind: "image", url: url ?? "" };
  }
  if (node.type === "shape") {
    const s = node as ShapeNode;
    return {
      ...base,
      kind: "shape",
      url: "",
      shape: s.shape,
      color: s.fill,
      radius: s.shape === "rect" ? pct(s.radius, AW) : undefined,
      strokeColor: s.strokeWidth > 0 ? s.stroke : undefined,
      strokeWidth: s.strokeWidth > 0 ? pct(s.strokeWidth, AW) : undefined,
    };
  }
  if (node.type === "text") {
    const t = node as TextNode;
    return {
      ...base,
      kind: "text",
      url: "",
      text: t.text,
      fontSize: pct(t.fontSize, AW),
      fontWeight: t.fontWeight,
      italic: t.italic || undefined,
      align: t.align,
      color: t.color,
      strokeColor: t.strokeWidth > 0 ? t.stroke : undefined,
      strokeWidth: t.strokeWidth > 0 ? pct(t.strokeWidth, AW) : undefined,
    };
  }
  return null;
}

/** The layers of a decoration or sticker, bottom first. */
export function compileLayers(doc: Doc, urlOf?: UrlOf, bakedOf?: BakedUrlOf): CompiledLayer[] {
  return nodesInOrder(doc)
    .filter((n) => !n.hidden && (n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path"))
    .map((n) => toLayer(n, doc, urlOf, bakedOf))
    .filter((l): l is CompiledLayer => l !== null);
}

export function checkCosmetic(doc: Doc, assetExists: (id: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  const visible = nodesInOrder(doc).filter((n) => !n.hidden && (n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path"));
  if (visible.length === 0) problems.push({ severity: "error", message: "There's nothing to submit yet — add some artwork." });
  if (visible.length > MAX_LAYERS) problems.push({ severity: "error", message: `A cosmetic has at most ${MAX_LAYERS} layers; this has ${visible.length}.` });

  const { w: AW, h: AH } = doc.artboard;
  for (const n of visible) {
    // What it covers includes whatever its effects reach: a shadow past the edge is past the edge.
    const b = hasFx(n) ? fxBox(n) : boundsOf(n);
    if (n.type === "image" && !assetExists((n as ImageNode).assetId)) {
      problems.push({ severity: "error", message: `“${n.name}” has lost its picture.`, nodeId: n.id });
    }
    if (n.w < 1 || n.h < 1) problems.push({ severity: "error", message: `“${n.name}” is too small to see.`, nodeId: n.id });
    if (n.type === "text" && !(n as TextNode).text.trim()) problems.push({ severity: "error", message: `“${n.name}” has no text.`, nodeId: n.id });
    if (n.type === "text" && (n as TextNode).text.length > 120) problems.push({ severity: "error", message: `“${n.name}” is longer than 120 characters.`, nodeId: n.id });
    if (doc.kind === "decoration") {
      const m = (DECORATION_MARGIN / 100) * AW;
      if (b.x < -m || b.y < -m || b.x + b.w > AW + m || b.y + b.h > AH + m) {
        problems.push({ severity: "error", message: `“${n.name}” reaches too far past the avatar — it has to stay within the dashed edge.`, nodeId: n.id });
      }
    } else {
      if ((b.w / AW) * 100 > STICKER_MAX_WIDTH) {
        problems.push({ severity: "error", message: `“${n.name}” is wider than a sticker may be (${STICKER_MAX_WIDTH}% of the card).`, nodeId: n.id });
      }
      if (b.y < -AW * 0.5) problems.push({ severity: "warning", message: `“${n.name}” sits far above the card and may be cut off.`, nodeId: n.id });
    }
    if (n.opacity < 0.05) problems.push({ severity: "warning", message: `“${n.name}” is almost invisible.`, nodeId: n.id });
  }
  return problems;
}

/**
 * What is wrong with the artwork of a nameplate or profile effect on its own. It can be empty (the design may be all
 * generators on the timeline), so unlike a cosmetic it isn't an error to have nothing drawn; the rest is the same.
 */
export function checkArtwork(doc: Doc, assetExists: (id: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  for (const n of nodesInOrder(doc)) {
    if (n.hidden || !(n.type === "image" || n.type === "shape" || n.type === "text" || n.type === "path")) continue;
    if (n.type === "image" && !assetExists((n as ImageNode).assetId)) problems.push({ severity: "error", message: `“${n.name}” has lost its picture.`, nodeId: n.id });
    if (n.w < 1 || n.h < 1) problems.push({ severity: "error", message: `“${n.name}” is too small to see.`, nodeId: n.id });
    if (n.type === "text" && !(n as TextNode).text.trim()) problems.push({ severity: "error", message: `“${n.name}” has no text.`, nodeId: n.id });
    if (n.opacity < 0.05) problems.push({ severity: "warning", message: `“${n.name}” is almost invisible.`, nodeId: n.id });
  }
  return problems;
}

// --- Scenes --------------------------------------------------------------------------------------

export function checkScene(doc: Doc, assetExists: (id: string) => boolean): Problem[] {
  const problems: Problem[] = [];
  const AWc = doc.artboard.w;
  const AHc = doc.artboard.h;
  const nodes = nodesInOrder(doc);
  const bg = nodes.find((n): n is ImageNode => n.type === "image" && n.role === "background");
  if (!bg) problems.push({ severity: "error", message: "Set a background picture — it's the room itself." });
  else if (!assetExists(bg.assetId)) problems.push({ severity: "error", message: "The background picture is missing.", nodeId: bg.id });

  const screens = nodes.filter((n) => n.type === "screen");
  if (screens.length === 0) problems.push({ severity: "error", message: "Add a screen — it's where streams are shown." });
  if (screens.length > 1) problems.push({ severity: "error", message: "A room has one screen.", nodeId: screens[1].id });
  if (!nodes.some((n) => n.type === "floor")) problems.push({ severity: "error", message: "Mark where the floor starts, so people know where they can walk." });
  if (nodes.filter((n) => n.type === "floor").length > 1) problems.push({ severity: "error", message: "A room has one floor line." });

  const art = sceneArtwork(doc);
  if (art.length > SCENE_LIMITS.overlay) problems.push({ severity: "error", message: `At most ${SCENE_LIMITS.overlay} pieces of artwork can be drawn on a room; there are ${art.length}. Group some into one with Pathfinder, or remove some.` });
  for (const n of art) {
    if (n.type === "image" && !assetExists((n as ImageNode).assetId)) problems.push({ severity: "error", message: `“${n.name}” has lost its picture.`, nodeId: n.id });
    if (n.w < 1 || n.h < 1) problems.push({ severity: "error", message: `“${n.name}” is too small to see.`, nodeId: n.id });
    if (n.type === "text" && !(n as TextNode).text.trim()) problems.push({ severity: "error", message: `“${n.name}” has no text.`, nodeId: n.id });
    const b = fxBox(n);
    // A little past the edge is fine (a glow reaches); a long way is a picture the room can't show.
    if (b.x + b.w < 0 || b.y + b.h < 0 || b.x > AWc || b.y > AHc) problems.push({ severity: "warning", message: `“${n.name}” is entirely outside the room, so it won't be seen.`, nodeId: n.id });
    if (n.opacity < 0.05) problems.push({ severity: "warning", message: `“${n.name}” is almost invisible.`, nodeId: n.id });
  }
  const seats = nodes.filter((n) => n.type === "seat");
  const props = nodes.filter((n) => n.type === "prop");
  if (seats.length > SCENE_LIMITS.seats) problems.push({ severity: "error", message: `At most ${SCENE_LIMITS.seats} seats.` });
  if (props.length > SCENE_LIMITS.props) problems.push({ severity: "error", message: `At most ${SCENE_LIMITS.props} props.` });
  if (seats.length === 0) problems.push({ severity: "warning", message: "No seats: people will stand and walk about, but can't sit." });

  const { w: AW, h: AH } = doc.artboard;
  const floor = nodes.find((n) => n.type === "floor");
  const floorTop = floor ? ((floor.y + floor.h / 2) / AH) * 100 : null;
  for (const seat of seats) {
    const cy = ((seat.y + seat.h / 2) / AH) * 100;
    if (floorTop !== null && cy < floorTop) problems.push({ severity: "warning", message: "A seat is above the floor line, where nobody can walk to.", nodeId: seat.id });
    if (seat.x + seat.w / 2 < 0 || seat.x + seat.w / 2 > AW || cy < 0 || cy > 100) problems.push({ severity: "error", message: "A seat is outside the room.", nodeId: seat.id });
  }
  const screen = screens[0];
  if (screen) {
    for (const seat of seats) {
      const c = { x: seat.x + seat.w / 2, y: seat.y + seat.h / 2 };
      if (c.x > screen.x && c.x < screen.x + screen.w && c.y > screen.y && c.y < screen.y + screen.h) {
        problems.push({ severity: "warning", message: "A seat is on top of the screen.", nodeId: seat.id });
      }
    }
    if (floorTop !== null && ((screen.y + screen.h) / AH) * 100 > floorTop + 5) {
      problems.push({ severity: "warning", message: "The screen hangs well below the floor line.", nodeId: screen.id });
    }
  }
  if (bg && bg.w > 0 && Math.abs(bg.w / bg.h - AW / AH) > 0.02) {
    problems.push({ severity: "warning", message: "The background isn't 16:9, so it will be cropped to fit.", nodeId: bg.id });
  }
  return problems;
}

/**
 * The artwork drawn on a room, bottom first: every visible picture, shape, path and piece of text
 * that sits above the room's background in the stack (what is below it is behind it, and the
 * background covers it).
 */
export function sceneArtwork(doc: Doc): Node[] {
  const all = nodesInOrder(doc);
  const bg = all.findIndex((n) => n.type === "image" && n.role === "background");
  return all.filter((n, i) => i > bg && !n.hidden && bakesToPicture(doc, n) && !(n.type === "image" && n.role === "background"));
}

/** A scene document as the spec the server rebuilds. `backgroundUrl` is the uploaded address; `artworkUrl` gives the uploaded picture of a piece of artwork. */
export function compileScene(doc: Doc, name: string, backgroundUrl: string, artworkUrl?: BakedUrlOf): SceneSpec {
  const { w: AW, h: AH } = doc.artboard;
  const nodes = nodesInOrder(doc);
  const screen = nodes.find((n) => n.type === "screen");
  const floor = nodes.find((n) => n.type === "floor");
  return {
    v: 1,
    name,
    backgroundUrl,
    screen: screen
      ? { x: pct(screen.x, AW), y: pct(screen.y, AH), w: pct(screen.w, AW), h: pct(screen.h, AH) }
      : { x: 31, y: 11, w: 38, h: 31 },
    floorTop: floor ? pct(floor.y + floor.h / 2, AH) : 58,
    seats: nodes.filter((n): n is SeatNode => n.type === "seat").map((s) => ({ x: pct(s.x + s.w / 2, AW), y: pct(s.y + s.h / 2, AH) })),
    props: nodes
      .filter((n): n is PropNode => n.type === "prop")
      .map((p, i) => ({
        id: `p${i + 1}`,
        kind: p.prop,
        // Feet on the point: the bottom-centre of the node.
        x: pct(p.x + p.w / 2, AW),
        y: pct(p.y + p.h, AH),
        size: pct(p.w, AW),
        interactive: p.interactive,
        on: p.on,
      })),
    lights: doc.scene ?? { dimOnShare: false, amount: 0.6 },
    overlay: sceneArtwork(doc)
      .map((n) => {
        // Drawn to its own picture, turned and with its effects: so its box is the effect box, and the room
        // shows exactly the picture, not the node.
        const b = fxBox(n);
        return { url: artworkUrl?.(n.id) ?? "", x: pct(b.x, AW), y: pct(b.y, AH), w: pct(b.w, AW), h: pct(b.h, AH), opacity: n.opacity };
      })
      .filter((o) => artworkUrl === undefined || o.url !== ""),
  };
}
