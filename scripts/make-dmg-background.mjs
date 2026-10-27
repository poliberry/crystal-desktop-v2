#!/usr/bin/env bun
/**
 * Draws the picture behind the installer's disk image (build/dmg-background.png, and the @2x beside it for Retina
 * screens; electron-builder joins the two into one image when it makes the .dmg).
 *
 *   bun scripts/make-dmg-background.mjs
 *
 * The disk image holds one thing, the installer app, and no shortcut to /Applications: the installer is what puts Crystal
 * there, so dragging it anywhere would only install the installer. The picture says what to do instead: open it.
 *
 * The window is as big as this picture (electron-builder reads it from the file), and the app's icon is placed on the
 * same grid by `dmg.contents` in scripts/electron-builder-config.cjs. Keep ICON_X and ICON_Y in step with that.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const WIDTH = 660;
export const HEIGHT = 420;
/** Where the app's icon is centred, in points. */
export const ICON_X = 330;
export const ICON_Y = 250;

const FONT = `'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="62%" r="62%">
      <stop offset="0" stop-color="#2a3a6e" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="#141a33" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#09090b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="arrow" gradientUnits="userSpaceOnUse" x1="0" y1="134" x2="0" y2="170">
      <stop offset="0" stop-color="#8da2ff" stop-opacity="0.15"/>
      <stop offset="1" stop-color="#b8c4ff" stop-opacity="0.95"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#09090b"/>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>

  <text x="${WIDTH / 2}" y="78" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="600" fill="#f4f4f5" letter-spacing="-0.4">Welcome to Crystal</text>
  <text x="${WIDTH / 2}" y="110" text-anchor="middle" font-family="${FONT}" font-size="16" fill="#a1a1aa">Open the installer below to get started.</text>

  <!-- An arrow down to the icon: the one thing to do. -->
  <g fill="none" stroke="url(#arrow)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M${ICON_X} 134 V 168"/>
    <path d="M${ICON_X - 11} 158 L ${ICON_X} 170 L ${ICON_X + 11} 158"/>
  </g>

  <text x="${WIDTH / 2}" y="${HEIGHT - 44}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#71717a">Double-click to open it. If macOS asks, choose Open.</text>
  <text x="${WIDTH / 2}" y="${HEIGHT - 24}" text-anchor="middle" font-family="${FONT}" font-size="13" fill="#52525b">It may ask for your administrator password to replace an older copy.</text>
</svg>`;

const png = (scale) => sharp(Buffer.from(svg), { density: 72 * scale }).resize(WIDTH * scale, HEIGHT * scale).png({ compressionLevel: 9 }).toBuffer();

writeFileSync(join(root, "build", "dmg-background.png"), await png(1));
writeFileSync(join(root, "build", "dmg-background@2x.png"), await png(2));
console.log(`wrote build/dmg-background.png (${WIDTH}x${HEIGHT}) and build/dmg-background@2x.png`);
