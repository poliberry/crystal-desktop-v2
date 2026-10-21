import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

/**
 * Why the app froze, written down.
 *
 * A freeze where the window stops repainting (and, on Linux, the cursor smears across the screen) has three
 * very different causes, and the fix for each is different:
 *
 *   - the GPU process died or hung      -> a `child-process-gone` of type GPU, or no event at all but a GPU in a bad state
 *   - the renderer (the page) hung      -> `unresponsive` on the window's web contents
 *   - the main process is blocked       -> nothing can be logged *by it*. On Linux the main process is also Chromium's UI
 *                                          thread, so blocking it freezes every window and the cursor with it.
 *
 * So this logs the first two as they happen, and watches for the third from a worker thread, which keeps running when the
 * main thread doesn't. Everything goes to one small file (rotated at 512 KB) next to Electron's own logs:
 *
 *   Linux    ~/.config/<app name>/logs/diagnostics.log
 *   Windows  %APPDATA%\<app name>\logs\diagnostics.log
 *   macOS    ~/Library/Logs/<app name>/diagnostics.log
 *
 * Nothing here is sent anywhere.
 */

const MAX_BYTES = 512 * 1024;
const HEARTBEAT_MS = 1_000;
/** A main thread that hasn't beaten for this long is reported as blocked. */
const BLOCKED_AFTER_MS = 5_000;

let file: string | null = null;

/** When this process started, so startup stages can say how long launch took. */
const processStartedAt = Date.now();

function logPath(): string {
  if (!file) file = path.join(app.getPath("logs"), "diagnostics.log");
  return file;
}

/**
 * One timestamped line for a launch milestone (e.g. "window shown"), with
 * milliseconds since process start. A slow launch is otherwise a mystery —
 * minutes of nothing followed by an app — and this is what says which stage
 * ate them (GPU init before first paint, a hung protocol handler, first
 * paint waiting on the network, ...). Read it in `logs/diagnostics.log`.
 */
export function markStartupStage(stage: string): void {
  logDiagnostic(`startup +${Date.now() - processStartedAt} ms: ${stage}`);
}

/** One line, timestamped. Never throws: a diagnostic must not be the thing that breaks the app. */
export function logDiagnostic(message: string): void {
  try {
    const target = logPath();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      if (fs.statSync(target).size > MAX_BYTES) fs.renameSync(target, `${target}.1`);
    } catch {
      /* no file yet */
    }
    fs.appendFileSync(target, `${new Date().toISOString()} ${message}\n`);
  } catch {
    /* ignore */
  }
}

/**
 * The GPU escape hatch. Hardware acceleration is where Linux graphics problems usually live (drivers, Wayland, hybrid
 * graphics), and turning it off trades speed for a renderer that cannot hang the display. Any of:
 *
 *   - Settings → Performance → Hardware acceleration (which writes the file below),
 *   - launch with CRYSTAL_DISABLE_GPU=1, or
 *   - create an empty file named `disable-gpu` in the app's data directory (the folder that holds `logs/`).
 *
 * Has to run before the app is ready. Call it once, after the app's name and data directory are settled.
 */
export function applyGpuPreference(): void {
  let why: string | null = null;
  if (process.env.CRYSTAL_DISABLE_GPU === "1") why = "CRYSTAL_DISABLE_GPU=1";
  else if (fs.existsSync(gpuMarkerPath())) why = `${gpuMarkerPath()} exists`;
  if (!why) return;
  app.disableHardwareAcceleration();
  runningWithoutGpu = true;
  logDiagnostic(`Hardware acceleration is off (${why}).`);
}

/** Whether this run started with hardware acceleration off. Fixed at launch: Chromium can't change it afterwards. */
let runningWithoutGpu = false;

/** The file whose existence is the setting. A file rather than JSON because it has to be read before the app is ready. */
function gpuMarkerPath(): string {
  return path.join(app.getPath("userData"), "disable-gpu");
}

export interface GpuSettings {
  /** Hardware acceleration is turned off in settings, for the next launch. */
  saved: boolean;
  /** Turned off by the `CRYSTAL_DISABLE_GPU` environment variable, which settings can't override. */
  forcedByEnv: boolean;
  /** This run is without it. When this differs from the settings, a restart is what applies the change. */
  runningWithout: boolean;
}

export function getGpuSettings(): GpuSettings {
  return { saved: fs.existsSync(gpuMarkerPath()), forcedByEnv: process.env.CRYSTAL_DISABLE_GPU === "1", runningWithout: runningWithoutGpu };
}

/** Saves the choice. It takes effect the next time the app starts. */
export function setGpuDisabled(disabled: boolean): GpuSettings {
  try {
    if (disabled) {
      fs.mkdirSync(path.dirname(gpuMarkerPath()), { recursive: true });
      fs.writeFileSync(gpuMarkerPath(), "");
    } else {
      fs.rmSync(gpuMarkerPath(), { force: true });
    }
    logDiagnostic(`Hardware acceleration was turned ${disabled ? "off" : "on"} in settings (applies on the next launch).`);
  } catch (err) {
    logDiagnostic(`Could not save the hardware acceleration setting: ${err instanceof Error ? err.message : String(err)}`);
  }
  return getGpuSettings();
}

/**
 * Runs in a worker thread, so it keeps going when the main thread is blocked. The main thread bumps a counter every
 * second; if the counter stops moving the worker says so. A gap between the worker's own ticks (the machine was
 * suspended) is not a stall and is ignored.
 */
const WATCHDOG = `
const { workerData } = require("node:worker_threads");
const fs = require("node:fs");
const beat = new Int32Array(workerData.buffer);
const append = (line) => { try { fs.appendFileSync(workerData.file, new Date().toISOString() + " " + line + "\\n"); } catch {} };
let seen = Atomics.load(beat, 0);
let changedAt = Date.now();
let tickedAt = Date.now();
let reported = false;
setInterval(() => {
  const now = Date.now();
  const suspended = now - tickedAt > 3000;
  tickedAt = now;
  const value = Atomics.load(beat, 0);
  if (value !== seen || suspended) {
    if (reported && value !== seen) append("The main process is responding again after " + (now - changedAt) + " ms.");
    seen = value;
    changedAt = now;
    reported = false;
    return;
  }
  const stalled = now - changedAt;
  if (stalled >= workerData.after && !reported) {
    reported = true;
    append("The main process has been blocked for " + stalled + " ms. It is also the UI thread, so every window is frozen.");
  }
}, 1000);
`;

function startMainThreadWatchdog(): void {
  try {
    const buffer = new SharedArrayBuffer(4);
    const beat = new Int32Array(buffer);
    setInterval(() => Atomics.add(beat, 0, 1), HEARTBEAT_MS).unref();
    const worker = new Worker(WATCHDOG, { eval: true, workerData: { buffer, file: logPath(), after: BLOCKED_AFTER_MS } });
    worker.on("error", (err: Error) => logDiagnostic(`The watchdog stopped: ${err.message}`));
    worker.unref();
  } catch (err) {
    logDiagnostic(`The watchdog could not start: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const recentReloads = new Map<number, number[]>();

/**
 * A page whose renderer died (out of memory, a crash, a GPU failure that took it down) is a blank window the person can
 * only close. Reload it instead — but not in a loop: a page that dies again within seconds of loading stays down, with
 * the reason in the log, rather than flashing forever.
 */
export function recoverFromRendererLoss(win: Electron.BrowserWindow, reason: string): void {
  if (reason === "clean-exit" || reason === "killed" || win.isDestroyed() || win.webContents.isDestroyed()) return;
  const id = win.webContents.id;
  const now = Date.now();
  const recent = (recentReloads.get(id) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 3) {
    logDiagnostic(`The page died again (${reason}) after ${recent.length} reloads in a minute; leaving it.`);
    return;
  }
  recentReloads.set(id, [...recent, now]);
  logDiagnostic(`Reloading the page after it died (${reason}).`);
  setTimeout(() => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.reload();
  }, 500);
}

/** Starts logging. Call once, after `app.whenReady()`. */
export function startDiagnostics(): void {
  logDiagnostic(
    [
      `Started ${app.getName()} ${app.getVersion()}`,
      `electron ${process.versions.electron}`,
      `chrome ${process.versions.chrome}`,
      `${process.platform}/${process.arch}`,
      process.platform === "linux"
        ? `session=${process.env.XDG_SESSION_TYPE ?? "?"} wayland=${process.env.WAYLAND_DISPLAY ?? "-"} display=${process.env.DISPLAY ?? "-"} desktop=${process.env.XDG_CURRENT_DESKTOP ?? "?"}`
        : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
  try {
    logDiagnostic(`GPU features: ${JSON.stringify(app.getGPUFeatureStatus())}`);
  } catch {
    /* ignore */
  }
  void app
    .getGPUInfo("basic")
    .then((info) => {
      const gpu = (info as { gpuDevice?: { vendorId?: number; deviceId?: number; driverVendor?: string; driverVersion?: string; active?: boolean }[] }).gpuDevice ?? [];
      logDiagnostic(`GPU devices: ${JSON.stringify(gpu.map((d) => ({ vendor: d.vendorId, device: d.deviceId, driver: `${d.driverVendor ?? ""} ${d.driverVersion ?? ""}`.trim(), active: d.active })))}`);
    })
    .catch(() => {});

  // The GPU, network, audio and utility processes. A GPU process that dies takes the picture with it.
  app.on("child-process-gone", (_event, details) => {
    logDiagnostic(`${details.type} process gone: reason=${details.reason} exitCode=${details.exitCode}${details.name ? ` name=${details.name}` : ""}`);
  });
  app.on("render-process-gone", (_event, contents, details) => {
    logDiagnostic(`Renderer gone (${contents.getURL()}): reason=${details.reason} exitCode=${details.exitCode}`);
  });
  // A page that stops answering. Chromium decides this by pinging the renderer; the window can still be moved but not used.
  app.on("web-contents-created", (_event, contents) => {
    contents.on("unresponsive", () => logDiagnostic(`A page stopped responding (${contents.getURL()}).`));
    contents.on("responsive", () => logDiagnostic(`A page is responding again (${contents.getURL()}).`));
  });

  startMainThreadWatchdog();
}
