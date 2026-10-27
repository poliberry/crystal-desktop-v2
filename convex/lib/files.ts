import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isR2Enabled, PROTECTED_PREFIX, r2KeyFromUrl } from "./r2";

/**
 * Deleting files when the thing that used them goes away.
 *
 * A file lives in one of two places: Convex storage (a `storageId`) or our R2
 * bucket behind the CDN (a key, or the public URL it maps to). Whenever an
 * attachment, picture or sound is removed in the app, call `releaseFile` with
 * whatever the row held, and the bytes go too.
 *
 * ## Why it doesn't delete straight away
 *
 * Uploads are content-addressed: the R2 key is built from a hash of the bytes
 * (cdn.ts `buildKey`), so two people posting the same meme share one object.
 * Deleting it the moment one message goes would break the other. So
 * `releaseFile` schedules `files.releaseIfUnused`, which runs after this
 * mutation commits (when the row being removed is already gone) and only
 * deletes the file if no other attachment or lounge image refers to it and no
 * report is holding it as evidence.
 *
 * Marketplace artwork (`marketplace/`) is never deleted here: it's one file
 * shared by everyone who owns the item.
 */

export type FileRef = {
  storageId?: Id<"_storage"> | null;
  cdnKey?: string | null;
  cdnUrl?: string | null;
};

export function fileKey(file: FileRef): string | null {
  return file.cdnKey ?? r2KeyFromUrl(file.cdnUrl) ?? null;
}

/** Release one file. Safe to call with nothing set, or with a URL that isn't ours (a GIF link, say): it does nothing. */
export async function releaseFile(ctx: Pick<MutationCtx, "scheduler">, file: FileRef | null | undefined): Promise<void> {
  if (!file) return;
  const key = fileKey(file);
  const cdnKey = key && isR2Enabled() && !key.startsWith(PROTECTED_PREFIX) ? key : undefined;
  const storageId = file.storageId ?? undefined;
  if (!cdnKey && !storageId) return;
  await ctx.scheduler.runAfter(0, internal.files.releaseIfUnused, { cdnKey, storageId });
}

export async function releaseFiles(ctx: Pick<MutationCtx, "scheduler">, files: (FileRef | null | undefined)[]): Promise<void> {
  for (const file of files) await releaseFile(ctx, file);
}

/** Shorthand for the common "a column holds a URL, maybe a storage id beside it" shape. */
export async function releaseUrl(
  ctx: Pick<MutationCtx, "scheduler">,
  url: string | null | undefined,
  storageId?: Id<"_storage"> | null
): Promise<void> {
  await releaseFile(ctx, { cdnUrl: url, storageId });
}

/**
 * Keep a file alive regardless of what happens to its message: used for report evidence. The hold
 * goes when the report does, if ever; reports are retained.
 */
export async function holdFile(ctx: MutationCtx, file: FileRef, reportId?: Id<"reports">): Promise<void> {
  const cdnKey = fileKey(file) ?? undefined;
  const storageId = file.storageId ?? undefined;
  if (!cdnKey && !storageId) return;
  await ctx.db.insert("fileHolds", { cdnKey, storageId, reason: "report", reportId, createdAt: Date.now() });
}
