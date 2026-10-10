import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { CrystalError } from "./errors";

/** A file to send: a path on disk, or bytes with a name. */
export type FileInput = string | { name: string; data: Uint8Array | ArrayBuffer | string; contentType?: string };

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".txt": "text/plain", ".md": "text/plain", ".json": "application/json", ".csv": "text/csv", ".pdf": "application/pdf", ".zip": "application/zip",
};

export const contentTypeFor = (name: string) => TYPES[extname(name).toLowerCase()] ?? "application/octet-stream";

/** Read a file input to bytes, name and type. A string is a path; a `{ data: string }` is text. */
export async function readFileInput(file: FileInput): Promise<{ name: string; bytes: Uint8Array; contentType: string }> {
  if (typeof file === "string") {
    const bytes = new Uint8Array(await readFile(file).catch((e) => { throw new CrystalError(`Couldn't read “${file}”: ${(e as Error).message}`); }));
    return { name: basename(file), bytes, contentType: contentTypeFor(file) };
  }
  const bytes = typeof file.data === "string" ? new TextEncoder().encode(file.data) : file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data);
  return { name: file.name, bytes, contentType: file.contentType ?? contentTypeFor(file.name) };
}
