/**
 * What the app will let you upload, by what you're uploading it for.
 *
 * Two numbers rather than one because the two cases aren't the same shape. An
 * attachment is whatever file someone wants to send and is downloaded on
 * demand; a soundboard clip is a few seconds long, is capped at
 * `MAX_CLIP_MS` anyway, and is fetched by everyone in a call the moment it's
 * pressed. A ceiling generous enough for the first would be meaningless for
 * the second.
 *
 * Mirrored in convex/uploadLimits.ts, which is where they're actually
 * enforced: the checks here are a courtesy that saves a doomed transfer, but a
 * storage upload URL is a plain POST anyone can reach, so the client's opinion
 * of a file's size is never the last word. Change one, change the other.
 */

/** Message attachments — anything, sent into a conversation. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Soundboard clips. Smaller on purpose: see above. */
export const MAX_SOUND_BYTES = 10 * 1024 * 1024;

/** Custom avatar decorations. Smaller again: one is fetched everywhere its
 * owner appears, so its weight is paid many times over per screen. */
export const MAX_DECORATION_BYTES = 2 * 1024 * 1024;

/** `25 MB` — for copy and error messages. */
export function formatUploadLimit(bytes: number): string {
  return `${bytes / 1024 / 1024} MB`;
}

export const MAX_ATTACHMENT_LABEL = formatUploadLimit(MAX_ATTACHMENT_BYTES);
export const MAX_SOUND_LABEL = formatUploadLimit(MAX_SOUND_BYTES);
export const MAX_DECORATION_LABEL = formatUploadLimit(MAX_DECORATION_BYTES);
