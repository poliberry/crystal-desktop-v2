import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";

/**
 * R2 helpers for asset mutations (banners, decorations, effects, frames,
 * community banners, chat backgrounds, emoji, etc.).
 *
 * When R2 env is set, uploads go to R2 and imageUrl stores the CDN public URL.
 * When not set, fallback to Convex storage.
 */

/** Objects under this folder are never deleted by the app's clean-up paths. */
export const PROTECTED_PREFIX = "marketplace/";

/** The folder one creator's artwork goes in: their own id, made safe for a path.
 * The upload ticket and the submission check both compute it, so a creator can
 * only submit artwork that went in under their own name. */
export function creationFolder(clerkId: string): string {
  return `marketplace/creations/${clerkId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 48)}/`;
}

export function isR2Enabled(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY);
}

export function r2PublicUrlForKey(key: string): string {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!base) return "";
  return `${base.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

function r2KeyFromUrl(url: string | null | undefined): string | null {
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  if (!url || !base) return null;
  const prefix = base.replace(/\/$/, "") + "/";
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  // Also handle migrated/ prefix directly
  if (url.includes("/migrated/")) {
    const idx = url.indexOf("/migrated/");
    return url.slice(idx + 1);
  }
  return null;
}

/**
 * Delete an R2 object by key or by public URL. No-op if R2 not configured or key null.
 * Called when an asset is replaced or removed — mirrors ctx.storage.delete for Convex.
 */
export async function r2DeleteByKey(key: string | null | undefined): Promise<void> {
  if (!key || !isR2Enabled()) return;
  // Marketplace artwork is one file shared by everyone who owns the item. Every
  // "replace my picture" path in the app deletes what it replaces, and a buyer
  // swapping a purchased decoration for something else must not delete it for
  // every other owner. Only staff removing the SKU would, and they don't: the
  // files of an archived item stay.
  if (key.startsWith(PROTECTED_PREFIX)) return;
  const accountId = process.env.R2_ACCOUNT_ID!;
  const bucket = process.env.R2_BUCKET!;
  const accessKey = process.env.R2_ACCESS_KEY_ID!;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY!;
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`;
  try {
    const { AwsClient } = await import("aws4fetch");
    const client = new AwsClient({ accessKeyId: accessKey, secretAccessKey: secretKey, service: "s3", region: "auto" });
    await client.fetch(endpoint, { method: "DELETE" });
  } catch {
    // deletion is best-effort
  }
}

export async function r2DeleteByUrl(url: string | null | undefined): Promise<void> {
  const key = r2KeyFromUrl(url);
  if (key) await r2DeleteByKey(key);
}

/**
 * Delete an R2 object from inside a mutation.
 *
 * A mutation cannot make a network request, so calling `r2DeleteByUrl` from one
 * silently does nothing — its `fetch` fails, the failure is swallowed as
 * "best effort", and the object stays in the bucket for ever. This schedules an
 * action to do the delete instead, which runs once the mutation commits (and not
 * at all if it rolls back, which is also what a delete should do).
 */
export async function dropR2Url(
  ctx: Pick<MutationCtx, "scheduler">,
  url: string | null | undefined
): Promise<void> {
  const key = r2KeyFromUrl(url);
  if (!key || !isR2Enabled()) return;
  await ctx.scheduler.runAfter(0, internal.cdnInternal.deleteR2Object, { key });
}

/**
 * Resolve an asset URL for reads: prefer CDN if storageId looks like already-migrated,
 * else fallback to Convex storage URL. For DB-stored URLs (users.imageUrl etc.),
 * just return as-is — they already hold the CDN URL after R2 upload.
 */
export function isR2Url(url: string | null | undefined): boolean {
  if (!url) return false;
  const base = process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "";
  return !!base && url.startsWith(base.replace(/\/$/, "") + "/");
}

/**
 * The artwork address, checked.
 *
 * It has to be on our own CDN, in the folder the uploader's own upload went to.
 * Anything else — a link to some other site, or someone else's file — would be
 * drawn into other people's profiles, and an address elsewhere can change what it
 * shows after staff approved it.
 */
export function creationArtworkUrl(url: string, clerkId: string): string {
  const base = (process.env.R2_PUBLIC_URL ?? process.env.CDN_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("Creator uploads aren't available right now.");
  if (!url.startsWith(`${base}/${creationFolder(clerkId)}`) || url.length > 500) {
    throw new Error("Upload the artwork through Crystal first.");
  }
  return url;
}

