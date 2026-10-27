import { BrowserWindow, nativeImage, type NativeImage } from "electron";

/**
 * Turns whatever image format a URL serves into a `NativeImage` an OS notification can show.
 *
 * `nativeImage` only reads PNG and JPEG, but avatars and pictures are routinely WebP, and some avatars are SVG.
 * Chromium reads all of them, so the bytes are handed to a hidden, sandboxed window that draws them onto a
 * canvas and hands back a PNG. The window is made on first use and closed after a quiet spell, so an app that
 * rarely notifies doesn't carry a spare renderer.
 */

const IDLE_CLOSE_MS = 30_000;
/** Bigger than this isn't worth decoding for a thumbnail. */
const MAX_BYTES = 12 * 1024 * 1024;

let decoder: BrowserWindow | null = null;
let ready: Promise<BrowserWindow> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleClose(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (decoder && !decoder.isDestroyed()) decoder.destroy();
    decoder = null;
    ready = null;
  }, IDLE_CLOSE_MS);
  closeTimer.unref?.();
}

function decoderWindow(): Promise<BrowserWindow> {
  if (decoder && !decoder.isDestroyed() && ready) return ready;
  const win = new BrowserWindow({
    show: false,
    width: 16,
    height: 16,
    skipTaskbar: true,
    focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  decoder = win;
  win.on("closed", () => {
    if (decoder === win) {
      decoder = null;
      ready = null;
    }
  });
  ready = win.loadURL("data:text/html;charset=utf-8,<!doctype html><meta charset=utf-8>").then(() => win);
  return ready;
}

/** Runs in the decoder window: draws the image centred and cropped to a `size` square, answers with a PNG data URL. */
const DRAW = `(async (base64, mime, size) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth || size;
    const h = img.naturalHeight || size;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const scale = Math.max(size / w, size / h);
    const dw = w * scale;
    const dh = h * scale;
    canvas.getContext("2d").drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
})`;

async function viaChromium(bytes: Buffer, mime: string, size: number): Promise<NativeImage | undefined> {
  const win = await decoderWindow();
  const png = (await win.webContents.executeJavaScript(
    `${DRAW}(${JSON.stringify(bytes.toString("base64"))}, ${JSON.stringify(mime)}, ${size})`
  )) as unknown;
  scheduleClose();
  if (typeof png !== "string") return undefined;
  const image = nativeImage.createFromDataURL(png);
  return image.isEmpty() ? undefined : image;
}

/**
 * The picture at `url` as a square `size` px image (cropped to fill), or undefined when it can't be fetched or
 * read. A toast without a picture is still a good toast, so nothing here throws.
 */
export async function fetchSquareImage(url: string, size: number): Promise<NativeImage | undefined> {
  try {
    if (!url.startsWith("https://")) return undefined;
    const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return undefined;
    const mime = response.headers.get("content-type")?.split(";")[0].trim() || "image/png";

    // PNG and JPEG need no help; `isEmpty` is how `nativeImage` says it can't read the rest.
    const direct = nativeImage.createFromBuffer(bytes);
    if (!direct.isEmpty()) {
      const { width, height } = direct.getSize();
      if (width === height) return direct.resize({ width: size, height: size });
    }
    return await viaChromium(bytes, mime, size);
  } catch {
    return undefined;
  }
}
