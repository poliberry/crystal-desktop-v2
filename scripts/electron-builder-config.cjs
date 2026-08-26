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

/**
 * Whether a real Developer ID certificate has been handed to this build.
 *
 * These are the two variables electron-builder itself reads to find a
 * certificate (a base64/path to a .p12, or a name in the keychain), so asking
 * about them is the same question electron-builder is about to ask.
 */
const hasSigningCertificate = !!(process.env.CSC_LINK || process.env.CSC_NAME);

/**
 * How to sign the macOS app.
 *
 * With `identity` left unset and no certificate in the keychain,
 * electron-builder *skips signing entirely* — there is no ad-hoc fallback
 * (see the `identity` docs in app-builder-lib's scheme.json). That isn't
 * merely "unsigned": electron-builder has already renamed the Electron binary
 * and rebuilt the bundle around it, so what ships is the prebuilt binary's
 * inherited linker-signed signature attached to a bundle it doesn't seal —
 * `codesign --verify` fails with "code has no resources but signature
 * indicates they must be present", and Gatekeeper reports that as
 * "Crystal.app is damaged and cannot be opened".
 *
 * So: a real Developer ID when one is configured (hardened runtime and
 * notarization come with it), and an explicit ad-hoc signature otherwise.
 * Ad-hoc still isn't *trusted* — a downloaded copy has to be allowed through
 * Gatekeeper by hand — but it is valid, which is the difference between an app
 * macOS calls damaged and one it merely can't vouch for.
 */
const macSigning = hasSigningCertificate
  ? {
      // Left to electron-builder's keychain discovery, which is what CSC_LINK
      // populates. Hardened runtime is a prerequisite for notarization.
      hardenedRuntime: true,
    }
  : {
      identity: "-",
      // Hardened runtime turns on library validation, which rejects the
      // pre-signed Electron frameworks precisely because an ad-hoc signature
      // carries no Team ID for them to match. It's only required in order to
      // notarize, which an ad-hoc build can't do anyway.
      hardenedRuntime: false,
      // Belt and braces: @electron/notarize only engages when the Apple
      // credentials are in the environment, but there is nothing to notarize
      // without a Developer ID and a failure here would fail the build.
      notarize: false,
    };

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
  mac: {
    ...base.mac,
    ...macSigning,
    // A platform block *replaces* the shared `extraResources` rather than
    // adding to it, so the mac entry (the system-audio helper) would otherwise
    // leave the packaged app without the `icon.png` the main process looks up
    // at runtime — which is what the tray falls back to. Both, explicitly.
    extraResources: [
      ...(base.mac?.extraResources ?? []),
      { from: `build/${channel.icon}`, to: "icon.png" },
    ],
  },
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
