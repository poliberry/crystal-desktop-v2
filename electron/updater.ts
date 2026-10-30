import { app } from "electron";
import { autoUpdater } from "electron-updater";
import * as fs from "node:fs";
import * as path from "node:path";

import { downloadStatus, parseAttempt, shouldAutoInstall, type InstallAttempt } from "./launchUpdate";
import { newestRelease } from "./releases";
import { appIdentity, REPO, resolveRunningApp, resolveRunningChannel, type AppIdentity, type ChannelDefinition, type ReleaseChannel } from "./channels";

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
 * Channels: Stable's feed is the GitHub provider configured in
 * electron-builder.yml — it asks GitHub for the repo's latest release, which
 * is exactly the newest `v1.2.3` tag (every other channel publishes
 * prereleases, which that endpoint skips). The side channels can't use it:
 * their releases are tagged `canary-1.2.3` / `ptb-1.2.3`, and the provider
 * only recognises channels expressed as a semver *prerelease* (`1.2.3-canary.1`).
 * So `configureFeed` resolves the newest tag for the running channel itself
 * and points electron-updater at that release's assets as a plain static feed
 * — see `newestTagForChannel`.
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
  /** Which release channel this build updates from. */
  channel: ReleaseChannel;
  /** The channel's display name ("Canary"), so the UI doesn't need the table. */
  channelLabel: string;
}

export type UpdaterListener = (state: UpdaterState) => void;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const INITIAL_CHECK_DELAY_MS = 10_000;
/** How long a launch waits on the update check before opening the app anyway — a slow network must not hold the app back. */
const LAUNCH_CHECK_TIMEOUT_MS = 8_000;
/** The most a launch spends downloading before it gives up and opens the app (the download carries on in the topbar). */
const LAUNCH_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
/**
 * On macOS, if the app is still running this long after `quitAndInstall`, it is made to exit. Squirrel.Mac installs when
 * the process ends, so a process that lingers (a window that would not close) is what makes an update need a manual quit.
 * Generous, because Squirrel first has to finish staging the update before it will quit at all.
 */
const MAC_QUIT_WATCHDOG_MS = 45_000;

/** Newest published tag for a channel, or null if it has never released (see `newestRelease`). */
async function newestTagForChannel(channel: ChannelDefinition): Promise<string | null> {
  return (await newestRelease(channel))?.tag ?? null;
}

class Updater {
  private readonly channel: ChannelDefinition = resolveRunningChannel({
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
  });
  /** Crystal or Crystal Studio. Both publish to the same release, so Studio reads its own metadata file from it. */
  private readonly identity: AppIdentity = appIdentity(
    this.channel,
    resolveRunningApp({ appPath: app.getAppPath() }),
  );
  private state: UpdaterState = {
    phase: "idle",
    currentVersion: app.getVersion(),
    availableVersion: null,
    progressPercent: null,
    error: null,
    channel: this.channel.id,
    channelLabel: this.channel.label,
  };
  private listeners = new Set<UpdaterListener>();
  private initialized = false;
  /** Tag the feed currently points at, so a repeat check doesn't re-query the
   * releases API for a channel that hasn't published anything new. */
  private feedTag: string | null = null;

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

  /** True for an install a package manager owns. `installed-by` sits in resources/ and is written by the package, not the app. */
  private installedByPackageManager(): boolean {
    try {
      return fs.existsSync(path.join(process.resourcesPath, "installed-by"));
    } catch {
      return false;
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

  /**
   * Aim the updater at this channel's newest release.
   *
   * Stable is left alone: the GitHub provider baked in at package time already
   * resolves "the repo's latest release", which is the newest stable tag. The
   * side channels get a generic feed pointed straight at one release's assets,
   * re-resolved on every check because the tag moves with each publish.
   */
  private async configureFeed(): Promise<void> {
    // Stable Crystal's baked-in GitHub provider already finds the repo's latest release. Studio can't use it: it must read
    // `studio*.yml`, not `latest*.yml`, which only a feed that names its channel does.
    if (this.channel.id === "stable" && this.identity.kind === "crystal") return;

    const tag = await newestTagForChannel(this.channel);
    if (!tag) {
      throw new Error(`No ${this.channel.label} release has been published yet.`);
    }
    if (tag === this.feedTag) return;

    autoUpdater.setFeedURL({
      provider: "generic",
      url: `https://github.com/${REPO.owner}/${REPO.repo}/releases/download/${tag}`,
      // GitHub serves release assets from S3 behind a redirect, which doesn't
      // answer multi-range requests — the same reason electron-updater turns
      // this off for its own GitHub provider.
      useMultipleRangeRequest: false,
      channel: this.identity.feedChannel,
    });
    this.feedTag = tag;
  }

  async check(): Promise<UpdaterState> {
    if (!app.isPackaged) {
      this.setState({
        phase: "unsupported",
        error: "Auto-update only runs in packaged builds, not in development.",
      });
      return this.state;
    }
    // Installed by pacman (the AUR package writes this marker): the files belong to root, so this app can't replace them,
    // and an update it offered would only fail. The package manager is the way to update it.
    if (this.installedByPackageManager()) {
      const pkg = this.identity.aurPackage ?? "the package";
      this.setState({
        phase: "unsupported",
        error: `This copy was installed with pacman, so it updates through it: run "yay -Syu" (or your AUR helper's equivalent) to update ${pkg}.`,
      });
      return this.state;
    }
    try {
      await this.configureFeed();
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

  /**
   * `prepareToQuit` runs first: `quitAndInstall` closes every window *before* the app's own quit begins (Electron's docs
   * say so), and a window that hides itself when closed — Crystal's does, to live in the tray — answers that by staying,
   * which keeps the app alive and the update uninstalled until the person quits it by hand. It lets those windows go.
   */
  quitAndInstall(prepareToQuit?: () => void): void {
    if (this.state.phase !== "ready") return;
    prepareToQuit?.();
    autoUpdater.quitAndInstall(false, true);
    if (process.platform === "darwin") {
      setTimeout(() => app.exit(0), MAC_QUIT_WATCHDOG_MS);
    }
  }

  private autoInstallOffFile(): string {
    return path.join(app.getPath("userData"), "launch-update.disabled");
  }

  /** Whether launch installs an update by itself (Settings → Updates). On unless turned off; the marker is a file, as the GPU one is. */
  getLaunchUpdateEnabled(): boolean {
    return !fs.existsSync(this.autoInstallOffFile());
  }

  setLaunchUpdateEnabled(enabled: boolean): boolean {
    try {
      if (enabled) fs.rmSync(this.autoInstallOffFile(), { force: true });
      else fs.writeFileSync(this.autoInstallOffFile(), "");
    } catch {
      // Unwritable: the answer below says what is actually in force.
    }
    return this.getLaunchUpdateEnabled();
  }

  private attemptFile(): string {
    return path.join(app.getPath("userData"), "launch-update.json");
  }

  private readAttempt(): InstallAttempt | null {
    try {
      return parseAttempt(fs.readFileSync(this.attemptFile(), "utf8"));
    } catch {
      return null;
    }
  }

  private writeAttempt(version: string): void {
    try {
      fs.writeFileSync(this.attemptFile(), JSON.stringify({ version, at: Date.now() } satisfies InstallAttempt));
    } catch {
      // If it can't be written the only cost is that a failing install is retried next launch.
    }
  }

  /**
   * Update on the way in: check this channel's feed, and if it holds a newer version, download it and install it before the
   * app opens. `report` is the splash's status line.
   *
   * Resolves "installing" once the app has been told to quit and install (the caller must not open the app), and "continue"
   * for everything else — nothing new, an unpackaged or package-managed install, a slow or failing check or download, or a
   * version already tried recently (see `shouldAutoInstall`). A failure here is never fatal: the updater state keeps the
   * error for Settings → Updates and the app opens as it would have.
   */
  async runLaunchUpdate(
    report: (text: string, progress: number | null) => void,
    prepareToQuit: () => void,
  ): Promise<"installing" | "continue"> {
    if (!app.isPackaged || process.env.CRYSTAL_SKIP_UPDATE_CHECK === "1" || this.installedByPackageManager()) return "continue";
    if (!this.getLaunchUpdateEnabled()) return "continue";

    report("Checking for updates…", null);
    await Promise.race([this.check(), new Promise<void>((resolve) => setTimeout(resolve, LAUNCH_CHECK_TIMEOUT_MS))]);
    if (this.state.phase !== "available") return "continue";
    const version = this.state.availableVersion;
    if (!version || !shouldAutoInstall(version, this.readAttempt(), Date.now())) return "continue";

    report(downloadStatus(version, 0), 0);
    const stopListening = this.onStateChange((state) => {
      if (state.phase === "downloading") report(downloadStatus(version, state.progressPercent), state.progressPercent);
    });
    try {
      await Promise.race([this.download(), new Promise<void>((resolve) => setTimeout(resolve, LAUNCH_DOWNLOAD_TIMEOUT_MS))]);
    } finally {
      stopListening();
    }
    // Read through the method: the checks above have narrowed `this.state`, but the download has changed it since.
    if (this.getState().phase !== "ready") return "continue";

    report(`Installing v${version}…`, null);
    // Recorded before quitting: an install that fails leaves the old version running next time, and this is what tells the
    // next launch not to try the same one again straight away.
    this.writeAttempt(version);
    this.quitAndInstall(prepareToQuit);
    return "installing";
  }
}

export default new Updater();
