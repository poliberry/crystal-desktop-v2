import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isR2Url, dropR2Url } from "./r2";

/**
 * Server-side handling of placed artwork — the profile frame's layers and the
 * avatar decoration's.
 *
 * Two jobs, both of which have to happen here rather than in the editor that
 * sends the list. The numbers are clamped, because a mutation is a public
 * endpoint and the sliders that normally produce these values are not the only
 * thing that can call it. And the files are reference-counted by hand: replacing
 * a list is the moment a layer stops existing, and the blob it pointed at has
 * nothing else referring to it from then on.
 *
 * The limits are mirrored in src/lib/cosmetic-layers.ts, which is what the
 * editor enforces while you drag. Change one, change the other.
 */

export const MAX_LAYERS = 8;

const POSITION = { min: -150, max: 250 };
const SIZE = { min: 2, max: 400 };

/** One card shape's placement — geometry only; see the schema. */
const variantArgValidator = v.object({
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  rotation: v.optional(v.number()),
});

/** What a layer is made of. Absent is `"image"` — see src/lib/cosmetic-layers.ts. */
const kindValidator = v.union(v.literal("image"), v.literal("text"), v.literal("shape"));

/** One pinned end of a two-ended stretch — see the schema. */
const layerEndValidator = v.object({
  anchor: v.union(v.literal("top"), v.literal("bottom"), v.literal("locked")),
  y: v.number(),
});

export const layerArgValidator = v.object({
  id: v.string(),
  kind: v.optional(kindValidator),
  url: v.string(),
  storageId: v.optional(v.id("_storage")),
  anchor: v.union(
    v.literal("top"),
    v.literal("center"),
    v.literal("bottom"),
    v.literal("locked")
  ),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.optional(v.number()),
  stretchY: v.optional(v.boolean()),
  stretchDirection: v.optional(v.union(v.literal("down"), v.literal("up"))),
  stretchTop: v.optional(layerEndValidator),
  stretchBottom: v.optional(layerEndValidator),
  rotation: v.optional(v.number()),
  opacity: v.optional(v.number()),
  // Text and shape layers. Each is meaningful for one kind and dropped for the
  // others on the way in — see `normalizeLayers`.
  text: v.optional(v.string()),
  fontSize: v.optional(v.number()),
  fontWeight: v.optional(v.number()),
  italic: v.optional(v.boolean()),
  align: v.optional(
    v.union(v.literal("left"), v.literal("center"), v.literal("right"))
  ),
  color: v.optional(v.string()),
  shape: v.optional(v.union(v.literal("rect"), v.literal("ellipse"))),
  radius: v.optional(v.number()),
  strokeColor: v.optional(v.string()),
  strokeWidth: v.optional(v.number()),
  variants: v.optional(v.record(v.string(), variantArgValidator)),
});

export type LayerArg = {
  id: string;
  kind?: "image" | "text" | "shape";
  url: string;
  storageId?: Id<"_storage">;
  anchor: "top" | "center" | "bottom" | "locked";
  x: number;
  y: number;
  width: number;
  height?: number;
  stretchY?: boolean;
  stretchDirection?: "down" | "up";
  stretchTop?: LayerEndArg;
  stretchBottom?: LayerEndArg;
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
  variants?: Record<string, LayerVariantArg>;
};

type LayerVariantArg = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
};

type LayerEndArg = {
  anchor: "top" | "bottom" | "locked";
  y: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** A hundredth of a percent — see the note in src/lib/cosmetic-layers.ts, which
 * rounds the same way so a value that has been through the editor survives a
 * round trip unchanged. */
const round = (value: number) => Math.round(value * 100) / 100;

/** Every number brought inside the limits, the list cut to length, and the
 * absent-means-default fields dropped rather than stored as their default. */
export function normalizeLayers(layers: LayerArg[]): LayerArg[] {
  return layers.slice(0, MAX_LAYERS).map((layer) => ({
    id: layer.id,
    url: layer.url,
    storageId: layer.storageId,
    anchor: layer.anchor,
    x: round(clamp(layer.x, POSITION.min, POSITION.max)),
    y: round(clamp(layer.y, POSITION.min, POSITION.max)),
    width: round(clamp(layer.width, SIZE.min, SIZE.max)),
    height:
      layer.height === undefined ? undefined : round(clamp(layer.height, SIZE.min, SIZE.max)),
    // A locked layer is placed against the card's height rather than an edge of
    // it, so it has no edge to grow from — see src/lib/cosmetic-layers.ts,
    // which drops the flag the same way.
    stretchY: (layer.stretchY && layer.anchor !== "locked") || undefined,
    // Only stored when it isn't the default, and only when there is a stretch
    // for it to be a direction of. A two-ended stretch has no single direction,
    // so it's dropped there too.
    stretchDirection:
      layer.stretchY &&
      layer.anchor !== "locked" &&
      layer.stretchDirection === "up" &&
      !(layer.stretchTop && layer.stretchBottom)
        ? ("up" as const)
        : undefined,
    // Both ends or neither — one alone has nothing to stretch between.
    ...(layer.stretchTop && layer.stretchBottom
      ? {
          stretchTop: normalizeEnd(layer.stretchTop),
          stretchBottom: normalizeEnd(layer.stretchBottom),
        }
      : { stretchTop: undefined, stretchBottom: undefined }),
    rotation: layer.rotation ? round(clamp(layer.rotation, -180, 180)) : undefined,
    opacity:
      layer.opacity === undefined || layer.opacity >= 1
        ? undefined
        : round(clamp(layer.opacity, 0, 1) * 100) / 100,
    variants: normalizeVariants(layer.variants),
    ...normalizeContent(layer),
  }));
}

/**
 * Where artwork may go — mirrored from src/lib/cosmetic-layers.ts, which is
 * what the editor enforces while you drag. Change one, change the other.
 *
 * A decoration sits around an avatar and may hang `DECORATION_MARGIN` percent
 * past it. A sticker sits *on* a profile card and has to stay on it: no wider
 * than `STICKER_MAX_WIDTH`, no further down than the tallest card there is, and
 * pinned to the top or bottom edge. A layer that runs around the card is a
 * frame, and frames are the marketplace's.
 */
const DECORATION_MARGIN = 30;
const STICKER_MAX_WIDTH = 70;
const STICKER_MAX_CARD_HEIGHT = 240;
const STICKER_FALLBACK_CARD_HEIGHT = 130;

/** Half the width and height a box takes up once it has been turned. */
function turnedHalfExtents(width: number, height: number, rotation: number | undefined) {
  const radians = ((rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return { x: (width * cos + height * sin) / 2, y: (width * sin + height * cos) / 2 };
}

/** Where a layer's centre sits, measured down from the stage's top edge in
 * percent of its width — the one place the three anchors are told apart. */
function centreFromTop(layer: LayerArg, stageHeight: number): number {
  if (layer.anchor === "center") return stageHeight / 2 + layer.y;
  if (layer.anchor === "bottom") return stageHeight + layer.y;
  if (layer.anchor === "locked") return (layer.y / 100) * stageHeight;
  return layer.y;
}

/** The inverse of `centreFromTop`, for a given anchor. */
function yFromCentre(anchor: LayerArg["anchor"], centre: number, stageHeight: number): number {
  if (anchor === "center") return centre - stageHeight / 2;
  if (anchor === "bottom") return centre - stageHeight;
  if (anchor === "locked") return stageHeight > 0 ? (centre / stageHeight) * 100 : 0;
  return centre;
}

/** The height to assume for a layer whose height is the artwork's own, which
 * only the file knows: a square is the best guess and errs towards more room. */
const heightOf = (layer: LayerArg) => layer.height ?? layer.width;

/**
 * Sticker layers as they should be stored.
 *
 * Without a card to measure, so against a short one and against the tallest:
 * inside it at the sides, below the top edge, and no further down than any card
 * goes. The editor is stricter — it confines a sticker to the card it is
 * actually drawn on — and this is the floor that holds for a caller that isn't
 * the editor.
 */
export function normalizeStickerLayers(layers: LayerArg[]): LayerArg[] {
  return normalizeLayers(layers).map((layer) => {
    const width = Math.min(layer.width, STICKER_MAX_WIDTH);
    const scale = layer.width > 0 ? width / layer.width : 1;
    const height = layer.height === undefined ? width : layer.height * scale;
    const half = turnedHalfExtents(width, height, layer.rotation);

    const fromTop = centreFromTop(layer, STICKER_FALLBACK_CARD_HEIGHT);
    const anchor: LayerArg["anchor"] =
      fromTop <= STICKER_FALLBACK_CARD_HEIGHT / 2 ? "top" : "bottom";
    const rawY = yFromCentre(anchor, fromTop, STICKER_FALLBACK_CARD_HEIGHT);

    return {
      ...layer,
      width: round(width),
      height: layer.height === undefined ? undefined : round(layer.height * scale),
      fontSize: layer.fontSize === undefined ? undefined : round(layer.fontSize * scale),
      anchor,
      x: round(clamp(layer.x, half.x, 100 - half.x)),
      y: round(
        anchor === "top"
          ? clamp(rawY, half.y, STICKER_MAX_CARD_HEIGHT - half.y)
          : clamp(rawY, -(STICKER_MAX_CARD_HEIGHT - half.y), -half.y)
      ),
      stretchY: undefined,
      stretchDirection: undefined,
      stretchTop: undefined,
      stretchBottom: undefined,
      variants: undefined,
    };
  });
}

/**
 * Decoration layers as they should be stored: the whole of each inside the
 * avatar plus its margin. An avatar is a square at every size, so this is the
 * same check the editor makes.
 */
export function normalizeDecorationLayers(layers: LayerArg[]): LayerArg[] {
  const min = -DECORATION_MARGIN;
  const max = 100 + DECORATION_MARGIN;
  return normalizeLayers(layers).map((layer) => {
    let width = layer.width;
    let height = heightOf(layer);
    const extent = turnedHalfExtents(width, height, layer.rotation);
    const scale = Math.min(
      1,
      (max - min) / Math.max(extent.x * 2, 0.0001),
      (max - min) / Math.max(extent.y * 2, 0.0001)
    );
    let next: LayerArg = { ...layer, variants: undefined };
    if (scale < 1) {
      width *= scale;
      height *= scale;
      next = {
        ...next,
        width: round(width),
        height: layer.height === undefined ? undefined : round(layer.height * scale),
        fontSize: layer.fontSize === undefined ? undefined : round(layer.fontSize * scale),
      };
    }
    const half = turnedHalfExtents(width, height, next.rotation);
    const centre = clamp(centreFromTop(next, 100), min + half.y, max - half.y);
    return {
      ...next,
      x: round(clamp(next.x, min + half.x, max - half.x)),
      y: round(yFromCentre(next.anchor, centre, 100)),
    };
  });
}

/** One end of a two-ended stretch, its offset clamped like every other
 * position. `y` is percent of card width for an edge anchor, percent of card
 * height for `"locked"` — the wider range covers both. */
function normalizeEnd(end: LayerEndArg): LayerEndArg {
  const anchor =
    end.anchor === "bottom" || end.anchor === "locked" ? end.anchor : ("top" as const);
  return { anchor, y: round(clamp(end.y, POSITION.min, POSITION.max)) };
}

/** Text: capped at a length, and everything a shape would have dropped. */
const MAX_TEXT_LENGTH = 120;

/**
 * The fields that belong to one kind of layer, kept only for that kind.
 *
 * Mirrors `normalizeContent` in src/lib/cosmetic-layers.ts. Here because a
 * mutation is a public endpoint: the editor produces coherent layers, and it
 * is not the only thing that can call this.
 */
function normalizeContent(layer: LayerArg): Partial<LayerArg> {
  const stroke =
    layer.strokeColor && (layer.strokeWidth ?? 0) > 0
      ? {
          strokeColor: layer.strokeColor.slice(0, 64),
          strokeWidth: round(clamp(layer.strokeWidth ?? 0, 0, SIZE.max)),
        }
      : { strokeColor: undefined, strokeWidth: undefined };

  if (layer.kind === "text") {
    return {
      kind: "text" as const,
      url: "",
      storageId: undefined,
      text: (layer.text ?? "").slice(0, MAX_TEXT_LENGTH),
      fontSize: round(clamp(layer.fontSize ?? 7.5, 0.5, SIZE.max)),
      fontWeight: clamp(Math.round((layer.fontWeight ?? 700) / 100) * 100, 100, 900),
      italic: layer.italic || undefined,
      align: layer.align === "left" || layer.align === "right" ? layer.align : ("center" as const),
      color: (layer.color || "#ffffff").slice(0, 64),
      shape: undefined,
      radius: undefined,
      ...stroke,
    };
  }

  if (layer.kind === "shape") {
    return {
      kind: "shape" as const,
      url: "",
      storageId: undefined,
      text: undefined,
      fontSize: undefined,
      fontWeight: undefined,
      italic: undefined,
      align: undefined,
      color: (layer.color || "#ffffff").slice(0, 64),
      shape: layer.shape === "ellipse" ? ("ellipse" as const) : ("rect" as const),
      radius:
        layer.shape === "ellipse" || !layer.radius
          ? undefined
          : round(clamp(layer.radius, 0, SIZE.max)),
      ...stroke,
    };
  }

  // An image, which is every layer written before there were three kinds — so
  // `kind` stays absent rather than being stamped onto documents that were
  // fine without it.
  return {
    kind: undefined,
    text: undefined,
    fontSize: undefined,
    fontWeight: undefined,
    italic: undefined,
    align: undefined,
    color: undefined,
    shape: undefined,
    radius: undefined,
    strokeColor: undefined,
    strokeWidth: undefined,
  };
}

/** A variant's numbers, clamped the same way, and an empty set dropped rather
 * than stored. Which keys are meaningful is the client's business — a shape of
 * card is presentation — so an unknown one is kept rather than second-guessed. */
function normalizeVariants(
  variants: Record<string, LayerVariantArg> | undefined
): Record<string, LayerVariantArg> | undefined {
  if (!variants) return undefined;
  const out: Record<string, LayerVariantArg> = {};
  for (const [key, variant] of Object.entries(variants)) {
    out[key] = {
      x: variant.x === undefined ? undefined : round(clamp(variant.x, POSITION.min, POSITION.max)),
      y: variant.y === undefined ? undefined : round(clamp(variant.y, POSITION.min, POSITION.max)),
      width:
        variant.width === undefined ? undefined : round(clamp(variant.width, SIZE.min, SIZE.max)),
      height:
        variant.height === undefined ? undefined : round(clamp(variant.height, SIZE.min, SIZE.max)),
      rotation:
        variant.rotation === undefined ? undefined : round(clamp(variant.rotation, -180, 180)),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Delete the files that were in `previous` and aren't in `next`.
 *
 * A layer list is replaced wholesale by the editor, so this diff is the only
 * signal that a file has been dropped. Missing it would leave billable storage
 * that no document points at, which is the same reason every other cosmetic
 * deletes the blob it replaced.
 *
 * Failures are swallowed for the same reason as elsewhere: a file that has
 * already gone is not a reason to fail the edit that removed it.
 */
export async function dropUnusedLayerAssets(
  ctx: MutationCtx,
  previous: readonly LayerArg[] | undefined,
  next: readonly LayerArg[]
): Promise<void> {
  if (!previous?.length) return;
  const keptStorage = new Set(next.map((layer) => layer.storageId).filter(Boolean));
  const keptUrls = new Set(next.map((layer) => layer.url));
  for (const layer of previous) {
    if (layer.storageId && !keptStorage.has(layer.storageId)) {
      await ctx.storage.delete(layer.storageId).catch(() => {});
    }
    // A layer uploaded to the CDN has no storage id: its file is an R2 object,
    // found by the URL the layer points at. Kept if another layer still uses it
    // (a duplicate shares its picture with the original).
    if (layer.url && isR2Url(layer.url) && !keptUrls.has(layer.url)) {
      await dropR2Url(ctx, layer.url).catch(() => {});
    }
  }
}

/** Every storage id a document's layers point at, for the delete-account and
 * leave-server paths that clean up after a whole profile. */
export function layerAssets(
  doc: Pick<Doc<"users">, "profileFrameLayers" | "avatarDecorationLayers">
): Id<"_storage">[] {
  return [...(doc.profileFrameLayers ?? []), ...(doc.avatarDecorationLayers ?? [])]
    .map((layer) => layer.storageId)
    .filter((id): id is Id<"_storage"> => !!id);
}
