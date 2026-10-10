#!/usr/bin/env bun
/**
 * Builds every app icon from the two exports in build/source/, and checks them with `--check`.
 *
 *   bun scripts/make-icons.mjs           regenerate
 *   bun scripts/make-icons.mjs --check   fail if an output is missing or out of date (nothing is written)
 *
 * The sources are what Icon Composer exports (File > Export, "Default", 1024px): `crystal.png` for Crystal and
 * `crystal-studio.png` for Crystal Studio. Next to each is the `.icon` document it came from, so the artwork can be
 * edited and re-exported; this script is the only thing that reads the PNGs.
 *
 * Two shapes are made of each, because the platforms want different things:
 *
 *   icon.png / icon-studio.png            full bleed, 512px. Windows and Linux (installer, window, taskbar, tray), and
 *                                         the in-app images (Studio's title bar, the web tab).
 *   icon-mac.png / icon-studio-mac.png    1024px with the margin macOS icons have (the artwork is 824px of the 1024px
 *                                         square, Apple's grid). electron-builder turns this into the .icns, and the dev
 *                                         build sets it as the Dock icon. Without the margin, the icon is drawn a fifth
 *                                         larger than every other app's in the Dock and Finder.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const APPS = [
  {
    source: "build/source/crystal.png",
    full: "build/icon.png",
    mac: "build/icon-mac.png",
    // Crystal's favicon on the web (Next serves src/app/icon.png as the tab icon).
    small: [["src/app/icon.png", 512]],
  },
  {
    source: "build/source/crystal-studio.png",
    full: "build/icon-studio.png",
    mac: "build/icon-studio-mac.png",
    // Studio's title bar and sign-in page, and the favicon of its tab on the web.
    small: [
      ["public/studio-icon.png", 128],
      ["public/studio-icon-32.png", 32],
    ],
  },
];

const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const ART = 824; // of 1024
const MARGIN = (1024 - ART) / 2;

const make = {
  full: (src) => sharp(src).resize(512, 512).png({ compressionLevel: 9 }).toBuffer(),
  mac: (src) =>
    sharp(src)
      .resize(ART, ART)
      .extend({ top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN, background: CLEAR })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  small: (src, size) => sharp(src).resize(size, size).png({ compressionLevel: 9 }).toBuffer(),
};

const digest = (buf) => createHash("sha256").update(buf).digest("hex");
let stale = 0;

async function emit(rel, buf) {
  const path = join(root, rel);
  // Compared on pixels, not bytes: PNG encoders aren't stable across versions of the library.
  const same = existsSync(path) && digest(await sharp(readFileSync(path)).ensureAlpha().raw().toBuffer()) === digest(await sharp(buf).ensureAlpha().raw().toBuffer());
  if (same) return;
  if (check) {
    stale++;
    console.log(`stale or missing: ${rel}`);
  } else {
    writeFileSync(path, buf);
    console.log(`wrote ${rel}`);
  }
}

for (const app of APPS) {
  const src = join(root, app.source);
  if (!existsSync(src)) {
    console.error(`missing source: ${app.source}`);
    process.exit(1);
  }
  const meta = await sharp(src).metadata();
  if (meta.width !== 1024 || meta.height !== 1024 || !meta.hasAlpha) {
    console.error(`${app.source} must be a 1024x1024 PNG with transparency (it is ${meta.width}x${meta.height}, alpha ${meta.hasAlpha}).`);
    process.exit(1);
  }
  await emit(app.full, await make.full(src));
  await emit(app.mac, await make.mac(src));
  for (const [rel, size] of app.small) await emit(rel, await make.small(src, size));
}

if (check) {
  console.log(stale ? `${stale} icon file(s) need regenerating: bun scripts/make-icons.mjs` : "icons are up to date");
  process.exit(stale ? 1 : 0);
}
