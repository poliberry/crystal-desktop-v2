/**
 * Community stickers, as plain functions: what a valid name and picture are, and who may remove one.
 * No database and no Convex runtime, so the settings page can use the same rules and a script can
 * test them. The writing side is `../communityStickers`.
 */

/** Sticker slots per community. */
export const MAX_STICKER_SLOTS = 30;

/** What the picture may be. A sticker is shown at 160px in a stream of messages, so only still and
 * animated formats a browser draws natively; nothing a browser would run. */
export const STICKER_CONTENT_TYPES = ["image/png", "image/webp", "image/gif", "image/apng"] as const;

const STICKER_EXTENSIONS = ["png", "webp", "gif", "apng"] as const;

/** Same clean-up the emoji name gets: lowercase, anything outside letters, numbers and underscores becomes `_`. */
export function sanitiseStickerName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/** Why a (sanitised) name can't be used, or null when it can. */
export function stickerNameError(clean: string): string | null {
  if (clean.length < 2 || clean.length > 32) return "Sticker name must be 2–32 characters (letters, numbers, underscores).";
  return null;
}

/** Whether a storage object's content type is an allowed sticker picture. */
export function isStickerContentType(contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  return (STICKER_CONTENT_TYPES as readonly string[]).includes(type);
}

/** Whether a CDN key (or URL) ends in an allowed picture extension. The CDN path has no storage
 * metadata to read, so the name the file was uploaded under is all there is to go on. */
export function isStickerKey(key: string): boolean {
  const ext = key.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return (STICKER_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Who may remove a sticker: anyone who manages emoji (the owner and Administrators count as
 * holding every permission), and the person who uploaded it for as long as they can still create
 * expressions. Someone who has lost both can't take back what they added.
 */
export function mayRemoveSticker(opts: { canManageEmojis: boolean; canCreateExpressions: boolean; isUploader: boolean }): boolean {
  return opts.canManageEmojis || (opts.isUploader && opts.canCreateExpressions);
}
