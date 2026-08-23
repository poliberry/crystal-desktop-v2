import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * The server's copy of the upload ceiling.
 *
 * Mirrors `MAX_UPLOAD_BYTES` in src/lib/upload-limits.ts, which is the number
 * the UI shows and checks before it starts a transfer. That check is a
 * courtesy — a storage upload URL is a plain POST endpoint, so the size a file
 * actually turned out to be is only knowable here, from the storage metadata,
 * after the bytes have landed. Change one, change the other.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const MAX_UPLOAD_LABEL = `${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;

/**
 * Reject an oversized upload and drop the orphaned blob.
 *
 * Deleting rather than leaving it costs nothing and matters: a rejected file
 * that stays in storage is billable and unreachable — no document will ever
 * reference it, so nothing would ever clean it up.
 *
 * Storage metadata can be missing for a genuinely fresh upload; that's treated
 * as "can't tell" and allowed through rather than failing a legitimate send.
 */
export async function requireWithinUploadLimit(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  what = "Files"
): Promise<void> {
  const meta = await ctx.db.system.get(storageId);
  if (!meta || meta.size <= MAX_UPLOAD_BYTES) return;
  await ctx.storage.delete(storageId).catch(() => {});
  throw new Error(`${what} must be smaller than ${MAX_UPLOAD_LABEL}.`);
}
