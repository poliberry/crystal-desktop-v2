import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CHANNELS, resolveRunningChannel } from "../channels";
import { type ComponentId, type Platform, chooseAur, defaultBase, isPlatform } from "./core";
import { Engine, type Selection } from "./engine";

/**
 * Crystal's installer: a small application of its own that takes someone through choosing what to install, fetches those
 * apps from the channel's newest release, checks them, and puts them in place. It is the file a person downloads first;
 * Crystal and Crystal Studio are installed by it and then update themselves.
 *
 * All the work happens here, in the main process. The window (installer/ui) is a local page with no network of its own.
 */

const platformName = process.platform;
if (!isPlatform(platformName)) {
  app.quit();
  throw new Error(`Unsupported platform: ${platformName}`);
}
const platform: Platform = platformName;

// Which channel this installer belongs to, like the apps: stamped into the package at build time, `CRYSTAL_CHANNEL` in development.
const channel = resolveRunningChannel({ appPath: app.getAppPath(), isPackaged: app.isPackaged });
// A development run asks for the Stable channel unless told otherwise: the Development channel has nothing published.
const effectiveChannel = !app.isPackaged && !process.env.CRYSTAL_CHANNEL ? CHANNELS.stable : channel;

app.setName(`${effectiveChannel.id === "stable" ? "Crystal" : `Crystal ${effectiveChannel.label}`} Installer`);

// The wizard is a local page, bundled beside this file by scripts/build-installer.mjs. Packaged and in development it is
// the same files, so what runs while building is what ships.
const UI_FILE = path.join(__dirname, "ui", "index.html");
const isDev = !app.isPackaged;

/** Window controls: the system's traffic lights on a Mac, our own buttons elsewhere (see the UI). */
const BAR = 44;

/** The icon, by app, for the window (`crystal`) and Linux menu entries. Packaged: next to the app; development: build/. */
function iconPath(id: ComponentId): string | null {
  const file = id === "studio" ? "icon-studio.png" : "icon.png";
  const candidate = isDev ? path.join(__dirname, "..", "..", "build", file) : path.join(process.resourcesPath, file);
  return fs.existsSync(candidate) ? candidate : null;
}

function canWrite(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Whether a program is on the PATH. */
function hasCommand(name: string): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((dir) => {
    try {
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function readOsRelease(): string {
  for (const file of ["/etc/os-release", "/usr/lib/os-release"]) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      /* try the next */
    }
  }
  return "";
}

// On Arch Linux (and what is built on it) the apps come from the AUR and are installed with pacman, so the package manager
// owns and updates them. Anywhere else, or if the tools for it are missing, the AppImage is placed as before.
const aur = chooseAur({ platform, arch: process.arch, osRelease: readOsRelease(), channel: effectiveChannel, have: hasCommand, forced: process.env.CRYSTAL_INSTALL_METHOD });

const engine = new Engine({
  platform,
  arch: process.arch,
  channel: effectiveChannel,
  desktopDir: app.getPath("desktop"),
  iconFor: iconPath,
  aur: aur.use,
});

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    width: 880,
    height: 600,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: app.getName(),
    icon: iconPath("crystal") ?? undefined,
    backgroundColor: "#09090b",
    ...(platform === "darwin"
      ? ({ titleBarStyle: "hidden", trafficLightPosition: { x: 20, y: Math.round(BAR / 2 - 6) } } as const)
      : ({ frame: false } as const)),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  // The page is ours and local. Nothing it contains may navigate away or open a window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  void win.loadFile(UI_FILE);
  win.on("closed", () => {
    win = null;
  });
  // Closing mid-install stops it rather than leaving a download running unseen.
  win.on("close", () => engine.cancel());
}

engine.onState((state) => {
  if (win && !win.isDestroyed()) win.webContents.send("installer:state", state);
});

const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else app.on("second-instance", () => (win ? (win.isMinimized() && win.restore(), win.focus()) : createWindow()));

app.whenReady().then(() => {
  if (!lock) return;

  ipcMain.handle("installer:info", () => {
    const base = process.env.CRYSTAL_INSTALL_BASE || defaultBase(platform, process.env, os.homedir(), canWrite("/Applications"));
    return {
      platform,
      arch: process.arch,
      channel: effectiveChannel.id,
      channelLabel: effectiveChannel.label,
      version: app.getVersion(),
      defaultBase: base,
      // Whether each app is already where the default folder would put it, so the wizard can say it will be updated.
      installed: Object.fromEntries(Object.entries(engine.targets(base)).map(([id, target]) => [id, fs.existsSync(target)])) as Record<ComponentId, boolean>,
      // A Mac's apps go straight into the folder; Windows and Linux put each in a folder of its own beneath it.
      appsInOwnFolder: platform === "win32",
      // Installed through pacman: there is no folder to choose, and the wizard skips that step.
      aur: aur.use,
      // Arch, but missing what building an AUR package takes: said on the Location step, so the AppImage isn't a mystery.
      aurMissing: aur.missing,
    };
  });
  ipcMain.handle("installer:plan", () => engine.resolve());
  ipcMain.handle("installer:state", () => engine.getState());
  ipcMain.handle("installer:targets", (_e, base: string) => engine.targets(base));

  ipcMain.handle("installer:choose-folder", async (_e, current: string) => {
    if (!win) return null;
    const r = await dialog.showOpenDialog(win, { title: "Choose where to install", defaultPath: current, properties: ["openDirectory", "createDirectory"] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  /** Whether the apps can be put in this folder: it exists or can be made, and can be written to. */
  ipcMain.handle("installer:check-folder", async (_e, dir: string): Promise<{ ok: boolean; reason: string | null }> => {
    if (typeof dir !== "string" || !dir.trim()) return { ok: false, reason: "Choose a folder." };
    if (!path.isAbsolute(dir)) return { ok: false, reason: "Enter the full path of a folder." };
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      try {
        await fs.promises.access(dir, fs.constants.W_OK);
      } catch (e) {
        // A Mac asks for an administrator's password when it gets to putting the apps there, so a folder that is only
        // writable by one is fine, as long as it is a folder.
        if (platform !== "darwin" || !(await fs.promises.stat(dir)).isDirectory()) throw e;
      }
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: "This folder can't be written to. Choose another." };
    }
  });

  ipcMain.handle("installer:start", async (_e, selection: Selection) => {
    // Reached from the page only, but the page is untrusted input as far as the filesystem is concerned.
    if (!selection || !Array.isArray(selection.components) || typeof selection.base !== "string" || !path.isAbsolute(selection.base)) throw new Error("That isn't a valid selection.");
    await engine.install({ components: selection.components.filter((c) => c === "crystal" || c === "studio"), base: selection.base, desktopShortcut: !!selection.desktopShortcut });
  });
  ipcMain.handle("installer:cancel", () => engine.cancel());
  ipcMain.handle("installer:launch", (_e, ids: ComponentId[], base: string) => {
    if (typeof base === "string" && path.isAbsolute(base) && Array.isArray(ids)) engine.launch(ids.filter((c) => c === "crystal" || c === "studio"), base);
  });
  ipcMain.handle("installer:open-releases", () => shell.openExternal(`https://github.com/poliberry/crystal-desktop-v2/releases`));
  ipcMain.handle("installer:quit", () => app.quit());
  ipcMain.handle("installer:minimize", () => win?.minimize());

  createWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  engine.cancel();
  engine.cleanup();
});
