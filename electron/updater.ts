import { app } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * Wraps `electron-updater`'s `autoUpdater` (GitHub-releases provider, see the
 * `publish` block in electron-builder.yml) behind a small state machine the
 * renderer can subscribe to, instead of exposing the raw event emitter over
 * IPC.
 *
 * Auto-download is deliberately off: `checkForUpdates()` only gets us to
 * "available" (the topbar's blue icon); the user (or the Settings Updates
 * tab) triggers the actual download, and only once it's finished do we flip
 * to "ready" (green icon) and allow `quitAndInstall()`.
 *
 * macOS note: without a code-signing identity, Squirrel.Mac can still detect
 * that an update exists (checkForUpdates just compares the published
 * latest-mac.yml's version against the running app) but refuses to apply it.
 * We still let mac reach "available" so the UI is honest about a new version
 * existing, and surface the eventual download/install failure as a normal
 * `error` state with a link to grab the release manually instead of crashing.
 */

export type UpdaterPhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "not-available"
  | "unsupported"
  | "error";

export interface UpdaterState {
  phase: UpdaterPhase;
  currentVersion: string;
  availableVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

export type UpdaterListener = (state: UpdaterState) => void;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10_000;

class Updater {
  private state: UpdaterState = {
    phase: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    progressPercent: null,
    error: null,
  };
  private listeners = new Set<UpdaterListener>();
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("checking-for-update", () => this.setState({ phase: "checking", error: null }));
    autoUpdater.on("update-available", (info) => {
      // The periodic background check re-fires this for the same version
      // even after it's already been downloaded — don't downgrade "ready"
      // (which gates the install button) back to "available" and make the
      // user re-download something that's already sitting on disk.
      if (this.state.phase === "ready" && this.state.availableVersion === info.version) return;
      this.setState({ phase: "available", availableVersion: info.version, error: null });
    });
    autoUpdater.on("update-not-available", () =>
      this.setState({ phase: "not-available", availableVersion: null, error: null })
    );
    autoUpdater.on("download-progress", (progress) =>
      this.setState({ phase: "downloading", progressPercent: Math.round(progress.percent) })
    );
    autoUpdater.on("update-downloaded", (info) =>
      this.setState({ phase: "ready", availableVersion: info.version, progressPercent: 100 })
    );
    autoUpdater.on("error", (err) =>
      this.setState({ phase: "error", progressPercent: null, error: err.message })
    );

    if (app.isPackaged) {
      setTimeout(() => void this.check(), INITIAL_CHECK_DELAY_MS);
      setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    }
  }

  private setState(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        /* a listener's error must never break updater state propagation */
      }
    }
  }

  getState(): UpdaterState {
    return this.state;
  }

  onStateChange(cb: UpdaterListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async check(): Promise<UpdaterState> {
    if (!app.isPackaged) {
      this.setState({
        phase: "unsupported",
        error: "Auto-update only runs in packaged builds, not in development.",
      });
      return this.state;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.setState({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return this.state;
  }

  async download(): Promise<UpdaterState> {
    if (this.state.phase !== "available") return this.state;
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      this.setState({ phase: "error", error: err instanceof Error ? err.message : String(err) });
    }
    return this.state;
  }

  quitAndInstall(): void {
    if (this.state.phase !== "ready") return;
    autoUpdater.quitAndInstall();
  }
}

export default new Updater();
