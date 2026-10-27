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

/**
 * Crystal ships as two applications from one codebase: Crystal itself, and Crystal Studio, which is installed, launched,
 * updated and uninstalled on its own (own Dock tile, own icon, own data directory, own update feed). Each exists on every
 * channel, so "Crystal Studio Canary" sits beside "Crystal Canary".
 */
export type AppKind = "crystal" | "studio";

/** What the OS knows an application by. For `crystal` this is the channel's own row, unchanged. */
export interface AppIdentity {
  kind: AppKind;
  productName: string;
  appId: string;
  /** Space-free base for installer filenames. */
  fileName: string;
  /** Icon in build/ for Windows and Linux: full bleed. */
  icon: string;
  /**
   * Icon in build/ for macOS: the same artwork with the margin macOS icons have, which is what the .icns is made from and
   * what a development run puts in the Dock (it has no bundle icon of its own). See scripts/make-icons.mjs.
   */
  macIcon: string;
  /** The custom URL scheme this app is the handler for. */
  scheme: string;
  /**
   * electron-updater's feed "channel", which names the metadata file it reads (`latest-mac.yml` for the default). Crystal
   * and Crystal Studio publish to one GitHub release, so each needs a file of its own or they would overwrite one another.
   */
  feedChannel: string;
  /**
   * The Arch User Repository package that installs this app, or null where there isn't one. Only Stable is published
   * to the AUR: the other channels are prereleases, and a package manager would offer them as upgrades to everyone.
   * The `-bin` suffix is the AUR's convention for a package that repackages a published binary.
   */
  aurPackage: string | null;
  /**
   * The command the AUR package puts in /usr/bin. Not `crystal`: Arch's own `crystal` package (the programming language)
   * owns /usr/bin/crystal, and two packages can't share a file.
   */
  aurBinary: string;
}

export function appIdentity(channel: ChannelDefinition, kind: AppKind): AppIdentity {
  if (kind === "crystal") {
    return {
      kind,
      productName: channel.productName,
      appId: channel.appId,
      fileName: channel.fileName,
      icon: channel.icon,
      // Canary and Development have artwork of their own, already circular and unpadded as they were drawn.
      macIcon: channel.icon === "icon.png" ? "icon-mac.png" : channel.icon,
      scheme: "crystal",
      feedChannel: "latest",
      aurPackage: channel.id === "stable" ? "crystal-desktop-bin" : null,
      aurBinary: channel.id === "stable" ? "crystal-desktop" : `crystal-desktop-${channel.id}`,
    };
  }
  const side = channel.id === "stable";
  return {
    kind,
    productName: side ? "Crystal Studio" : `Crystal Studio ${channel.label}`,
    appId: `${channel.appId}.studio`,
    fileName: side ? "Crystal-Studio" : `Crystal-Studio-${channel.label}`,
    // One icon on every channel, as PTB shares Stable's.
    icon: "icon-studio.png",
    macIcon: "icon-studio-mac.png",
    scheme: "crystal-studio",
    feedChannel: "studio",
    aurPackage: side ? "crystal-studio-bin" : null,
    aurBinary: side ? "crystal-studio" : `crystal-studio-${channel.id}`,
  };
}

export function resolveAppKind(raw: unknown): AppKind | null {
  return raw === "crystal" || raw === "studio" ? raw : null;
}

/**
 * Which application the running process is. Like the channel, `CRYSTAL_APP` wins (dev runs, packaging) and a packaged
 * build reads the `buildApp` that scripts/electron-builder-config.cjs stamped into its package.json.
 */
export function resolveRunningApp(options: { appPath: string }): AppKind {
  const fromEnv = resolveAppKind(process.env.CRYSTAL_APP);
  if (fromEnv) return fromEnv;
  try {
    const raw = fs.readFileSync(path.join(options.appPath, "package.json"), "utf8");
    return resolveAppKind((JSON.parse(raw) as { buildApp?: unknown }).buildApp) ?? "crystal";
  } catch {
    return "crystal";
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
