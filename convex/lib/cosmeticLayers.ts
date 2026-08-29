import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

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

export const layerArgValidator = v.object({
  id: v.string(),
  url: v.string(),
  storageId: v.optional(v.id("_storage")),
  anchor: v.union(v.literal("top"), v.literal("center"), v.literal("bottom")),
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.optional(v.number()),
  stretchY: v.optional(v.boolean()),
  rotation: v.optional(v.number()),
  opacity: v.optional(v.number()),
});

export type LayerArg = {
  id: string;
  url: string;
  storageId?: Id<"_storage">;
  anchor: "top" | "center" | "bottom";
  x: number;
  y: number;
  width: number;
  height?: number;
  stretchY?: boolean;
  rotation?: number;
  opacity?: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

const round = (value: number) => Math.round(value * 10) / 10;

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
    stretchY: layer.stretchY || undefined,
    rotation: layer.rotation ? round(clamp(layer.rotation, -180, 180)) : undefined,
    opacity:
      layer.opacity === undefined || layer.opacity >= 1
        ? undefined
        : round(clamp(layer.opacity, 0, 1) * 100) / 100,
  }));
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
  const kept = new Set(next.map((layer) => layer.storageId).filter(Boolean));
  for (const layer of previous) {
    if (layer.storageId && !kept.has(layer.storageId)) {
      await ctx.storage.delete(layer.storageId).catch(() => {});
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
