import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Menu, nativeImage, screen, session, shell, systemPreferences, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { applyChannelIdentity } from "./appIdentity";
import * as backgroundNotifier from "./backgroundNotifier";
import { REPO, resolveRunningChannel } from "./channels";
import richPresence from "./richPresence";
import systemAudio from "./systemAudio";
import updater from "./updater";

const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases`;

const isDev = !!process.env.ELECTRON_START_URL;

/**
 * Which build this is: Stable, PTB, Canary or Development (see
 * electron/channels.ts). Decides the window/tray icon, the name the app
 * excludes from its own system-audio capture, and — via electron/updater.ts —
 * which releases it updates from.
 */
const channel = resolveRunningChannel({
  appPath: app.getAppPath(),
  isPackaged: app.isPackaged,
});

// Before anything else: this decides the app's name, its data directory and
// (through that directory) its single-instance lock, so it has to run before
// any of the three is read. See electron/appIdentity.ts for why a channel that
// skips it can't start at all while Stable is running.
applyChannelIdentity(channel);

const PRELOAD = path.join(__dirname, "preload.js");

// MIME types for the static file server (production only)
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".webp": "image/webp",
  ".txt": "text/plain",
  // Soundboard clips: the built-in ones ship in out/sounds and are fetched by
  // <audio>, which needs a real audio content type rather than the
  // octet-stream fallback below.
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".weba": "audio/webm",
  ".flac": "audio/flac",
};

// Linux: capture the virtual sink's monitor with parec/pw-record and stream
// interleaved Float32 PCM (48 kHz stereo) to the renderer over IPC. The
// renderer injects it through an AudioWorklet → MediaStreamAudioDestinationNode,
// mirroring the macOS ScreenCaptureKit pipeline below.
let linuxAudioSender: Electron.WebContents | null = null;
const unsubLinuxAudio = systemAudio.onAudioData((data) => {
  if (linuxAudioSender && !linuxAudioSender.isDestroyed()) {
    linuxAudioSender.send("system-audio-linux:audio", data);
  }
});

// --- macOS system-audio helper (ScreenCaptureKit) ---------------------------
// Spawned on demand; streams raw interleaved Float32 PCM (48 kHz stereo) on
// stdout. See native/SystemAudioCapture for the Swift source.
let macAudioChild: ChildProcess | null = null;
let macAudioEnabled = false;

function macAudioHelperPath(): string | null {
  const candidates = isDev
    ? [path.join(__dirname, "..", "native", "SystemAudioCapture", ".build", "release", "CrystalSystemAudio")]
    : [path.join(process.resourcesPath, "CrystalSystemAudio")];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Bundle ids / app names to keep OUT of the shared system-audio capture. */
function macAudioExclusions(): string {
  // Dev: Electron's bundle id + app name. Packaged: this channel's own bundle
  // id and product name — hardcoding Stable's would let a Canary install
  // capture its own output back into the call.
  return isDev
    ? "com.github.Electron,Electron"
    : `${channel.appId},${channel.productName}`;
}

function stopMacAudioChild(): void {
  macAudioEnabled = false;
  if (macAudioChild) {
    macAudioChild.kill("SIGTERM");
    macAudioChild = null;
  }
}

/** Copy a Buffer into a detached ArrayBuffer for structured-clone IPC. */
function toTransferable(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * Explicit window icon — mainly matters on Linux, where window managers
 * don't derive the taskbar/window icon from the packaged app the way
 * Windows/macOS do. Packaged builds ship their channel's icon as
 * `icon.png` via `extraResources` (see scripts/electron-builder-config.cjs),
 * so the name is the same whichever channel this is; dev mode reads the
 * channel's file straight out of `build/`.
 */
function appIconPath(): string | undefined {
  const candidate = isDev
    ? path.join(__dirname, "..", "build", channel.icon)
    : path.join(process.resourcesPath, "icon.png");
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * Where the user's custom stylesheet lives.
 *
 * Under `userData`, which is per-channel (see `applyChannelIdentity`) — a
 * stable release and a beta running side by side get their own, which is what
 * you want when the point of the file is to be experimented with.
 */
function customCssPath(): string {
  return path.join(app.getPath("userData"), "custom.css");
}

/**
 * The app icon sized for a tray/menu-bar slot.
 *
 * `new Tray(path)` uses the image at its natural size, and our icons ship at
 * 512px+ for the installer — which on macOS is drawn into the menu bar as-is,
 * swallowing the bar. macOS wants roughly an 18pt image, so it's drawn at 2x
 * and the buffer tagged as a Retina representation: the logical size stays
 * 18pt while the pixels stay sharp on a Retina display. Windows and Linux
 * both want 16px. Not a template image — templates are drawn from alpha
 * alone, which would reduce a full-colour logo to a solid blob.
 */
function trayIconImage(): Electron.NativeImage {
  const source = appIconPath();
  if (!source) return nativeImage.createEmpty();
  const image = nativeImage.createFromPath(source);
  if (image.isEmpty()) return nativeImage.createEmpty();
  if (process.platform === "darwin") {
    const retina = image.resize({ width: 36, height: 36, quality: "best" });
    return nativeImage.createFromBuffer(retina.toPNG(), { scaleFactor: 2 });
  }
  return image.resize({ width: 16, height: 16, quality: "best" });
}

/**
 * Both windows are frameless (no native titlebar/menu — the renderer draws
 * its own, see TopNav / SettingsShell's window-controls row) but NOT
 * transparent. `transparent: true` disables the OS drop shadow and (on
 * Windows) `thickFrame`, so the window would render with hard edges and no
 * shadow at all; leaving the window opaque keeps the native chrome — shadow,
 * rounded corners on Win11, Aero snap — while still hiding the default
 * titlebar.
 */
const FRAMELESS_WINDOW_OPTIONS = {
  frame: false,
  backgroundColor: "#09090b",
  hasShadow: true,
} as const;

/** Forwards native maximize/unmaximize so the custom titlebar's restore-vs-
 * maximize icon stays correct even when triggered by the OS (double-click
 * the titlebar, Aero snap, etc.) instead of only our own button. */
function wireWindowStateEvents(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send("window:maximized-changed", win.isMaximized());
  };
  win.on("maximize", send);
  win.on("unmaximize", send);
}

let mainWindow: BrowserWindow | null = null;

// Set right before any *real* quit path (tray "Quit", OS shutdown, Cmd+Q on
// mac) so the main window's `close` handler below knows to let it through
// instead of hiding it — see the tray/background-notifications setup in
// app.whenReady().
let isQuitting = false;

// ---------------------------------------------------------------------------
// crystal:// deep-link / OAuth callback handling
//
// The app registers crystal:// as its default protocol client. When the OS
// browser completes an OAuth flow and redirects to crystal://auth/callback,
// the OS opens (or focuses) this app and passes the URL. We forward it to
// the renderer via IPC so Clerk can complete the auth handshake.
// ---------------------------------------------------------------------------

let pendingProtocolUrl: string | null = null;

// Windows / Linux: crystal:// may arrive as a CLI argument on a fresh launch
// (the OS re-runs the app with the URL as an argv entry).
const crystalArgUrl = process.argv.find((a) => a.startsWith("crystal://"));
if (crystalArgUrl) pendingProtocolUrl = crystalArgUrl;

// macOS: crystal:// URLs arrive via the open-url event, which fires both
// when the app is already running and when it is launched fresh.
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleCrystalUrl(url);
  } else {
    pendingProtocolUrl = url;
  }
});

// Enforce a single app instance so that crystal:// redirects from the system
// browser always land in the existing window rather than a second process.
// Skipped in dev: Electron dev builds share an app identity and the lock would
// cause each new `bun dev` invocation to quit the process immediately.
if (!isDev) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", (_event, commandLine) => {
      const url = commandLine.find((a) => a.startsWith("crystal://"));
      if (url) handleCrystalUrl(url);
      else createOrFocusMainWindow();
    });
  }
}

function handleCrystalUrl(url: string): void {
  if (!url.startsWith("crystal://auth/callback")) return;
  createOrFocusMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("auth:callback", url);
  } else {
    // Window not yet ready — store and deliver on did-finish-load
    pendingProtocolUrl = url;
  }
}

// ---------------------------------------------------------------------------

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    autoHideMenuBar: true,
    icon: appIconPath(),
    ...FRAMELESS_WINDOW_OPTIONS,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // This window is hidden (not closed) while a call is active so calls
      // keep running from the tray (see the `close` handler below). Chromium
      // throttles timers on hidden pages, which can delay LiveKit's
      // signaling keep-alive enough for the server to think the client went
      // away and force a full reconnect — audibly dropping call audio for
      // everyone for a moment. Keep this window's timers unthrottled.
      backgroundThrottling: false,
    },
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_START_URL as string);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadURL("http://crystal.localhost/");
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Keep the app window on crystal.localhost. When Clerk initiates an OAuth
  // flow it navigates to an external provider — intercept that and open the
  // system browser instead. The callback returns via crystal:// and is
  // delivered to the renderer via IPC (see handleCrystalUrl above).
  win.webContents.on("will-navigate", (event, url) => {
    const isApp = isDev
      ? url.startsWith("http://localhost:")
      : url.startsWith("http://crystal.localhost");
    if (!isApp) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // If the app was launched via a crystal:// URL, forward it once the
  // renderer has finished loading so the IPC listener is registered.
  if (pendingProtocolUrl) {
    const pendingUrl = pendingProtocolUrl;
    pendingProtocolUrl = null;
    win.webContents.once("did-finish-load", () => {
      win.webContents.send("auth:callback", pendingUrl);
    });
  }

  // Closing the window (the X button, Alt+F4, etc.) hides it instead of
  // quitting — the app keeps running in the tray with background
  // notifications still active. Only an explicit quit (tray menu, OS
  // shutdown) actually tears the window down.
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });

  wireWindowStateEvents(win);
  mainWindow = win;
}

/** Shows/focuses the existing main window, or creates one if it was never
 * opened this run (or was actually destroyed — e.g. macOS's `activate` with
 * zero windows). Used by the tray's "Open" item, clicking the tray icon, and
 * clicking a background notification. */
function createOrFocusMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  createWindow();
}

let pipWindow: BrowserWindow | null = null;

/**
 * Opens the pop-out video window, or focuses it if already open (singleton
 * — only one tile can be popped out at a time). Not Document
 * Picture-in-Picture (Electron's bare `BrowserWindow` doesn't implement the
 * window-controller hooks that requires) and not a second LiveKit
 * connection (which would show up as a duplicate, silent participant to
 * everyone else in the call) — just a small always-on-top window that
 * displays whatever JPEG frames the main window streams to it over IPC. See
 * `pip:send-frame`/`pip:frame` below and `src/app/pip/page.tsx`.
 */
/** Tells the main window the pip window's actual current content size, so
 * it can capture frames at a resolution that matches instead of a fixed
 * guess — capturing smaller than the window means the browser upscales a
 * low-res JPEG to fill it, which is what caused the pixelation. */
function reportPipSize(win: BrowserWindow): void {
  const { width, height } = win.getContentBounds();
  mainWindow?.webContents.send("pip:size", { width, height });
}

function createOrFocusPipWindow(options?: { width?: number; height?: number; title?: string }): void {
  if (pipWindow && !pipWindow.isDestroyed()) {
    if (options?.title) pipWindow.setTitle(options.title);
    pipWindow.focus();
    reportPipSize(pipWindow);
    return;
  }

  const win = new BrowserWindow({
    width: options?.width ?? 360,
    height: options?.height ?? 202,
    minWidth: 200,
    minHeight: 120,
    alwaysOnTop: true,
    frame: false,
    backgroundColor: "#000000",
    title: options?.title ?? channel.productName,
    icon: appIconPath(),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void win.loadURL(`${process.env.ELECTRON_START_URL as string}/pip`);
  } else {
    void win.loadURL("http://crystal.localhost/pip/");
  }

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  win.on("resize", () => reportPipSize(win));
  win.once("ready-to-show", () => reportPipSize(win));

  win.on("closed", () => {
    pipWindow = null;
    mainWindow?.webContents.send("pip:closed");
  });

  pipWindow = win;
}

app.whenReady().then(async () => {
  // Production: intercept http://crystal.localhost and serve the static
  // Next.js export from the out/ directory. This gives Clerk a stable,
  // fixed origin (unlike the old random-port serve-handler) so session
  // cookies survive app restarts.
  if (!isDev) {
    const outDir = path.join(__dirname, "..", "out");

    session.defaultSession.protocol.handle("http", async (request) => {
      const url = new URL(request.url);
      if (url.hostname !== "crystal.localhost") {
        // All production API traffic uses HTTPS; plain HTTP to any other
        // host is unexpected — return a clear error rather than proxying.
        return new Response("Bad Gateway", { status: 502 });
      }

      const pathname = url.pathname;
      let filePath: string;

      // next.config.ts has trailingSlash:true, so HTML routes are stored as
      // <route>/index.html. Static assets keep their own extension.
      if (path.extname(pathname)) {
        filePath = path.join(outDir, pathname);
      } else {
        filePath = path.join(outDir, pathname, "index.html");
      }

      if (!fs.existsSync(filePath)) {
        // Fallback to the root index (handles unknown deep-link paths)
        filePath = path.join(outDir, "index.html");
      }

      try {
        const content = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        return new Response(content, {
          headers: { "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    });
  }

  // Register crystal:// as the default protocol client so the OS routes
  // OAuth callback URLs (e.g. crystal://auth/callback?...) back to this app.
  //
  // Every channel claims the same scheme, deliberately: it's registered with
  // Clerk as an allowed redirect, so a per-channel scheme would break sign-in
  // everywhere but Stable. Because this runs on every launch, the channel the
  // user most recently started owns the scheme — which is the one they're
  // signing in to. Worth knowing now that channels have their own sessions: a
  // callback delivered to a channel with no sign-in in flight simply does
  // nothing, and the flow can be restarted from the right one.
  app.setAsDefaultProtocolClient("crystal");

  const ses = session.defaultSession;

  // Prime pactl / recorder detection so the first share starts faster.
  void systemAudio.warmUp().catch(() => {});

  // Grant media + display capture for the renderer (LiveKit + screen share),
  // plus clipboard-write for the invite-code copy button (navigator.clipboard
  // .writeText is gated behind the "clipboard-sanitized-write" permission —
  // without it Chromium rejects every write with NotAllowedError).
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = [
      "media",
      "display-capture",
      "notifications",
      "fullscreen",
      "clipboard-sanitized-write",
    ];
    callback(allowed.includes(permission));
  });

  // `getDisplayMedia` (and clipboard writes) perform a permission *check*
  // before the request; without an allowlist here the check is denied and
  // the request handler above never even runs.
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return ["media", "display-capture", "fullscreen", "clipboard-sanitized-write", "notifications"].includes(permission);
  });

  // The custom screen-share picker (see ScreenSharePicker.tsx) tells us which
  // source the user chose via `screen-share:set-source` right before LiveKit
  // calls `getDisplayMedia`. This handler resolves that pending source; with no
  // selection we fall back to the primary display.
  let pendingDisplaySourceId: string | null = null;
  ipcMain.handle("screen-share:set-source", (_event, id: string) => {
    pendingDisplaySourceId = typeof id === "string" && id.length > 0 ? id : null;
    return true;
  });

  ses.setDisplayMediaRequestHandler((request, callback) => {
    const requestedId = pendingDisplaySourceId;
    pendingDisplaySourceId = null;
    void desktopCapturer
      .getSources({ types: ["screen", "window"] })
      .then((sources) => {
        const primaryId = String(screen.getPrimaryDisplay().id);
        const selected =
          (requestedId && sources.find((s) => s.id === requestedId)) ??
          sources.find((s) => s.display_id === primaryId) ??
          sources.find((s) => s.display_id !== "") ??
          sources[0];
        if (!selected) {
          callback({});
          return;
        }

        // System audio ("share system audio") is captured through a
        // getDisplayMedia() request on Windows only: `src/lib/system-audio.ts`
        // makes a throwaway video+audio request and discards the video track,
        // and this handler answers it with Electron's native WASAPI loopback
        // capture. Linux captures the virtual sink's monitor directly with
        // `parec`/`pw-record` instead (see systemAudio + system-audio-linux IPC
        // below) — the experimental Chromium loopback was unreliable
        // (choppy/crackly and silent until the default sink was touched).
        // macOS uses its own ScreenCaptureKit helper (see systemAudioMac IPC
        // below) and never sets `audioRequested` through this handler.
        const wantsLoopbackAudio = request.audioRequested && process.platform === "win32";

        callback({
          video: selected,
          ...(wantsLoopbackAudio ? { audio: "loopback" as const } : {}),
        });
      })
      .catch(() => callback({}));
  }, { useSystemPicker: false });

  // Enumerate shareable screens/windows (with thumbnails) for the custom picker.
  ipcMain.handle("screen-share:get-sources", async () => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith("screen") ? "screen" : "window",
      displayId: s.display_id,
      thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
    }));
  });

  /**
   * Whether macOS will actually let us enumerate screens.
   *
   * Without Screen Recording permission `getSources` doesn't fail — it returns
   * an empty array, which is indistinguishable from a machine with nothing to
   * share, so the picker used to sit there reading "No shareable screens or
   * windows found". This is what lets it say something true instead.
   *
   * Worth knowing that macOS ties the grant to the app's code signature, not
   * just its bundle id: re-signing Crystal with a different identity silently
   * invalidates an existing grant, and the stale entry can still appear ticked
   * in System Settings while capture returns nothing.
   *
   * Only macOS gates this — everywhere else the answer is always yes.
   */
  ipcMain.handle("screen-share:permission", () => {
    if (process.platform !== "darwin") return "granted";
    return systemPreferences.getMediaAccessStatus("screen");
  });

  /** Open System Settings straight to Screen & System Audio Recording. macOS
   * offers no API to *request* this permission, so pointing the user at the
   * right pane is as far as an app can go. */
  ipcMain.handle("screen-share:open-permission-settings", async () => {
    if (process.platform !== "darwin") return false;
    try {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      );
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("app:info", () => ({
    platform: process.platform,
    channel: channel.id,
    channelLabel: channel.label,
    productName: channel.productName,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  /**
   * The user's custom stylesheet, as a real file in the app's data directory.
   *
   * A file rather than a preference blob because that's what a stylesheet is:
   * it can be opened in an editor, kept in version control, copied between
   * machines, and — most usefully — fixed from outside the app when a rule in
   * it has made the UI unusable. The renderer keeps a copy in `localStorage`
   * so the web build has the same feature and so the first paint doesn't wait
   * on IPC; this is the copy that survives a reinstall.
   */
  ipcMain.handle("custom-css:read", () => {
    try {
      return fs.readFileSync(customCssPath(), "utf8");
    } catch {
      // Not written yet, or unreadable. Either way the answer is "no styles".
      return "";
    }
  });

  ipcMain.handle("custom-css:write", (_event, css: string) => {
    const file = customCssPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof css === "string" ? css : "", "utf8");
    return file;
  });

  /** Where that file lives, so the UI can tell the user where to look. */
  ipcMain.handle("custom-css:path", () => customCssPath());

  ipcMain.handle("custom-css:reveal", async () => {
    const file = customCssPath();
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "", "utf8");
    }
    shell.showItemInFolder(file);
    return true;
  });

  ipcMain.handle("pip:open", (_event, options?: { width?: number; height?: number; title?: string }) => {
    createOrFocusPipWindow(options);
    return true;
  });
  ipcMain.handle("pip:close", () => {
    if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
    pipWindow = null;
  });
  // Fire-and-forget frame relay: the main window captures the focused tile's
  // video to a canvas and streams JPEG data URLs here at a modest rate; this
  // just forwards each one to the pip window's renderer to draw.
  ipcMain.on("pip:send-frame", (_event, dataUrl: string) => {
    if (pipWindow && !pipWindow.isDestroyed()) {
      pipWindow.webContents.send("pip:frame", dataUrl);
    }
  });

  // Custom titlebar controls — frameless windows have no native ones. Each
  // handler acts on whichever window actually sent the request, so the main
  // window and the Settings window each control themselves independently.
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("window:is-maximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });

  // Settings -> Accessibility -> Zoom. Each renderer sets its own window's
  // factor (the Settings window and the main window each apply the stored
  // value on load), which is why this acts on the sender rather than every
  // window. Clamped to the range the UI offers so a hand-edited stored value
  // can't shrink the app to something unclickable.
  ipcMain.handle("window:set-zoom", (event, factor: number) => {
    const clamped = Math.min(2, Math.max(0.5, Number(factor) || 1));
    event.sender.setZoomFactor(clamped);
    return clamped;
  });

  // Tray icon: lets the app keep running (and keep watching for
  // notifications) after the window is closed, per the `close` handler in
  // createWindow() above.
  const tray = new Tray(trayIconImage());
  tray.setToolTip(channel.productName);
  // Without this macOS swallows the first click of a double-click and delays
  // the menu; the tray has no double-click behaviour to preserve.
  if (process.platform === "darwin") tray.setIgnoreDoubleClickEvents(true);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${channel.productName}`, click: () => createOrFocusMainWindow() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  tray.on("click", () => createOrFocusMainWindow());

  backgroundNotifier.init({
    getMainWindow: () => mainWindow,
    onNavigate: (target) => {
      mainWindow?.webContents.send("notifications:navigate", target);
    },
  });

  ipcMain.handle(
    "notifications:configure",
    (_event, url: string, token: string | null, userId: string | null) => {
      backgroundNotifier.configure(url, token, userId);
    }
  );
  ipcMain.handle(
    "notifications:set-active-view",
    (_event, view: { kind: "conversation" | "channel"; id: string } | null) => {
      backgroundNotifier.setActiveView(view);
    }
  );

  updater.init();
  updater.onStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("updater:state-changed", state);
    }
  });
  ipcMain.handle("updater:state", () => updater.getState());
  ipcMain.handle("updater:check", () => updater.check());
  ipcMain.handle("updater:download", () => updater.download());
  ipcMain.handle("updater:install", () => updater.quitAndInstall());
  ipcMain.handle("updater:open-releases", () => shell.openExternal(RELEASES_URL));

  ipcMain.handle("system-audio:enable", () => systemAudio.enable());
  ipcMain.handle("system-audio:disable", () => systemAudio.disable());
  ipcMain.handle("system-audio:info", () => systemAudio.getInfo());

  ipcMain.handle("system-audio-linux:enable", async (event) => {
    linuxAudioSender = event.sender;
    try {
      await systemAudio.enable();
      await systemAudio.startCapture();
      return {
        started: true,
        sampleRate: 48000,
        channels: 2,
        playbackSink: systemAudio.getPlaybackSink(),
      };
    } catch (err) {
      await systemAudio.disable().catch(() => {});
      linuxAudioSender = null;
      return {
        started: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("system-audio-linux:disable", async () => {
    linuxAudioSender = null;
    await systemAudio.disable();
    return { stopped: true };
  });

  ipcMain.handle("system-audio-linux:info", async () => {
    const state = await systemAudio.getInfo();
    return {
      running: state.captureRunning,
      recorder: systemAudio.getRecorder(),
      playbackSink: state.playbackSink,
    };
  });

  ipcMain.handle("system-audio-linux:list-apps", () => systemAudio.listAudioApps());

  ipcMain.handle(
    "system-audio-linux:set-mode",
    (_event, mode: "system" | "app", appIds: string[] = []) => systemAudio.setMode(mode, appIds)
  );

  // macOS: ScreenCaptureKit helper.
  ipcMain.handle("system-audio-mac:enable", (event) => {
    if (macAudioEnabled && macAudioChild) {
      return { started: true, sampleRate: 48000, channels: 2 };
    }
    const helper = macAudioHelperPath();
    if (!helper) {
      return { started: false, error: "SystemAudioCapture helper is not bundled on this build." };
    }

    const sender = event.sender;
    const child = spawn(
      helper,
      [
        "--exclude",
        macAudioExclusions(),
        "--rate",
        "48000",
        "--channels",
        "2",
        "--app-name",
        app.getName(),
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    macAudioChild = child;

    child.stderr?.on("data", (d: Buffer) => console.error("[system-audio-mac]", d.toString().trim()));

    return new Promise<{ started: boolean; sampleRate?: number; channels?: number; error?: string }>(
      (resolve) => {
        let settled = false;
        let acc = Buffer.alloc(0);

        const finish = (ok: boolean, extra: Record<string, unknown>) => {
          if (settled) return;
          settled = true;
          if (!ok) stopMacAudioChild();
          resolve({ started: ok, ...extra });
        };

        const onStdout = (chunk: Buffer) => {
          if (settled) return;
          acc = Buffer.concat([acc, chunk]);
          const nl = acc.indexOf(0x0a);
          if (nl === -1) return;
          const line = acc.subarray(0, nl).toString("utf8");
          const rest = acc.subarray(nl + 1);
          child.stdout?.removeListener("data", onStdout);

          let parsed: { event?: string; message?: string; sampleRate?: number; channels?: number };
          try {
            parsed = JSON.parse(line);
          } catch {
            parsed = { event: "error", message: `Malformed helper output: ${line}` };
          }

          if (parsed.event === "start") {
            macAudioEnabled = true;
            finish(true, {
              sampleRate: parsed.sampleRate ?? 48000,
              channels: parsed.channels ?? 2,
            });
            if (rest.length > 0) {
              sender.send("system-audio-mac:audio", toTransferable(rest));
            }
            child.stdout?.on("data", (c: Buffer) => {
              if (!macAudioEnabled) return;
              sender.send("system-audio-mac:audio", toTransferable(c));
            });
          } else {
            finish(false, { error: parsed.message ?? "Helper failed to start." });
          }
        };

        child.stdout?.on("data", onStdout);
        child.on("error", (err) => finish(false, { error: `Failed to launch helper: ${err.message}` }));
        child.on("exit", (code) =>
          finish(false, { error: `Helper exited before start (code ${code}).` })
        );
      }
    );
  });

  ipcMain.handle("system-audio-mac:disable", () => {
    stopMacAudioChild();
    return { stopped: true };
  });

  ipcMain.handle("system-audio-mac:info", () => ({
    running: macAudioEnabled,
    helper: macAudioHelperPath(),
  }));

  // Rich Presence: detected game / now-playing music, plus the
  // Discord-compatible IPC socket games push activities to. Broadcast to
  // every window (not just the main one) so the Settings window's diagnostics
  // stay live too. Started in the background — downloading Discord's
  // detectables catalog on a cold cache shouldn't hold up the first paint.
  richPresence.onChange((activities) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("rich-presence:changed", activities);
    }
  });
  void richPresence.start().catch((err) => {
    console.warn("[rich-presence] failed to start:", err);
  });

  ipcMain.handle("rich-presence:get", () => richPresence.getActivities());
  ipcMain.handle("rich-presence:status", () => richPresence.getStatus());
  ipcMain.handle("rich-presence:set-enabled", (_event, enabled: boolean) => {
    richPresence.setEnabled(!!enabled);
    return richPresence.getStatus();
  });

  createWindow();

  app.on("activate", () => createOrFocusMainWindow());
});

// The main window hides instead of closing (see its `close` handler above),
// so the app now only quits via the tray's "Quit" item or the OS itself —
// never just because every window happened to be hidden/closed.
app.on("window-all-closed", () => {});

app.on("before-quit", () => {
  isQuitting = true;
  linuxAudioSender = null;
  unsubLinuxAudio();
  void systemAudio.disable();
  stopMacAudioChild();
  richPresence.stop();
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});
