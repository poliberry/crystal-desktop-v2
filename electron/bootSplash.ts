import { BrowserWindow, nativeImage } from "electron";
import * as fs from "node:fs";

/**
 * The window shown while the app starts: the logo, what is happening, and a progress bar.
 *
 * It is the same window whether the app is simply loading or is updating itself on the way in (see
 * `Updater.runLaunchUpdate`), so a launch is one continuous thing on screen — splash, maybe "Downloading 1.2.3…", then the
 * app — rather than a blank frame, a flash, and a window that appears whenever it is ready.
 *
 * Plain HTML in a data URL with no preload: nothing from the app is loaded into it, and the only thing sent to it is the
 * text and the percentage, as JSON.
 */

export interface BootSplash {
  /** `progress` is 0–100, or null for a bar that just moves (checking, installing, loading). */
  setStatus(text: string, progress?: number | null): void;
  close(): void;
  readonly window: BrowserWindow;
}

const html = (appName: string, version: string, logo: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; background: #0b0b10; color: #f3f3f6; overflow: hidden; user-select: none; -webkit-user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; -webkit-app-region: drag; }
  img { width: 76px; height: 76px; border-radius: 18px; ${logo ? "" : "display:none;"} }
  h1 { margin: 16px 0 0; font-size: 17px; font-weight: 600; letter-spacing: .01em; }
  .ver { margin-top: 3px; font-size: 11px; color: #6f7080; }
  .bar { position: relative; width: 220px; height: 3px; margin-top: 26px; border-radius: 3px; background: #1d1d27; overflow: hidden; }
  .fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: 3px; background: #8b7cff; transition: width .25s ease; }
  .bar.busy .fill { width: 38%; animation: slide 1.15s ease-in-out infinite; }
  @keyframes slide { 0% { left: -40%; } 100% { left: 102%; } }
  .status { margin-top: 12px; min-height: 15px; font-size: 12px; color: #9a9bad; }
</style></head><body>
  ${logo ? `<img src="${logo}" alt="">` : ""}
  <h1>${appName}</h1>
  <div class="ver">${version ? `v${version}` : ""}</div>
  <div class="bar busy" id="bar"><div class="fill" id="fill"></div></div>
  <div class="status" id="status">Starting…</div>
  <script>
    window.__set = (text, progress) => {
      document.getElementById("status").textContent = text;
      const bar = document.getElementById("bar");
      if (progress == null) { bar.classList.add("busy"); document.getElementById("fill").style.width = ""; }
      else { bar.classList.remove("busy"); document.getElementById("fill").style.width = Math.max(0, Math.min(100, progress)) + "%"; }
    };
  </script>
</body></html>`;

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

export function showBootSplash(options: { appName: string; version: string; iconPath?: string }): BootSplash {
  let logo = "";
  try {
    if (options.iconPath && fs.existsSync(options.iconPath)) {
      const image = nativeImage.createFromPath(options.iconPath);
      if (!image.isEmpty()) logo = image.resize({ width: 152, height: 152, quality: "best" }).toDataURL();
    }
  } catch {
    // No logo is better than no splash.
  }

  const win = new BrowserWindow({
    width: 340,
    height: 280,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    movable: true,
    center: true,
    show: false,
    skipTaskbar: true,
    backgroundColor: "#0b0b10",
    roundedCorners: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.setMenuBarVisibility(false);

  let loaded = false;
  // Status set before the page exists is held and applied when it does.
  let pending: { text: string; progress: number | null } | null = null;
  const apply = (text: string, progress: number | null) => {
    if (win.isDestroyed()) return;
    void win.webContents
      .executeJavaScript(`window.__set(${JSON.stringify(text)}, ${JSON.stringify(progress)})`)
      .catch(() => {});
  };

  win.webContents.once("did-finish-load", () => {
    loaded = true;
    if (pending) apply(pending.text, pending.progress);
    pending = null;
    if (!win.isDestroyed()) win.show();
  });
  // Never navigate anywhere or open anything: it is a status display.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html(escapeHtml(options.appName), escapeHtml(options.version), logo))}`,
  );

  return {
    window: win,
    setStatus(text, progress = null) {
      if (!loaded) pending = { text, progress };
      else apply(text, progress);
    },
    close() {
      if (!win.isDestroyed()) win.destroy();
    },
  };
}
