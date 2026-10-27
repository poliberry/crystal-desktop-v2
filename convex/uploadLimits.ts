import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Where upload size limits are actually enforced.
 *
 * Mirrors src/lib/upload-limits.ts, which is what the UI shows and checks
 * before starting a transfer. That check is a courtesy: a storage upload URL
 * is a plain POST endpoint, so the size a file actually turned out to be is
 * only knowable here, from the storage metadata, once the bytes have landed.
 * Change one, change the other.
 *
 * Two limits because the two cases aren't the same shape — an attachment is
 * whatever someone wants to send, fetched on demand; a soundboard clip is a
 * few seconds long and fetched by everyone in a call the instant it's pressed.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_SOUND_BYTES = 10 * 1024 * 1024;

/** Custom avatar decorations. Smaller again: one is fetched everywhere its
 * owner appears — every message in a busy channel, every row of a member
 * list — so its weight is paid many times over per screen. */
export const MAX_DECORATION_BYTES = 2 * 1024 * 1024;

/** Profile effects and frames, and board-widget images. Larger than a
 * decoration: these are card-sized artwork, and one is fetched when somebody
 * opens a profile rather than once per row of a member list. */
export const MAX_PROFILE_ASSET_BYTES = 6 * 1024 * 1024;

const label = (bytes: number) => `${bytes / 1024 / 1024} MB`;

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
  maxBytes: number,
  what: string
): Promise<void> {
  const meta = await ctx.db.system.get(storageId);
  if (!meta || meta.size <= maxBytes) return;
  await ctx.storage.delete(storageId).catch(() => {});
  throw new Error(`${what} must be smaller than ${label(maxBytes)}.`);
}
