/**
 * electron-builder configuration, per release channel.
 *
 * electron-builder.yml holds everything that's the same for every build; this
 * layers the channel's identity on top of it — product name, appId, icon,
 * artifact names — so `CRYSTAL_CHANNEL=canary bunx electron-builder --win`
 * produces a "Crystal Canary" that installs alongside Stable instead of over
 * it. Defaults to Stable, so a plain `bun run dist` still builds the shipping
 * product.
 *
 * Deliberately NOT named electron-builder.config.cjs: that name is one
 * electron-builder discovers on its own, and having two configs it might pick
 * between is how a release gets built with the wrong one. Every caller passes
 * `--config scripts/electron-builder-config.cjs` explicitly.
 *
 * The channel table lives in electron/channels.ts because the main process
 * needs it too; this reads its compiled output, which `bun run build:electron`
 * has already produced by the time anything packages.
 */
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const { CHANNELS, resolveChannelId } = require("../dist-electron/channels.js");

const repoRoot = path.join(__dirname, "..");
const channelId = resolveChannelId(process.env.CRYSTAL_CHANNEL) ?? "stable";
const channel = CHANNELS[channelId];

const base = yaml.load(fs.readFileSync(path.join(repoRoot, "electron-builder.yml"), "utf8"));

module.exports = {
  ...base,
  appId: channel.appId,
  productName: channel.productName,
  icon: `build/${channel.icon}`,
  // Stamped into the packaged package.json, and read back at runtime by
  // `resolveRunningChannel` — this is how the app knows which channel it is.
  extraMetadata: { ...base.extraMetadata, buildChannel: channel.id },
  // Replaces the base entry rather than adding to it: the app asks for
  // `icon.png` at runtime whichever channel it is, so each channel ships its
  // own icon under that one name.
  extraResources: [{ from: `build/${channel.icon}`, to: "icon.png" }],
  // A product name with a space in it ("Crystal Canary") is exactly the
  // filename mismatch the `nsis` comment in electron-builder.yml describes:
  // electron-builder writes dashes into latest.yml while GitHub's asset upload
  // writes dots, and the auto-updater 404s. Every artifact therefore uses the
  // channel's space-free `fileName` instead of ${productName}.
  artifactName: `${channel.fileName}-\${version}.\${ext}`,
  nsis: {
    ...base.nsis,
    artifactName: `${channel.fileName}-Setup-\${version}.\${ext}`,
  },
};
