import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Release channels.
 *
 * Crystal ships from four branches, each of which publishes its own installers
 * and its own update feed: `development` (every merge, roughest), `canary`
 * (early but coherent), `ptb` (a stable candidate), and `main` (Stable). Each
 * channel is a *separate application* — its own appId, product name, icon and
 * install directory — so a tester can keep Canary alongside Stable and file
 * bugs against a build without giving up a working one.
 *
 * This table is the single source of truth for all of that: the main process
 * reads it to pick a window icon and an update feed, and
 * scripts/electron-builder-config.cjs reads the compiled output
 * (dist-electron/channels.js) to configure the packager. Deliberately free of
 * `electron` imports for that reason — it has to load in plain Node too.
 */
export type ReleaseChannel = "stable" | "ptb" | "canary" | "development";

/** Where releases are published. Used for the update feed and the "view
 * releases" link, and mirrored by the `publish` block in electron-builder.yml. */
export const REPO = { owner: "poliberry", repo: "crystal-desktop-v2" } as const;

export interface ChannelDefinition {
  id: ReleaseChannel;
  /** Shown in Settings → Updates / About. */
  label: string;
  /** Installed application name. Distinct per channel so channels install
   * side by side instead of overwriting each other. */
  productName: string;
  /** Distinct per channel for the same reason — this is what the OS uses to
   * tell two installs apart. */
  appId: string;
  /** Space-free base for installer/artifact filenames. Kept separate from
   * `productName` because the built file, the asset GitHub ends up hosting and
   * the name written into latest.yml only agree when there's no space in it —
   * see the `nsis` comment in electron-builder.yml. */
  fileName: string;
  /** Icon in build/, used for the packaged app and its windows. */
  icon: string;
  /** Branch whose pushes publish this channel. */
  branch: string;
  /**
   * Git tag prefix for this channel's releases. Stable keeps the plain
   * `v1.2.3` tags — GitHub treats the newest non-prerelease as the repo's
   * "latest release", which is what electron-updater's GitHub provider asks
   * for. Every other channel is `<channel>-1.2.3` and is published as a
   * prerelease, so it never becomes "latest" and never reaches a Stable user.
   */
  tagPrefix: string;
}

export const CHANNELS: Record<ReleaseChannel, ChannelDefinition> = {
  stable: {
    id: "stable",
    label: "Stable",
    productName: "Crystal",
    appId: "dev.crystal.desktop",
    fileName: "Crystal",
    icon: "icon.png",
    branch: "main",
    tagPrefix: "v",
  },
  ptb: {
    id: "ptb",
    label: "PTB",
    productName: "Crystal PTB",
    appId: "dev.crystal.desktop.ptb",
    fileName: "Crystal-PTB",
    // Shares Stable's icon on purpose: PTB is a release candidate, and a
    // different-looking icon would suggest it's a different kind of build.
    icon: "icon.png",
    branch: "ptb",
    tagPrefix: "ptb-",
  },
  canary: {
    id: "canary",
    label: "Canary",
    productName: "Crystal Canary",
    appId: "dev.crystal.desktop.canary",
    fileName: "Crystal-Canary",
    icon: "icon-canary.png",
    branch: "canary",
    tagPrefix: "canary-",
  },
  development: {
    id: "development",
    label: "Development",
    productName: "Crystal Development",
    appId: "dev.crystal.desktop.dev",
    fileName: "Crystal-Development",
    icon: "icon-dev.png",
    branch: "development",
    tagPrefix: "development-",
  },
};

export function isReleaseChannel(value: unknown): value is ReleaseChannel {
  return typeof value === "string" && value in CHANNELS;
}

/** Parse a channel id, from an env var or packaged metadata. */
export function resolveChannelId(raw: unknown): ReleaseChannel | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  return isReleaseChannel(normalized) ? normalized : null;
}

/** The channel a branch publishes, or null for a branch that publishes none. */
export function channelForBranch(branch: string): ChannelDefinition | null {
  return Object.values(CHANNELS).find((channel) => channel.branch === branch) ?? null;
}

/**
 * `buildChannel`, stamped into the packaged app's package.json by
 * scripts/electron-builder-config.cjs (electron-builder's `extraMetadata`).
 *
 * Reading it back out of the packaged metadata rather than baking it into the
 * compiled JS keeps `bun run build:electron` channel-agnostic — one compile
 * can be packaged as any channel.
 */
function readBuildChannel(appPath: string): ReleaseChannel | null {
  try {
    const raw = fs.readFileSync(path.join(appPath, "package.json"), "utf8");
    return resolveChannelId((JSON.parse(raw) as { buildChannel?: unknown }).buildChannel);
  } catch {
    return null;
  }
}

/** Which channel the running app belongs to. */
export function resolveRunningChannel(options: {
  appPath: string;
  isPackaged: boolean;
}): ChannelDefinition {
  const fromEnv = resolveChannelId(process.env.CRYSTAL_CHANNEL);
  if (fromEnv) return CHANNELS[fromEnv];

  const fromMetadata = readBuildChannel(options.appPath);
  if (fromMetadata) return CHANNELS[fromMetadata];

  // An unpackaged run is a dev run. A packaged build with no marker is a
  // Stable build from before channels existed — assuming Stable keeps its
  // update feed pointed at the releases it has always used.
  return options.isPackaged ? CHANNELS.stable : CHANNELS.development;
}
