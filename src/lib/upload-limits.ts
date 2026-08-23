/**
 * One ceiling for everything a user uploads.
 *
 * Message attachments and soundboard clips used to disagree — 25 MB and 2 MB
 * respectively — which meant two different numbers to explain and two places
 * to change. A single limit is simpler to state in the UI ("up to 10 MB") and
 * simpler to keep honest, since the server checks the same constant.
 *
 * Mirrored by `MAX_UPLOAD_BYTES` in convex/uploadLimits.ts: the client can
 * only ever be a courtesy check, because a storage upload URL is a plain POST
 * anyone can reach. Change one, change the other.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** `10 MB` — how the limit is written in copy and error messages. */
export const MAX_UPLOAD_LABEL = `${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;
