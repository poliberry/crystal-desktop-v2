/**
 * Saving an attachment under the name it was uploaded with.
 *
 * Attachments live in Convex file storage, which serves them from its own
 * origin under the storage ID — so the file the browser sees is called
 * something like `kg2a9f…`, with the real name known only to us. An anchor's
 * `download` attribute would normally fix that, but it is ignored outright
 * for cross-origin URLs: the browser falls back to the server's name, which
 * is how `Blu Sans.ttf` ended up on disk as a bare UUID.
 *
 * Fetching the bytes and handing the browser a same-origin blob URL is the
 * only way to make `download` authoritative again.
 */
export async function downloadFile(url: string, fileName: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName || "download";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking synchronously can cancel the download in some builds; one turn
    // of the event loop is enough for the click to have been consumed.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

/** `1.4 MB` / `912 B` — attachment sizes, shown next to the file name. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
