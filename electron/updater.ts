import { app } from "electron";
import { autoUpdater } from "electron-updater";

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

  quitAndInstall(): void {
    if (this.state.phase !== "ready") return;
    autoUpdater.quitAndInstall();
  }
}

export default new Updater();
