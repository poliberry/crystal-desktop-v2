import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, Menu, nativeImage, nativeTheme, screen, session, shell, systemPreferences, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { applyAppIdentity } from "./appIdentity";
import * as backgroundNotifier from "./backgroundNotifier";
import { appIdentity, CHANNELS, REPO, resolveRunningApp, resolveRunningChannel, type AppKind } from "./channels";
import { isAppLink, parseDeepLink, parseStudioLink, STUDIO_PROTOCOL, type DeepLink } from "./deeplink";
import { LinkQueue, startsNewDocument } from "./linkQueue";
import richPresence from "./richPresence";
import systemAudio from "./systemAudio";
import { registerStudioBuild } from "./studioBuild";
import { registerStudioFs } from "./studioFs";
import { registerStudioTerminal } from "./studioTerminal";
import updater from "./updater";

const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases`;

const isDev = !!process.env.ELECTRON_START_URL;

/**
 * Chromium's own wheel animation, asked for rather than assumed.
 *
 * Chrome enables it; Electron does not always, and without it every wheel
 * notch is applied as an instant jump — which is what the whole app felt like
 * on Windows. The renderer animates the scrollers it owns (see
 * src/hooks/use-smooth-scroll.ts), but it can only do that where it has
 * attached a listener, and this covers everything else including native
 * scrollbars and keyboard scrolling.
 *
 * Must be set before the app is ready, which is why it is here rather than in
 * `whenReady`.
 */
app.commandLine.appendSwitch("enable-smooth-scrolling");
// Memory/performance: keep a generous renderer heap ceiling while retaining
// the explicit GC hook. A 256 MB ceiling makes Chromium spend startup time in
// GC (and can starve first paint) on Linux when the initial app bundle and
// signed-in data subscriptions are loaded together.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=512 --expose-gc");
app.commandLine.appendSwitch("disable-features", "Translate");

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

/**
 * Which application this process is: Crystal, or Crystal Studio — the same code, packaged twice (see
 * scripts/electron-builder-config.cjs). Studio is its own installed app: it opens only the Studio window, quits when that
 * is closed, and leaves everything that belongs to the chat client (tray, notifications, rich presence, audio capture)
 * to Crystal.
 */
const appKind = resolveRunningApp({ appPath: app.getAppPath() });
const isStudioApp = appKind === "studio";
const identity = appIdentity(channel, appKind);
/**
 * Whose icon files this run draws. A run from source shows the real app's artwork, not the Development channel's own
 * (a different colour, so installed builds can be told apart): what you see while building is what ships.
 */
const iconIdentity = !app.isPackaged && appKind === "crystal" ? appIdentity(CHANNELS.stable, "crystal") : identity;

// Before anything else: this decides the app's name, its data directory and
// (through that directory) its single-instance lock, so it has to run before
// any of the three is read. See electron/appIdentity.ts for why a channel that
// skips it can't start at all while Stable is running.
applyAppIdentity(channel, identity);

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
    : `${identity.appId},${identity.productName}`;
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
    ? path.join(__dirname, "..", "build", iconIdentity.icon)
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
 * Both windows draw their own titlebar (see TopNav / the editor's header) and
 * are NOT transparent. `transparent: true` disables the OS drop shadow and (on
 * Windows) `thickFrame`, so the window would render with hard edges and no
 * shadow at all; leaving the window opaque keeps the native chrome — shadow,
 * rounded corners on Win11, Aero snap — while still hiding the default
 * titlebar.
 *
 * On macOS the titlebar is hidden but the window keeps its frame, which keeps
 * the system's traffic lights — the renderer draws no window buttons there, and
 * leaves room for them (see `useWindowControls`). Everywhere else the window is
 * frameless and the renderer draws its own. The lights are inset from the
 * window's corner, with the sidebar's menus starting underneath them.
 */
const MAC_TRAFFIC_LIGHTS = { x: 20, y: 18 } as const;

const FRAMELESS_WINDOW_OPTIONS =
  process.platform === "darwin"
    ? ({
        titleBarStyle: "hidden",
        trafficLightPosition: MAC_TRAFFIC_LIGHTS,
        backgroundColor: "#09090b",
        hasShadow: true,
      } as const)
    : ({
        frame: false,
        backgroundColor: "#09090b",
        hasShadow: true,
      } as const);

/**
 * The same options for a window whose top bar isn't the main window's 48px: the
 * traffic lights are centred on the bar they sit in, whatever its height. A light is
 * 12px across, so its top edge is half the bar's height less six.
 */
function framelessFor(headerHeight: number) {
  if (process.platform !== "darwin") return FRAMELESS_WINDOW_OPTIONS;
  return {
    ...FRAMELESS_WINDOW_OPTIONS,
    trafficLightPosition: { x: MAC_TRAFFIC_LIGHTS.x, y: Math.round(headerHeight / 2 - 6) },
  } as const;
}

/** Forwards native maximize/unmaximize so the custom titlebar's restore-vs-
 * maximize icon stays correct even when triggered by the OS (double-click
 * the titlebar, Aero snap, etc.) instead of only our own button. */
function wireWindowStateEvents(win: BrowserWindow): void {
  const send = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("window:maximized-changed", win.isMaximized());
  };
  win.on("maximize", send);
  win.on("unmaximize", send);

  // The traffic lights go away in full screen, and the room the renderer left
  // for them with them.
  const sendFullScreen = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("window:fullscreen-changed", win.isFullScreen());
  };
  win.on("enter-full-screen", sendFullScreen);
  win.on("leave-full-screen", sendFullScreen);
}

let mainWindow: BrowserWindow | null = null;
/** Windows in an active call must remain unthrottled while hidden so audio,
 * video, and signalling continue. Everything else may return to Chromium's
 * normal background throttling after it has repainted on restore. */
const activeCallWebContents = new Set<number>();

// Set right before any *real* quit path (tray "Quit", OS shutdown, Cmd+Q on
// mac) so the main window's `close` handler below knows to let it through
// instead of hiding it — see the tray/background-notifications setup in
// app.whenReady().
let isQuitting = false;

// ---------------------------------------------------------------------------
// Deep links: crystal://… and https://usecrystal.app/… (see ./deeplink.ts)
//
// The app is the registered handler for crystal://, and an https link on our own site is one of
// ours too. They reach us five ways, and each ends in `handleCrystalUrl`:
//   - the OS launching us with the link as an argument (Windows / Linux, a cold start);
//   - `open-url` (macOS, a crystal:// link, running or not);
//   - `continue-activity` (macOS universal links: a usecrystal.app link clicked anywhere, once the
//     signed build carries the associated-domains entitlement for the domain);
//   - `second-instance` (Windows / Linux, a link opened while we are running);
//   - a click on one of our links inside the app itself, which never needs the browser.
// Anything `parseDeepLink` doesn't recognise is ignored: a link to someone else's site is never ours.
// ---------------------------------------------------------------------------

let pendingProtocolUrl: string | null = null;

// A link this application handles: Crystal's own kinds, or — for Studio — what `parseStudioLink` knows.
const isOurLink = (raw: string): boolean => (isStudioApp ? parseStudioLink(raw) !== null : parseDeepLink(raw) !== null);
const deepLinkArg = (args: readonly string[]) => args.find(isOurLink);

const startupLink = deepLinkArg(process.argv);
if (startupLink) pendingProtocolUrl = startupLink;

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) {
    handleCrystalUrl(url);
  } else {
    pendingProtocolUrl = url;
  }
});

app.on("continue-activity", (event, type, _userInfo, details) => {
  const url = (details as { webpageURL?: string } | undefined)?.webpageURL;
  if (isStudioApp || type !== "NSUserActivityTypeBrowsingWeb" || !url || !parseDeepLink(url)) return;
  event.preventDefault();
  if (app.isReady()) handleCrystalUrl(url);
  else pendingProtocolUrl = url;
});

// Enforce a single app instance so that a link opened while we are running always lands in the
// existing window rather than a second process. That is also how "open the other app" works: starting an app that is
// already running hands it the link and brings it forward.
//
// In development too. This used to be skipped there because every dev build shared one identity, so a second one would
// quit at once; Crystal and Crystal Studio now have their own names and data folders (see appIdentity.ts), so each has a
// lock of its own and the two coexist.
{
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
    app.on("second-instance", (_event, commandLine) => {
      const url = deepLinkArg(commandLine);
      if (url) handleCrystalUrl(url);
      else if (isStudioApp) createOrFocusStudioWindow();
      else createOrFocusMainWindow();
    });
  }
}

/**
 * Links wait here until the page can take them (see ./linkQueue.ts). A sign-in callback is the
 * exception: it is what signs the person in, so it goes as soon as the page has loaded.
 */
let linkWindow: BrowserWindow | null = null;
const links = new LinkQueue<DeepLink>((link) => {
  const win = linkWindow;
  if (!win || win.isDestroyed()) return;
  if (link.kind === "invite") win.webContents.send("invite:open", link.code);
  else if (link.kind === "authorize") win.webContents.send("install:open", link.search);
});

function sendDeepLink(win: BrowserWindow, link: DeepLink): void {
  if (link.kind === "open") return;
  if (link.kind === "auth") {
    const send = () => win.webContents.send("auth:callback", link.url);
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
    else send();
    return;
  }
  linkWindow = win;
  links.push(link);
}

/**
 * Route a link to the renderer: `crystal://auth/callback?…` completes a sign-in, an invite opens
 * the join dialog, `…/oauth/authorize?…` opens the add-a-bot / add-an-extension flow. Shared links
 * are the https ones, because they mean something in a browser, on a phone and in every other chat
 * app; the scheme is the hand-off from a web page to an installed app.
 */
function handleCrystalUrl(url: string): void {
  if (isStudioApp) return handleStudioUrl(url);
  const link = parseDeepLink(url);
  if (!link) return;

  createOrFocusMainWindow();
  if (link.kind === "open") return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingProtocolUrl = url;
    return;
  }
  sendDeepLink(mainWindow, link);
}

/** Studio's links: bring it forward, and finish a sign-in that came back through the browser. */
function handleStudioUrl(url: string): void {
  const link = parseStudioLink(url);
  if (!link) return;
  createOrFocusStudioWindow();
  if (!studioWindow || studioWindow.isDestroyed()) {
    pendingProtocolUrl = url;
    return;
  }
  if (link.kind === "auth") sendDeepLink(studioWindow, { kind: "auth", url: link.url });
}

ipcMain.on("deeplink:ready", (event) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  linkWindow = mainWindow;
  links.markReady();
});

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
      // Only disable throttling while a call is active (renderer notifies via
      // IPC `call:active`). Idle = throttled → saves ~200-400MB on low-end
      // hardware where hidden-window timers + Convex subscriptions otherwise
      // keep the renderer hot.
      backgroundThrottling: true,
      spellcheck: false,
      enableWebSQL: false,
    },
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_START_URL as string);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadURL("http://crystal.localhost/");
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    // One of our own links (an invite, an add-a-bot link) opens right here, not in the browser.
    if (isAppLink(url)) {
      handleCrystalUrl(url);
    } else if (url.startsWith("https:") || url.startsWith("http:")) {
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
      if (isAppLink(url)) handleCrystalUrl(url);
      else void shell.openExternal(url);
    }
  });

  // A new page has no link handlers until it says so: whatever arrives now waits for its "ready".
  // Only a real page load counts. `did-start-loading` also fires for iframes and for the router's
  // pushState, neither of which discards the page, so using it left links stuck for good.
  links.reset();
  win.webContents.on("did-start-navigation", (details) => {
    if (startsNewDocument(details)) links.reset();
  });

  // If the app was launched via a crystal:// URL, forward it once the
  // renderer has finished loading so the IPC listener is registered.
  if (pendingProtocolUrl) {
    const pendingUrl = pendingProtocolUrl;
    pendingProtocolUrl = null;
    const link = parseDeepLink(pendingUrl);
    if (link) sendDeepLink(win, link);
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

  // A throttled Chromium renderer can take several seconds to schedule its
  // first composite after Windows restores/minimises it, particularly when
  // several blurred surfaces must be redrawn on an integrated GPU. Ask for a
  // fresh paint immediately and briefly lift throttling. The one-second grace
  // period only applies to non-call windows; afterwards normal idle savings
  // resume, including the next time the window is minimised.
  let restoreTimer: ReturnType<typeof setTimeout> | null = null;
  const refreshAfterRestore = () => {
    if (win.isDestroyed()) return;
    if (restoreTimer) clearTimeout(restoreTimer);
    const id = win.webContents.id;
    if (!activeCallWebContents.has(id)) {
      try {
        (win.webContents as unknown as { setBackgroundThrottling: (v: boolean) => void })
          .setBackgroundThrottling(false);
      } catch { /* ignore */ }
    }
    try { win.webContents.invalidate(); } catch { /* ignore */ }
    restoreTimer = setTimeout(() => {
      restoreTimer = null;
      if (win.isDestroyed() || activeCallWebContents.has(id)) return;
      try {
        (win.webContents as unknown as { setBackgroundThrottling: (v: boolean) => void })
          .setBackgroundThrottling(true);
      } catch { /* ignore */ }
    }, 1_000);
  };
  win.on("show", refreshAfterRestore);
  win.on("restore", refreshAfterRestore);
  win.on("minimize", () => {
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = null;
  });
  // The id is read now, not in the handler: by the time `closed` fires the window and its
  // webContents are destroyed, and touching either throws "Object has been destroyed" — which
  // Electron shows as an error dialog, on every quit.
  const webContentsId = win.webContents.id;
  win.on("closed", () => {
    activeCallWebContents.delete(webContentsId);
    // Don't leave a reference to a destroyed window for later code to trip over.
    if (mainWindow === win) mainWindow = null;
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
/** Send to the main window if there still is one. During quit the pip window and the tray can
 * outlive it by a moment, and sending to a destroyed window throws. */
function sendToMain(channel: string, ...args: unknown[]): void {
  const win = mainWindow;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, ...args);
}

/** Tells the main window the pip window's actual current content size, so
 * it can capture frames at a resolution that matches instead of a fixed
 * guess — capturing smaller than the window means the browser upscales a
 * low-res JPEG to fill it, which is what caused the pixelation. */
function reportPipSize(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const { width, height } = win.getContentBounds();
  sendToMain("pip:size", { width, height });
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
    title: options?.title ?? identity.productName,
    icon: appIconPath(),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
      spellcheck: false,
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
    sendToMain("pip:closed");
  });

  pipWindow = win;
}

let editorWindow: BrowserWindow | null = null;
let adminWindow: BrowserWindow | null = null;
let studioWindow: BrowserWindow | null = null;

function createOrFocusAdminWindow(): void {
  if (adminWindow && !adminWindow.isDestroyed()) {
    adminWindow.show();
    adminWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    autoHideMenuBar: true,
    icon: appIconPath(),
    ...framelessFor(44),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: true,
      spellcheck: false,
    },
  });

  const url = isDev
    ? `${process.env.ELECTRON_START_URL as string}/admin`
    : "http://crystal.localhost/admin/";
  void win.loadURL(url);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  wireWindowStateEvents(win);
  win.on("closed", () => {
    adminWindow = null;
  });
  adminWindow = win;
}

/** Crystal Studio's window, in the Crystal Studio application: a creator's workspace — a design tool wants the whole
 * screen. A singleton, like the editor and the console. */
/** Studio's title bar is its menu bar: 30px, as Illustrator's is. Keep in step with `h-[30px]` on the
 * header in src/studio/shell/studio-app.tsx, or the traffic lights stop being centred on it. */
const STUDIO_TITLEBAR_HEIGHT = 30;

function createOrFocusStudioWindow(): void {
  // Only the Crystal Studio application has this window. Crystal opens that application instead (see `openApp`).
  if (!isStudioApp) return;
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    studioWindow.focus();
    return;
  }
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    autoHideMenuBar: true,
    icon: appIconPath(),
    ...framelessFor(STUDIO_TITLEBAR_HEIGHT),
    webPreferences: {
      preload: PRELOAD,
      // Tells the page it is Crystal Studio the application, not a window of Crystal (see `app` in preload.ts).
      additionalArguments: isStudioApp ? ["--crystal-app=studio"] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  void win.loadURL(isDev ? `${process.env.ELECTRON_START_URL as string}/studio` : "http://crystal.localhost/studio/");
  // Links out of Studio (docs, a creator's own pages) open in the browser, never in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Studio never leaves its own pages inside this window: a sign-in provider (or anything else) opens in the browser.
  win.webContents.on("will-navigate", (event, url) => {
    const ours = isDev ? url.startsWith("http://localhost:") : url.startsWith("http://crystal.localhost");
    if (ours) return;
    event.preventDefault();
    const link = parseStudioLink(url);
    if (link) handleStudioUrl(url);
    else if (url.startsWith("https:")) void shell.openExternal(url);
  });
  // Studio holds back a close that would throw away unsaved work (a `beforeunload` guard). Electron
  // blocks the close without a word unless told otherwise, so ask: Leave closes anyway.
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "warning",
      buttons: ["Leave", "Stay"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "You have changes in Studio that aren't saved.",
      detail: "If you leave now, they are lost.",
    });
    if (choice === 0) event.preventDefault();
  });
  wireWindowStateEvents(win);
  win.on("closed", () => {
    studioWindow = null;
  });
  studioWindow = win;

  // Launched by a link (a sign-in coming back, or Crystal's "Open Studio"): act on it once the page can take it.
  if (isStudioApp && pendingProtocolUrl) {
    const pending = pendingProtocolUrl;
    pendingProtocolUrl = null;
    const link = parseStudioLink(pending);
    if (link?.kind === "auth") sendDeepLink(win, { kind: "auth", url: link.url });
  }
}

/**
 * Open one of the two applications from the other (Crystal's Creator tab opens Studio; Studio's account menu opens
 * Crystal). They are separate programs, so this never makes a window of its own: it asks the operating system to start
 * the other one, or to bring it forward if it is already running.
 *
 *  - Installed: its `crystal://open` / `crystal-studio://open` link. The OS finds the program by its scheme, starts it if
 *    it isn't running, and a running one gets the link through its single-instance lock and comes to the front.
 *  - Not installed: say so and offer the download, rather than failing silently or opening something that isn't it.
 *  - Development: nothing is installed or registered, so this starts the other one itself from the same checkout. The
 *    single-instance lock is what turns a second start into "bring the running one forward".
 */
const APPS: Record<AppKind, { name: string; link: string }> = {
  crystal: { name: "Crystal", link: "crystal://open" },
  studio: { name: "Crystal Studio", link: `${STUDIO_PROTOCOL}://open` },
};

function launchDevApp(target: AppKind): void {
  const env: NodeJS.ProcessEnv = { ...process.env, CRYSTAL_APP: target };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(process.execPath, [app.getAppPath(), APPS[target].link], { env, detached: true, stdio: "ignore" }).unref();
}

async function openApp(target: AppKind): Promise<void> {
  if (target === appKind) {
    if (isStudioApp) createOrFocusStudioWindow();
    else createOrFocusMainWindow();
    return;
  }
  if (isDev) return launchDevApp(target);

  const { name, link } = APPS[target];
  if (app.getApplicationNameForProtocol(link)) {
    try {
      await shell.openExternal(link);
      return;
    } catch {
      // Registered but unable to start (moved or deleted since): treat it as not installed.
    }
  }
  const options: Electron.MessageBoxOptions = {
    type: "info",
    buttons: ["Download", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    title: `${name} isn't installed`,
    message: `${name} isn't installed on this computer.`,
    detail: `${name} is a separate app. Download it from the releases page, install it, and this will open it.`,
  };
  const focused = BrowserWindow.getFocusedWindow();
  const { response } = focused ? await dialog.showMessageBox(focused, options) : await dialog.showMessageBox(options);
  if (response === 0) await shell.openExternal(RELEASES_URL);
}

/**
 * Opens the cosmetic canvas editor in its own window, or focuses it and
 * points it at a different profile if one is already open.
 *
 * A normal, resizable, framed-by-us window rather than a dialog — a canvas
 * editor wants the room a dialog stealing most of the main window can't give
 * it without hiding everything else being edited. Singleton, like the pip
 * window: two editors open on two profiles at once is two windows fighting
 * over which one's save actually stuck.
 *
 * No IPC channel carries the profile itself. The window loads `/editor`,
 * which is this same app's own React tree — it queries Convex directly, the
 * same way the main window's dialogs did, and shares its session because
 * both windows are the same origin in the same (default) Electron session.
 * `scopeId`/`scopeName` in the query string are the only things that have to
 * cross the process boundary, because nothing else says *which* profile.
 */
function createOrFocusEditorWindow(options: {
  kind: "frame" | "decoration";
  scopeId?: string;
  scopeName?: string;
}): void {
  const params = new URLSearchParams({ kind: options.kind });
  if (options.scopeId) params.set("scope", options.scopeId);
  if (options.scopeName) params.set("scopeName", options.scopeName);

  if (editorWindow && !editorWindow.isDestroyed()) {
    editorWindow.focus();
    void editorWindow.loadURL(
      isDev
        ? `${process.env.ELECTRON_START_URL as string}/editor?${params}`
        : `http://crystal.localhost/editor/?${params}`,
    );
    return;
  }

  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    icon: appIconPath(),
    ...framelessFor(36),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void win.loadURL(`${process.env.ELECTRON_START_URL as string}/editor?${params}`);
  } else {
    void win.loadURL(`http://crystal.localhost/editor/?${params}`);
  }

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  wireWindowStateEvents(win);
  win.on("closed", () => {
    editorWindow = null;
  });

  editorWindow = win;
}

app.whenReady().then(async () => {
  // A packaged macOS app gets its Dock icon from its bundle. A run from source is the stock Electron app, whose icon is
  // Electron's, so set ours; Windows and Linux take the window icon (see `appIconPath`).
  if (!app.isPackaged && process.platform === "darwin" && app.dock) {
    const dockIcon = nativeImage.createFromPath(path.join(__dirname, "..", "build", iconIdentity.macIcon));
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon);
  }

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

      try {
        // The renderer asks for many startup chunks in parallel. Synchronous
        // disk reads here run on Electron's main thread and turn that burst
        // into a queue on slow disks; keep the protocol handler asynchronous
        // so window, IPC, and the remaining resource requests stay responsive.
        let content: Buffer;
        try {
          content = await fs.promises.readFile(filePath);
        } catch {
          // Fallback to the root index (handles unknown deep-link paths).
          filePath = path.join(outDir, "index.html");
          content = await fs.promises.readFile(filePath);
        }
        const ext = path.extname(filePath).toLowerCase();
        const body = content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ) as ArrayBuffer;
        return new Response(body, {
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
  if (isStudioApp) {
    // Studio is the handler for its own scheme only: claiming `crystal://` would take sign-in callbacks and invites
    // away from Crystal. Not in development, where this registers the bare Electron binary.
    if (!isDev) app.setAsDefaultProtocolClient(STUDIO_PROTOCOL);
  } else {
    app.setAsDefaultProtocolClient("crystal");
  }

  const ses = session.defaultSession;

  // Prime pactl / recorder detection so the first share starts faster.
  if (!isStudioApp) void systemAudio.warmUp().catch(() => {});

  // Grant media + display capture for the renderer (LiveKit + screen share),
  // plus clipboard-write for the invite-code copy button (navigator.clipboard
  // .writeText is gated behind the "clipboard-sanitized-write" permission —
  // without it Chromium rejects every write with NotAllowedError). Image
  // copies via `navigator.clipboard.write([ClipboardItem])` need the broader
  // `clipboard-read`/`clipboard-write` permissions.
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = [
      "media",
      "display-capture",
      "notifications",
      "fullscreen",
      "clipboard-sanitized-write",
      "clipboard-read",
      "clipboard-write",
    ];
    callback(allowed.includes(permission));
  });

  // `getDisplayMedia` (and clipboard writes) perform a permission *check*
  // before the request; without an allowlist here the check is denied and
  // the request handler above never even runs.
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return ["media", "display-capture", "fullscreen", "clipboard-sanitized-write", "clipboard-read", "clipboard-write", "notifications"].includes(permission);
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
      // No thumbnails: this call only exists to turn an id back into a source
      // handle, and the default is a 150x150 capture of *every* open window —
      // a visible hitch at the exact moment a share starts, for pictures
      // nothing here looks at. (The picker asks for its own, separately.)
      .getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } })
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
    app: appKind,
    productName: identity.productName,
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

  // Clipboard: copy an image from main via nativeImage so it works even when
  // the web Clipboard API is unavailable or blocked (e.g. stricter permission
  // config). Renderer sends the raw bytes it fetched; main writes them.
  ipcMain.handle("clipboard:write-image", (_event, buffer: ArrayBuffer, _mimeType?: string) => {
    const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
    const img = nativeImage.createFromBuffer(raw);
    if (img.isEmpty()) throw new Error("Failed to decode image for clipboard");
    clipboard.writeImage(img);
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

  ipcMain.handle(
    "editor:open",
    (_event, options: { kind: "frame" | "decoration"; scopeId?: string; scopeName?: string }) => {
      createOrFocusEditorWindow(options);
      return true;
    },
  );
  ipcMain.handle("studio:open", async () => {
    await openApp("studio");
    return true;
  });
  ipcMain.handle("studio:open-crystal", async () => {
    await openApp("crystal");
    return true;
  });
  // Studio's projects are plain files in Documents/Crystal Studio. Only the Studio window may
  // ask for them — see studioFs.ts for what is and isn't reachable. Crystal doesn't serve them at all: Studio is its own
  // application, and this is its half of the work.
  if (isStudioApp) {
    const isStudioSender = (sender: Electron.WebContents) => !!studioWindow && !studioWindow.isDestroyed() && sender === studioWindow.webContents;
    const studioFs = registerStudioFs(path.join(app.getPath("documents"), "Crystal Studio"), isStudioSender);
    // The code workbench: a terminal in the project folder, and the build that bundles an extension.
    const studioTerminals = registerStudioTerminal((rel) => studioFs.dirPath(rel), isStudioSender);
    registerStudioBuild((rel) => studioFs.dirPath(rel), (rel, text) => studioFs.writeText(rel, text), isStudioSender);
    app.on("before-quit", () => studioTerminals.closeAll());
  }
  ipcMain.handle("admin:open", () => {
    createOrFocusAdminWindow();
    return true;
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
  // The system accent colour, for the app's dynamic colour mode. macOS and
  // Windows only — Electron has no way to ask for it anywhere else, and
  // `null` is how the renderer knows not to offer the mode.
  const systemAccentColor = (): string | null => {
    if (process.platform !== "darwin" && process.platform !== "win32") return null;
    try {
      // `rrggbbaa`.
      const rgba = systemPreferences.getAccentColor();
      return rgba && rgba.length >= 6 ? `#${rgba.slice(0, 6)}` : null;
    } catch {
      return null;
    }
  };
  ipcMain.handle("system:accent-color", () => systemAccentColor());
  const sendAccentColor = () => {
    const color = systemAccentColor();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("system:accent-color-changed", color);
    }
  };
  // Debounced, and read *after* the pause rather than when the notification
  // lands: macOS announces an appearance or accent change before
  // `getAccentColor()` has the new value, so reading on the spot sends the old
  // colour and the app sits one change behind until the next one. A change is
  // also usually several notifications in a row (accent and highlight, then
  // the appearance), and one send is enough for them.
  let accentTimer: NodeJS.Timeout | undefined;
  const broadcastAccentColor = () => {
    clearTimeout(accentTimer);
    accentTimer = setTimeout(sendAccentColor, 150);
  };
  // Light/dark can change the accent too (Windows keeps one per mode), and it
  // is the one change that fires this regardless of platform.
  nativeTheme.on("updated", broadcastAccentColor);
  if (process.platform === "win32") {
    systemPreferences.on("accent-color-changed", broadcastAccentColor);
  } else if (process.platform === "darwin") {
    systemPreferences.subscribeNotification("AppleColorPreferencesChangedNotification", broadcastAccentColor);
    systemPreferences.subscribeNotification("AppleInterfaceThemeChangedNotification", broadcastAccentColor);
  }

  ipcMain.handle("window:is-fullscreen", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
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
  // Studio has none: closing its window quits it.
  const tray = isStudioApp ? null : new Tray(trayIconImage());
  if (tray) {
  tray.setToolTip(identity.productName);
  // Without this macOS swallows the first click of a double-click and delays
  // the menu; the tray has no double-click behaviour to preserve.
  if (process.platform === "darwin") tray.setIgnoreDoubleClickEvents(true);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${identity.productName}`, click: () => createOrFocusMainWindow() },
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
  }

  backgroundNotifier.init({
    getMainWindow: () => mainWindow,
    onNavigate: (target) => {
      sendToMain("notifications:navigate", target);
    },
  });

  ipcMain.handle(
    "notifications:configure",
    (_event, url: string, token: string | null, userId: string | null) => {
      // Crystal watches for messages; Studio has nothing to tell anyone and must not toast a second time.
      if (!isStudioApp) backgroundNotifier.configure(url, token, userId);
    }
  );
  ipcMain.handle(
    "notifications:set-active-view",
    (_event, view: { kind: "conversation" | "channel"; id: string } | null) => {
      if (!isStudioApp) backgroundNotifier.setActiveView(view);
    }
  );

  /**
   * How many things are waiting for you, on the icon in the dock or taskbar.
   *
   * Two mechanisms because the platforms disagree about whose job it is.
   * macOS and Linux own the drawing — hand them a number and they render the
   * badge in the system style. Windows has no such thing: it composites an
   * *image* over the taskbar button, so the renderer draws one and sends it,
   * which is also the only place with a canvas and a font to draw it with.
   */
  ipcMain.handle(
    "badge:set",
    (_event, count: number, overlayDataUrl: string | null) => {
      app.setBadgeCount(count);
      if (process.platform !== "win32") return;
      const overlay =
        overlayDataUrl && count > 0 ? nativeImage.createFromDataURL(overlayDataUrl) : null;
      for (const win of BrowserWindow.getAllWindows()) {
        // The description is what a screen reader announces for the overlay,
        // and Windows requires a non-empty one when clearing is not the goal.
        win.setOverlayIcon(overlay, count > 0 ? `${count} unread` : "");
      }
    }
  );

  updater.init();
  updater.onStateChange((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("updater:state-changed", state);
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
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("rich-presence:changed", activities);
    }
  });
  if (!isStudioApp) {
    void richPresence.start().catch((err) => {
      console.warn("[rich-presence] failed to start:", err);
    });
  }

  ipcMain.handle("rich-presence:get", () => richPresence.getActivities());
  ipcMain.handle("rich-presence:status", () => richPresence.getStatus());
  ipcMain.handle("rich-presence:set-enabled", (_event, enabled: boolean) => {
    richPresence.setEnabled(!!enabled);
    return richPresence.getStatus();
  });

  // Call-aware background throttling: idle = throttled (saves RAM/CPU), in-call = unthrottled
  ipcMain.handle("call:active", (event, active: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
      const id = win.webContents.id;
      if (active) activeCallWebContents.add(id);
      else activeCallWebContents.delete(id);
      // Electron exposes `webContents.setBackgroundThrottling` at runtime
      try { (win.webContents as unknown as { setBackgroundThrottling: (v: boolean) => void }).setBackgroundThrottling(!active); } catch { /* ignore */ }
    }
    return true;
  });

  // Memory pressure hint from renderer (e.g. after large image flood)
  // `global.gc` exists because --expose-gc is set above. Also drop unused
  // icon handles that accumulate in the main-process notification cache.
  ipcMain.handle("app:gc", () => {
    try { if (global.gc) global.gc(); } catch { /* ignore */ }
    // Hint Chromium's Blink GC as well: ask windows to collect.
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.invalidate(); } catch { /* ignore */ }
    }
    return true;
  });

  // Periodic GC while idle — renderer is throttled but V8 heap can stay
  // high after a burst (image flood, long scroll). 90s is infrequent enough
  // to cost nothing, often enough to pull RSS back down.
  setInterval(() => {
    const idle = !BrowserWindow.getAllWindows().some((w) => w.isFocused());
    if (idle && global.gc) try { global.gc(); } catch { /* ignore */ }
  }, 90_000).unref();

  if (isStudioApp) {
    createOrFocusStudioWindow();
    app.on("activate", () => createOrFocusStudioWindow());
  } else {
    createWindow();
    app.on("activate", () => createOrFocusMainWindow());
  }
});

// The main window hides instead of closing (see its `close` handler above),
// so the app now only quits via the tray's "Quit" item or the OS itself —
// never just because every window happened to be hidden/closed.
app.on("window-all-closed", () => {
  // Crystal Studio is a document-style app with no tray to live in: closing its last window ends it.
  if (isStudioApp) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  linuxAudioSender = null;
  unsubLinuxAudio();
  void systemAudio.disable();
  stopMacAudioChild();
  richPresence.stop();
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});
