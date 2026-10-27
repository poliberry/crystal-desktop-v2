/**
 * Copy an image from a remote url to the system clipboard.
 *
 * The happy path is the Async Clipboard API (`ClipboardItem`), which Chromium
 * (and therefore Electron) implements for images. The fetch is done here
 * rather than trusting the `<img>` element's decoded bytes — we need the real
 * blob with its MIME type. In Electron we fall back to an IPC call that
 * writes via `clipboard.writeImage` when the web API is unavailable or
 * permission is denied (e.g. older Electron permission allowlist).
 */

export async function copyImageToClipboard(url: string): Promise<void> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`Failed to fetch image (${res.status})`);
  const blob = await res.blob();
  const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/png";

  // Try Electron IPC fallback first if available: more reliable across origins
  // and does not require a clipboard-write permission prompt.
  const desktop = (window as unknown as { desktopAPI?: { clipboard?: { writeImage?: (buffer: ArrayBuffer, type: string) => Promise<void> } } }).desktopAPI;
  if (desktop?.clipboard?.writeImage) {
    try {
      const buffer = await blob.arrayBuffer();
      await desktop.clipboard.writeImage(buffer, type);
      return;
    } catch {
      // fall through to web clipboard
    }
  }

  // Web Clipboard API
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const item = new ClipboardItem({ [type]: blob });
    await navigator.clipboard.write([item]);
    return;
  }

  // Fallback: try to write as png via canvas (legacy)
  throw new Error("Clipboard image copy is not supported in this environment.");
}
