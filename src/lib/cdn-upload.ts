import type { ConvexReactClient } from "convex/react";

import type { Id } from "../../convex/_generated/dataModel";
import { uploadViaR2OrConvex } from "@/lib/r2-client";

/**
 * How an uploaded picture arrives at the mutation that adopts it: as a
 * Cloudflare object (`cdnKey`/`cdnUrl`, served from the CDN), or — only where
 * there is no bucket configured — as a Convex storage id.
 *
 * Every mutation that takes a picture takes this shape, so a call site is
 * `setIcon({ communityId, ...uploaded })` and none of them has to know which of
 * the two it got.
 */
export interface UploadedImage {
  storageId?: Id<"_storage">;
  cdnKey?: string;
  cdnUrl?: string;
}

/** The folders a picture can go into on the CDN — see `buildKey` in
 * convex/cdn.ts. */
export type CdnKind = Parameters<typeof uploadViaR2OrConvex>[2];

/**
 * Put a picture on the CDN.
 *
 * The one entry point the app's image uploads go through, so that "every image
 * is served from Cloudflare's edge" is a property of this function rather than
 * of eight call sites each remembering to ask. Convex storage is the fallback
 * for a deployment without R2, and nothing else is.
 */
export async function uploadImage(
  convex: ConvexReactClient,
  file: Blob,
  kind: CdnKind,
  /** For the fallback only. */
  generateConvexUploadUrl: () => Promise<string>,
  fileName = "upload",
): Promise<UploadedImage> {
  const asFile = file instanceof File ? file : new File([file], fileName, { type: file.type });
  return (await uploadViaR2OrConvex(
    convex,
    asFile,
    kind,
    generateConvexUploadUrl,
  )) as UploadedImage;
}
