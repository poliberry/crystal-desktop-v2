import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, shell } from "electron";
import * as fs from "node:fs";
import { createServer } from "node:http";
import * as path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import serveHandler from "serve-handler";

import systemAudio from "./systemAudio";

const isDev = !!process.env.ELECTRON_START_URL;
const PRELOAD = path.join(__dirname, "preload.js");

// Packaged builds serve the static export over a real http:// origin instead
// of file://. file:// is treated as an opaque origin by Chromium, which
// broke Clerk's session persistence: signing in would "succeed" but the app
// could never rehydrate the session afterwards. A privileged custom scheme
// (app://) isn't a fix either — Clerk's client explicitly checks
// window.location.protocol and only accepts http/https; anything else logs
// '"app:" is not a valid protocol. Redirecting to "/" instead.' and force-
// navigates to a bare "/", which reloads the page and loses the in-flight
// session context. A plain local HTTP server sidesteps both problems.
let localServerPort: number | null = null;

function startLocalServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      void serveHandler(req, res, { public: path.join(__dirname, "..", "out") });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Could not determine local server port"));
      }
    });
  });
}

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
  // Dev: Electron's bundle id + app name. Packaged: the Crystal bundle id.
  return isDev ? "com.github.Electron,Electron" : "dev.crystal.desktop,Crystal";
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_START_URL as string);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadURL(`http://127.0.0.1:${localServerPort}/`);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
}

let settingsWindow: BrowserWindow | null = null;

/** Opens the Settings window, or focuses it if it's already open (singleton). */
function createOrFocusSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 840,
    height: 600,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: "#09090b",
    autoHideMenuBar: true,
    title: "Crystal Settings",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void win.loadURL(`${process.env.ELECTRON_START_URL as string}/settings`);
  } else {
    void win.loadURL(`http://127.0.0.1:${localServerPort}/settings/`);
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  win.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow = win;
}

app.whenReady().then(async () => {
  if (!isDev) {
    try {
      localServerPort = await startLocalServer();
    } catch (err) {
      dialog.showErrorBox(
        "Crystal failed to start",
        `Could not start the local server the app is served from: ${err instanceof Error ? err.message : String(err)}`,
      );
      app.exit(1);
      return;
    }
  }

  const ses = session.defaultSession;

  // Prime pactl / recorder detection so the first share starts faster.
  void systemAudio.warmUp().catch(() => {});

  // Grant media + display capture for the renderer (LiveKit + screen share).
  ses.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ["media", "display-capture", "notifications", "fullscreen"];
    callback(allowed.includes(permission));
  });

  // `getDisplayMedia` performs a permission *check* before the request; without
  // an allowlist here the check is denied and screen share fails.
  ses.setPermissionCheckHandler((_webContents, permission) => {
    return ["media", "display-capture", "fullscreen"].includes(permission);
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

  ipcMain.handle("app:info", () => ({
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  }));

  ipcMain.handle("settings:open", () => {
    createOrFocusSettingsWindow();
  });

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

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  linuxAudioSender = null;
  unsubLinuxAudio();
  void systemAudio.disable();
  stopMacAudioChild();
});
