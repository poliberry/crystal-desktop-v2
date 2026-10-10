#!/usr/bin/env bun
/**
 * Builds the installer's window (installer-ui/) into dist-electron/installer/ui/, where electron/installer/main.ts loads it
 * from. One script-tag bundle (esbuild), the stylesheet, the page, and the few images and the one typeface it uses, all
 * copied beside it so the page needs nothing from outside — an installer can't assume a network, or the rest of the app.
 *
 * Run by `bun run build:electron`, after the main process is compiled.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-electron", "installer", "ui");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "fonts"), { recursive: true });

await build({
  entryPoints: [join(root, "installer-ui", "app.ts")],
  outfile: join(out, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  minify: true,
  legalComments: "none",
  // three.js loads on demand in the page; as a single script it is simply part of the bundle.
  logLevel: "warning",
});

for (const f of ["index.html", "app.css"]) cpSync(join(root, "installer-ui", f), join(out, f));
cpSync(join(root, "build", "icon.png"), join(out, "icon.png"));
cpSync(join(root, "build", "icon-studio.png"), join(out, "icon-studio.png"));
cpSync(join(root, "public", "fonts", "BluSans-VariableFont_wght.ttf"), join(out, "fonts", "BluSans-VariableFont_wght.ttf"));
console.log("installer ui built");
