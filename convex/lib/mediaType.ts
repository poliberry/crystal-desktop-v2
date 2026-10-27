/**
 * What kind of file an attachment is, for choosing how to show it.
 *
 * A file's MIME type is whatever the browser guessed when it was picked, and for plenty of
 * perfectly ordinary files it guesses nothing: `.wav`, `.mov`, `.m4a`, `.mkv` and others come
 * through with an empty type on some systems, and the upload code then stores
 * `application/octet-stream`. Choosing a player from that string alone shows those files as a
 * download row. So the type is repaired from the file's extension, both when it is uploaded and
 * when it is shown — the second matters because attachments already stored carry the useless type.
 *
 * Only formats the app can actually play are listed (checked against Electron's Chromium: WAV, MP3,
 * AAC/M4A, Ogg, FLAC, MP4, MOV (H.264 and HEVC), WebM, MKV). AIFF, CAF, AVI and the like are left as
 * downloads rather than turned into a player that fails at once.
 */

const BY_EXTENSION: Record<string, string> = {
  // audio
  wav: "audio/wav",
  wave: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  weba: "audio/webm",
  // video
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

const USELESS = new Set(["", "application/octet-stream", "binary/octet-stream", "application/unknown"]);

const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
};

/** The type to trust for a file: the given one if it says something, otherwise what the extension says. */
export function effectiveFileType(fileType: string | undefined | null, fileName: string): string {
  const given = (fileType ?? "").trim().toLowerCase();
  if (!USELESS.has(given)) return given;
  return BY_EXTENSION[extensionOf(fileName)] ?? (given || "application/octet-stream");
}

export type AttachmentKind = "image" | "audio" | "video" | "file";

export function attachmentKind(fileType: string | undefined | null, fileName: string): AttachmentKind {
  const type = effectiveFileType(fileType, fileName);
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  return "file";
}

/** The type to store for a picked file. */
export const typeForUpload = (file: { type: string; name: string }): string => effectiveFileType(file.type, file.name);
