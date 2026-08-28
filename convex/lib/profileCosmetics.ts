/**
 * Shared plumbing for the card-level cosmetics — the profile effect and the
 * profile frame.
 *
 * Both live on `users` *and* on `serverProfiles` (see the `profileCosmetics`
 * spread in convex/schema.ts), so every one of them would otherwise be written
 * twice: once for the account and once per server. What differs between the
 * two is only which document gets patched, which is the caller's business;
 * what's the same is checking the size, resolving the URL, and not leaving the
 * file it replaced behind.
 */

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { MAX_PROFILE_ASSET_BYTES, requireWithinUploadLimit } from "../uploadLimits";

export const FRAME_MODES = ["wrap", "overlay"] as const;
export type FrameMode = (typeof FRAME_MODES)[number];

/**
 * Accept an uploaded effect/frame and hand back the URL to store for it.
 *
 * Throws — after deleting the blob — if it's over the limit, which is the only
 * place the real size is knowable: an upload URL is a plain POST, so the
 * client's check before the transfer is a courtesy and never the last word.
 */
export async function resolveProfileAsset(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  what: string
): Promise<string> {
  await requireWithinUploadLimit(ctx, storageId, MAX_PROFILE_ASSET_BYTES, what);
  const url = await ctx.storage.getUrl(storageId);
  if (!url) throw new Error(`${what} upload failed.`);
  return url;
}

/**
 * Drop the file a cosmetic used to point at.
 *
 * Called *after* the document has been patched off it, and never when the
 * replacement is the same blob. Nothing else references these files, so one
 * left behind is billable storage no code path can ever reach again.
 */
export async function dropProfileAsset(
  ctx: MutationCtx,
  previous: Id<"_storage"> | undefined,
  replacement?: Id<"_storage">
): Promise<void> {
  if (!previous || previous === replacement) return;
  await ctx.storage.delete(previous).catch(() => {});
}
