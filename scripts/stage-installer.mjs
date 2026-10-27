#!/usr/bin/env bun
/**
 * Lays out the installer as an app of its own in `.installer-app/`, for electron-builder to package
 * (`directories.app` in scripts/electron-builder-config.cjs).
 *
 * Why not package it from the repo like Crystal: electron-builder bundles every production dependency in the nearest
 * package.json, whatever `files` says, and this repo's are the whole app's (React, three.js, Convex, ...) — which made a
 * 760 MB "installer". The installer needs one library, so it gets a package.json that names only that.
 *
 *   .installer-app/
 *     package.json            name, version, main, and the one dependency
 *     installer/              compiled main process, preload, and ui/ (the wizard's page)
 *     channels.js, releases.js   the two modules it shares with the apps
 *     node_modules/           js-yaml and what it needs
 *
 * Run after `bun run build:electron` (which compiles all of the above).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist-electron");
const out = join(root, ".installer-app");

for (const f of ["installer/main.js", "installer/ui/index.html", "channels.js", "releases.js"]) {
  if (!existsSync(join(dist, f))) {
    console.error(`dist-electron/${f} is missing: run \`bun run build:electron\` first.`);
    process.exit(1);
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const read = (name) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The installer's own version is the repo's: the channel's version, which is also the release the installer is built with.
// Dependencies are what the code requires at runtime, found by walking from js-yaml.
const wanted = new Set();
const walk = (name) => {
  if (wanted.has(name)) return;
  wanted.add(name);
  for (const dep of Object.keys(read(name).dependencies ?? {})) walk(dep);
};
walk("js-yaml");

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "crystal-installer",
      productName: "Crystal Setup",
      version: pkg.version,
      description: "Installs Crystal and Crystal Studio.",
      author: pkg.author,
      main: "installer/main.js",
      dependencies: { "js-yaml": read("js-yaml").version },
    },
    null,
    2,
  ) + "\n",
);

cpSync(join(dist, "installer"), join(out, "installer"), { recursive: true });
cpSync(join(dist, "channels.js"), join(out, "channels.js"));
cpSync(join(dist, "releases.js"), join(out, "releases.js"));
for (const name of wanted) cpSync(join(root, "node_modules", name), join(out, "node_modules", name), { recursive: true });

// Source maps are for debugging the build, not something to ship.
for (const f of ["installer/main.js.map", "installer/engine.js.map", "installer/core.js.map", "installer/preload.js.map", "installer/format.js.map"]) rmSync(join(out, f), { force: true });

console.log(`staged .installer-app (${[...wanted].join(", ")})`);
