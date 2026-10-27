#!/usr/bin/env bun
/**
 * Writes the AUR PKGBUILD for one of the apps, from aur/PKGBUILD.in.
 *
 *   bun scripts/make-pkgbuild.mjs --app crystal|studio --version 1.2.3 --deb <the built .deb> [--out PKGBUILD]
 *   bun scripts/make-pkgbuild.mjs --app crystal|studio --version 1.2.3 --sha256 <hex>          (when it is already known)
 *
 * Run by the `aur` job in .github/workflows/release.yml after a Stable release is published. The names come from the
 * channel table (electron/channels.ts), the same one the installer reads, so the package the workflow publishes and the
 * package the installer asks for cannot drift apart.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CHANNELS, appIdentity } from "../electron/channels.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const DESCRIPTION = {
  crystal: "Crystal: chat, voice and video, communities, and the Marketplace",
  studio: "Crystal Studio: design cosmetics, build bots and extensions, and publish them",
};

/** The PKGBUILD for `app` at `version`, whose release .deb has the given SHA-256. Throws on anything it can't vouch for. */
export function pkgbuild({ app, version, sha256, template }) {
  if (app !== "crystal" && app !== "studio") throw new Error(`Unknown app: ${app}`);
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error(`Not a release version: ${version}`);
  if (!/^[0-9a-f]{64}$/.test(sha256 ?? "")) throw new Error("--sha256 must be the 64 hex digits of the .deb's SHA-256.");

  const stable = CHANNELS.stable;
  const identity = appIdentity(stable, app);
  if (!identity.aurPackage) throw new Error(`${identity.productName} has no AUR package.`);

  const values = {
    PKGNAME: identity.aurPackage,
    VERSION: version,
    DESCRIPTION: DESCRIPTION[app],
    BINARY: identity.aurBinary,
    TAGPREFIX: stable.tagPrefix,
    FILENAME: identity.fileName,
    SHA256: sha256,
  };
  const text = (template ?? readFileSync(join(root, "aur", "PKGBUILD.in"), "utf8")).replace(/@([A-Z0-9]+)@/g, (whole, key) => {
    if (!(key in values)) throw new Error(`The template asks for ${whole}, which this script doesn't know.`);
    return values[key];
  });
  // The description sits inside single quotes in the PKGBUILD.
  if (/'/.test(DESCRIPTION[app])) throw new Error("A description can't contain a single quote.");
  return text;
}

/** The file name the release gives this app's .deb, which the PKGBUILD downloads by name. */
export const debName = (app, version) => `${appIdentity(CHANNELS.stable, app).fileName}-${version}.deb`;

if (import.meta.main) {
  const args = Object.fromEntries(
    process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1]]] : [])),
  );
  try {
    // `--deb` is the .deb that was just built: hashed here, and its name checked against what the PKGBUILD will download,
    // so a build that named it differently fails now instead of 404ing for every Arch user.
    if (args.deb) {
      if (basename(args.deb) !== debName(args.app, args.version)) throw new Error(`${basename(args.deb)} isn't the file the release publishes for ${args.app} ${args.version} (${debName(args.app, args.version)}).`);
      args.sha256 = createHash("sha256").update(readFileSync(args.deb)).digest("hex");
    }
    const out = pkgbuild({ app: args.app, version: args.version, sha256: args.sha256 });
    writeFileSync(args.out ?? "PKGBUILD", out);
    console.log(`wrote ${args.out ?? "PKGBUILD"} for ${args.app} ${args.version}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
